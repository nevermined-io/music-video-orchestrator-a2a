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
import { Task, TaskState } from "./models/task";
import { OrchestrationIO } from "./interfaces/orchestrationIO";
import { interpretUserFeedbackWithLLM } from "./llm/prompts";

/**
 * @enum OrchestrationStep
 * @description Steps for the reentrant orchestration process.
 */
export enum OrchestrationStep {
  GENERATE_SONG = "generate_song",
  GENERATE_SCRIPT_AND_EXTRACT_ENTITIES = "generate_script_and_extract_entities",
  GENERATE_IMAGES = "generate_images",
  GENERATE_VIDEO_CLIPS = "generate_video_clips",
  COMPILE_AND_UPLOAD_VIDEO = "compile_and_upload_video",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * @function continueOrchestration
 * @description Main entry point for reentrant orchestration. Calls the appropriate step based on metadata.currentStep.
 * @param {Task} task - The orchestration task.
 * @param {OrchestrationIO} io - The IO interface for progress and user input.
 */
export async function continueOrchestration(
  task: Task,
  io: OrchestrationIO
): Promise<void> {
  const step = task.metadata?.currentStep;
  switch (step) {
    case OrchestrationStep.GENERATE_SONG:
      await stepGenerateSong(task, io);
      break;
    case OrchestrationStep.GENERATE_SCRIPT_AND_EXTRACT_ENTITIES:
      await stepGenerateScriptAndExtractEntities(task, io);
      break;
      // case OrchestrationStep.GENERATE_IMAGES:
      //   await stepGenerateImages(task, io);
      //   break;
      // case OrchestrationStep.GENERATE_VIDEO_CLIPS:
      //   await stepGenerateVideoClips(task, io);
      //   break;
      // case OrchestrationStep.COMPILE_AND_UPLOAD_VIDEO:
      //   await stepCompileAndUploadVideo(task, io);
      //   break;
      // case OrchestrationStep.COMPLETED:
      //   await stepCompleted(task, io);
      //   break;
      // case OrchestrationStep.FAILED:
      //   await stepFailed(task, io);
      break;
    default:
      throw new Error(`Unknown orchestration step: ${step}`);
  }
}

/**
 * @function stepGenerateSong
 * @description Generates the song and requests user feedback (pauses here until user input is received).
 * @param {Task} task - The orchestration task.
 * @param {OrchestrationIO} io - The IO interface for progress and user input.
 */
export async function stepGenerateSong(
  task: Task,
  io: OrchestrationIO
): Promise<void> {
  const songAgentCard = await fetchAgentCard("http://localhost:8001");
  await io.onProgress({
    state: TaskState.WORKING,
    text: "Generating song...",
    artifacts: [],
    metadata: {
      ...task.metadata,
      currentStep: OrchestrationStep.GENERATE_SONG,
    },
  });

  const { songResult, songUrl, title } = await generateSong(
    songAgentCard,
    task.message
  );

  Logger.info(
    `[stepGenerateSong] Received song with url: ${songUrl} and title: ${title}`
  );

  // Notify the user that input is required
  await io.onProgress({
    state: TaskState.INPUT_REQUIRED,
    text: "The song has been generated. Shall we move on to the next step or do you want some changes?",
    artifacts: Array.isArray(songResult?.artifacts) ? songResult.artifacts : [],
  });
}

/**
 * @function stepGenerateScriptAndExtractEntities
 * @description Generates the script and extracts characters, settings, and scenes.
 * @param {Task} task - The orchestration task.
 * @param {OrchestrationIO} io - The IO interface for progress and user input.
 */
export async function stepGenerateScriptAndExtractEntities(
  task: Task,
  io: OrchestrationIO
): Promise<void> {
  const scriptAgentCard = await fetchAgentCard("http://localhost:8002");

  await io.onProgress({
    state: TaskState.WORKING,
    text: "Generating script...",
    artifacts: [],
  });

  // Generate the script using the accepted song
  const scriptResult = await generateScript(
    scriptAgentCard,
    task.message,
    task.artifacts?.[0] // Use the accepted song
  );

  const scriptArtifacts = Array.isArray(scriptResult?.artifacts)
    ? scriptResult.artifacts
    : [];

  await io.onProgress({
    state: TaskState.WORKING,
    text: "Script generated. Extracting characters, settings, and scenes...",
    artifacts: scriptArtifacts,
  });

  // Extract entities in parallel
  const [characters, settings, scenes] = await Promise.all([
    extractCharacters(scriptAgentCard, scriptResult),
    extractSettings(scriptAgentCard, scriptResult),
    extractScenes(scriptAgentCard, scriptResult),
  ]);

  // Update task metadata and artifacts
  task.metadata = {
    ...task.metadata,
    currentStep: OrchestrationStep.GENERATE_IMAGES,
  };
  task.artifacts = scriptArtifacts;

  await io.onProgress({
    state: TaskState.INPUT_REQUIRED,
    text: `Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes. Ready to generate images.`,
    artifacts: scriptArtifacts,
    metadata: {
      ...task.metadata,
      currentStep: OrchestrationStep.GENERATE_IMAGES,
    },
  });

  // Aquí puedes llamar directamente al siguiente paso si no hay espera de usuario:
  // await stepGenerateImages(task, io);
}

/**
 * @function handleUserInput
 * @description Handles user feedback after an INPUT_REQUIRED state, deciding whether to advance or repeat the current step using LLM interpretation.
 * @param {Task} task - The orchestration task.
 * @param {string} userInput - The user's feedback or instructions.
 * @param {OrchestrationIO} io - The IO interface for progress and user input.
 */
export async function handleUserInput(
  task: Task,
  userInput: string,
  io: OrchestrationIO
): Promise<void> {
  // Use LLM to interpret user feedback and decide next action
  const userPromptMessage = task.status?.message?.parts?.[0]?.text || "";

  // Select the correct agentCard based on the current step
  let agentCard: any = {};
  switch (task.metadata?.currentStep) {
    case OrchestrationStep.GENERATE_SONG:
      agentCard = await fetchAgentCard("http://localhost:8001");
      break;
    case OrchestrationStep.GENERATE_SCRIPT_AND_EXTRACT_ENTITIES:
      agentCard = await fetchAgentCard("http://localhost:8002");
      break;
    case OrchestrationStep.GENERATE_IMAGES:
    case OrchestrationStep.GENERATE_VIDEO_CLIPS:
      agentCard = await fetchAgentCard("http://localhost:8003");
      break;
    default:
      agentCard = {};
  }

  const feedback = await interpretUserFeedbackWithLLM({
    previousInput: task.message,
    previousOutput: task.artifacts,
    userPromptMessage,
    userComment: userInput,
    agentCard,
  });

  switch (task.metadata?.currentStep) {
    case OrchestrationStep.GENERATE_SONG:
      if (feedback.action === "accept") {
        // Advance to next step
        task.metadata.currentStep =
          OrchestrationStep.GENERATE_SCRIPT_AND_EXTRACT_ENTITIES;
      } else if (feedback.action === "retry" || feedback.action === "modify") {
        // Repeat the same step, update input if provided
        if (feedback.newInput) {
          task.message = feedback.newInput;
        }
        // currentStep remains the same
      }
      break;
    // Add similar logic for other steps if needed
    default:
      // By default, advance to next step
      break;
  }

  // Continue orchestration (onProgress will persist the task)
  await continueOrchestration(task, io);
}

/**
 * @function startOrchestration
 * @description Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @param {OrchestrationIO} io - Communication interface for progress and user input
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration(
  task: Task,
  io: OrchestrationIO
): Promise<any> {
  Logger.info(
    "[startOrchestration] Starting music video orchestration process"
  );
  await continueOrchestration(
    {
      ...task,
      metadata: {
        ...task.metadata,
        currentStep: OrchestrationStep.GENERATE_SONG,
      },
    },
    io
  );
}

/**
 * Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @param {OrchestrationIO} io - Communication interface for progress and user input
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration_old(
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
