/**
 * Orchestrates the music video creation workflow.
 * This module is decoupled from protocol-specific message structures; it uses domain models for progress and input.
 * @module orchestrator
 */

import { fetchAgentCard } from "./agents/a2aAgentClient";
import {
  extractCharacters,
  extractSettings,
  extractScenes,
} from "./agents/a2aResultExtractor";
import { Logger } from "./utils/logger";
import { compileMusicVideo } from "./services/video/videoUtils";
import {
  generateSong,
  generateScript,
  generateCharacterAndSettingImages,
  generateVideoClips,
} from "./services/orchestrationTasks";
import { uploadVideoToIPFS } from "./services/video/uploadVideoToIPFS";
import fs from "fs";
import { TaskState } from "./models/task";
import { OrchestrationIO } from "./interfaces/orchestrationIO";

/**
 * Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @param {OrchestrationIO} io - Communication interface for progress and user input
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration(
  input: { prompt: string; style?: string; sessionId?: string },
  io: OrchestrationIO
): Promise<any> {
  Logger.info(
    "[startOrchestration] Starting music video orchestration process"
  );

  const songAgentCard = await fetchAgentCard("http://localhost:8001");
  const scriptAgentCard = await fetchAgentCard("http://localhost:8002");
  const mediaAgentCard = await fetchAgentCard("http://localhost:8003");

  // Song generation with user validation loop
  let songAccepted = false;
  let songResult, songUrl, title;
  let currentInput: { prompt: string; style?: string } = { ...input };
  while (!songAccepted) {
    await io.onProgress({
      state: TaskState.WORKING,
      text: "Generating song...",
      artifacts: [],
    });
    ({ songResult, songUrl, title } = await generateSong(
      songAgentCard,
      currentInput
    ));
    Logger.info(
      `[startOrchestration] Received song with url: ${songUrl} and title: ${title}`
    );
    const songArtifacts = Array.isArray(songResult?.artifacts)
      ? songResult.artifacts
      : [];
    // Message shown to the user for feedback
    const userPromptMessage =
      "The song has been generated. Shall we move on to the next step or do you want some changes?";

    // Notify that user input is required
    await io.onProgress({
      state: TaskState.INPUT_REQUIRED,
      text: userPromptMessage,
      artifacts: songArtifacts,
    });
    return;
  }

  // Script generation
  await io.onProgress({
    state: TaskState.WORKING,
    text: "Generating script...",
    artifacts: [],
  });
  const scriptResult = await generateScript(scriptAgentCard, input, songResult);
  Logger.info("[startOrchestration] Received script generation result");
  const scriptArtifacts = Array.isArray(scriptResult?.artifacts)
    ? scriptResult.artifacts
    : [];
  await io.onProgress({
    state: TaskState.WORKING,
    text: "Script generated. Extracting characters, settings, and scenes...",
    artifacts: scriptArtifacts,
  });

  // Extraction
  const [characters, settings, scenes] = await Promise.all([
    extractCharacters(scriptAgentCard, scriptResult),
    extractSettings(scriptAgentCard, scriptResult),
    extractScenes(scriptAgentCard, scriptResult),
  ]);
  Logger.info(
    `[startOrchestration] Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes`
  );
  await io.onProgress({
    state: TaskState.WORKING,
    text: `Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes. Generating images...`,
    artifacts: [],
  });

  // Image generation
  Logger.info(
    "[startOrchestration] Generating images for characters and settings"
  );
  const generatedImages = await generateCharacterAndSettingImages(
    mediaAgentCard,
    characters,
    settings
  );
  Logger.info(
    `[startOrchestration] Generated ${generatedImages.characters.size} character images and ${generatedImages.settings.size} setting images`
  );
  // Extrae artifacts de cada resultado de imagen si existen (solo de la raíz)
  const imageArtifacts = [
    ...(generatedImages.rawCharacterArtifacts
      ?.map((a) => (Array.isArray(a?.artifacts) ? a.artifacts[0] : null))
      .filter(Boolean) || []),
    ...(generatedImages.rawSettingArtifacts
      ?.map((a) => (Array.isArray(a?.artifacts) ? a.artifacts[0] : null))
      .filter(Boolean) || []),
  ];
  await io.onProgress({
    state: TaskState.WORKING,
    text: "Images generated. Generating video clips...",
    artifacts: imageArtifacts,
  });

  // Video clips generation
  Logger.info("[startOrchestration] Generating video clips for each scene");
  const videoClipsResult = await generateVideoClips(
    mediaAgentCard,
    scenes,
    generatedImages
  );
  Logger.info(
    `[startOrchestration] Generated ${videoClipsResult.videoClips.length} video clips`
  );
  // Extrae artifacts de cada resultado de clip si existen (solo de la raíz)
  const videoArtifacts = (videoClipsResult.rawVideoArtifacts || [])
    .map((a) => (Array.isArray(a?.artifacts) ? a.artifacts[0] : null))
    .filter(Boolean);
  await io.onProgress({
    state: TaskState.WORKING,
    text: "Video clips generated. Compiling final video...",
    artifacts: videoArtifacts,
  });

  // Final video compilation
  Logger.info("[startOrchestration] Compiling final music video with audio");
  let finalVideoIpfsUrl = "";
  if (videoClipsResult.videoClips.length > 0 && songUrl) {
    const finalVideoPath = await compileMusicVideo(
      videoClipsResult.videoClips,
      songUrl
    );
    Logger.info(
      `[startOrchestration] Uploading final video to IPFS: ${finalVideoPath}`
    );
    const convertedTitle =
      title.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".mp4";
    finalVideoIpfsUrl = await uploadVideoToIPFS(finalVideoPath, convertedTitle);
    Logger.info(
      `[startOrchestration] Final video uploaded to IPFS: ${finalVideoIpfsUrl}`
    );
    // Clean up local file
    fs.unlinkSync(finalVideoPath);
    await io.onProgress({
      state: TaskState.COMPLETED,
      text: "Music video orchestration completed!",
      artifacts: [
        {
          name: "FinalVideo",
          parts: [
            {
              type: "video",
              url: finalVideoIpfsUrl,
              description: "Final music video (IPFS)",
            },
          ],
        },
      ],
    });
  } else {
    Logger.warn(
      "[startOrchestration] Skipping final compilation: missing video clips or song URL"
    );
    await io.onProgress({
      state: TaskState.FAILED,
      text: "Failed to compile final video: missing video clips or song URL.",
      artifacts: [],
    });
  }

  // Return the complete result with extracted data and generated media
  return {
    songResult,
    scriptResult,
    extractedData: {
      characters,
      settings,
      scenes,
    },
    generatedMedia: {
      characterImages: Object.fromEntries(generatedImages.characters),
      settingImages: Object.fromEntries(generatedImages.settings),
      videoClips: videoClipsResult.videoClips,
      finalVideoIpfsUrl,
    },
  };
}
