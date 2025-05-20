/**
 * Orchestrates the music video creation workflow.
 * @module orchestrator
 */

import { fetchAgentCard } from "./agents/a2aAgentClient";
import {
  extractCharacters,
  extractSettings,
  extractScenes,
} from "./agents/a2aResultExtractor";
import { Logger } from "./utils/logger";
import { compileMusicVideo } from "./utils/videoUtils";
import {
  generateSong,
  generateScript,
  generateCharacterAndSettingImages,
  generateVideoClips,
} from "./services/orchestrationTasks";
import { uploadVideoToIPFS } from "./services/uploadVideoToIPFS";
import fs from "fs";
import { TaskState } from "./models/task";

/**
 * Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @param {function} [onProgress] - Optional callback for progress updates
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration(
  input: { prompt: string },
  onProgress?: (progress: {
    state: TaskState;
    message: any;
    artifacts?: any[];
  }) => Promise<void>
): Promise<any> {
  Logger.info(
    "[startOrchestration] Starting music video orchestration process"
  );

  const songAgentCard = await fetchAgentCard("http://localhost:8001");
  const scriptAgentCard = await fetchAgentCard("http://localhost:8002");
  const mediaAgentCard = await fetchAgentCard("http://localhost:8003");

  // Song generation
  if (onProgress) {
    await onProgress({
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [{ type: "text", text: "Generating song..." }],
      },
    });
  }
  const { songResult, songUrl, title } = await generateSong(
    songAgentCard,
    input
  );
  Logger.info(
    `[startOrchestration] Received song with url: ${songUrl} and title: ${title}`
  );
  if (onProgress) {
    const songArtifacts = Array.isArray(songResult?.artifacts)
      ? songResult.artifacts
      : [];
    await onProgress({
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [
          {
            type: "text",
            text: "Song generated. Proceeding to script creation...",
          },
        ],
      },
      ...(songArtifacts.length > 0 ? { artifacts: songArtifacts } : {}),
    });
  }

  // Script generation
  if (onProgress) {
    await onProgress({
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [{ type: "text", text: "Generating script..." }],
      },
    });
  }
  const scriptResult = await generateScript(scriptAgentCard, input, songResult);
  Logger.info("[startOrchestration] Received script generation result");
  if (onProgress) {
    const scriptArtifacts = Array.isArray(scriptResult?.artifacts)
      ? scriptResult.artifacts
      : [];
    await onProgress({
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [
          {
            type: "text",
            text: "Script generated. Extracting characters, settings, and scenes...",
          },
        ],
      },
      ...(scriptArtifacts.length > 0 ? { artifacts: scriptArtifacts } : {}),
    });
  }

  // Extraction
  const [characters, settings, scenes] = await Promise.all([
    extractCharacters(scriptAgentCard, scriptResult),
    extractSettings(scriptAgentCard, scriptResult),
    extractScenes(scriptAgentCard, scriptResult),
  ]);
  Logger.info(
    `[startOrchestration] Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes`
  );
  if (onProgress) {
    await onProgress({
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [
          {
            type: "text",
            text: `Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes. Generating images...`,
          },
        ],
      },
    });
  }

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
  if (onProgress) {
    // Extrae artifacts de cada resultado de imagen si existen (solo de la raíz)
    const imageArtifacts = [
      ...(generatedImages.rawCharacterArtifacts
        ?.map((a) => (Array.isArray(a?.artifacts) ? a.artifacts[0] : null))
        .filter(Boolean) || []),
      ...(generatedImages.rawSettingArtifacts
        ?.map((a) => (Array.isArray(a?.artifacts) ? a.artifacts[0] : null))
        .filter(Boolean) || []),
    ];
    await onProgress({
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [
          { type: "text", text: "Images generated. Generating video clips..." },
        ],
      },
      ...(imageArtifacts.length > 0 ? { artifacts: imageArtifacts } : {}),
    });
  }

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
  if (onProgress) {
    // Extrae artifacts de cada resultado de clip si existen (solo de la raíz)
    const videoArtifacts = (videoClipsResult.rawVideoArtifacts || [])
      .map((a) => (Array.isArray(a?.artifacts) ? a.artifacts[0] : null))
      .filter(Boolean);
    await onProgress({
      state: TaskState.WORKING,
      message: {
        role: "agent",
        parts: [
          {
            type: "text",
            text: "Video clips generated. Compiling final video...",
          },
        ],
      },
      ...(videoArtifacts.length > 0 ? { artifacts: videoArtifacts } : {}),
    });
  }

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
    if (onProgress) {
      await onProgress({
        state: TaskState.COMPLETED,
        message: {
          role: "agent",
          parts: [
            { type: "text", text: "Music video orchestration completed!" },
          ],
        },
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
    }
  } else {
    Logger.warn(
      "[startOrchestration] Skipping final compilation: missing video clips or song URL"
    );
    if (onProgress) {
      await onProgress({
        state: TaskState.FAILED,
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: "Failed to compile final video: missing video clips or song URL.",
            },
          ],
        },
      });
    }
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
