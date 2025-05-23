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
import { taskStore } from "./tasks/taskContext";

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
 * @param {any} [overrideInput] - Optional synthesized input for step repetition.
 */
export async function continueOrchestration(
  task: Task,
  io: OrchestrationIO,
  overrideInput?: any
): Promise<void> {
  const step = task.metadata?.currentStep;
  switch (step) {
    case OrchestrationStep.GENERATE_SONG:
      await stepGenerateSong(task, io, overrideInput);
      break;
    case OrchestrationStep.GENERATE_SCRIPT_AND_EXTRACT_ENTITIES:
      await stepGenerateScriptAndExtractEntities(task, io, overrideInput);
      break;
      // case OrchestrationStep.GENERATE_IMAGES:
      //   await stepGenerateImages(task, io, overrideInput);
      //   break;
      // case OrchestrationStep.GENERATE_VIDEO_CLIPS:
      //   await stepGenerateVideoClips(task, io, overrideInput);
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
 * @param {any} [overrideInput] - Optional synthesized input for step repetition.
 */
export async function stepGenerateSong(
  task: Task,
  io: OrchestrationIO,
  overrideInput?: any
): Promise<void> {
  // Use the synthesized input if provided, otherwise use the last real user message
  const input =
    overrideInput ||
    (task.history && task.history.length > 0
      ? task.history[task.history.length - 1]
      : null);
  if (!input) {
    throw new Error("No user input available for song generation.");
  }

  const songAgentCard = await fetchAgentCard("http://localhost:8001");
  await io.onProgress({
    state: TaskState.WORKING,
    text: "Generating song...",
    artifacts: [],
  });

  const { songResult, songUrl, title } = await generateSong(
    songAgentCard,
    input
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
 * @param {any} [overrideInput] - Optional synthesized input for step repetition.
 */
export async function stepGenerateScriptAndExtractEntities(
  task: Task,
  io: OrchestrationIO,
  overrideInput?: any
): Promise<void> {
  const scriptAgentCard = await fetchAgentCard("http://localhost:8002");

  await io.onProgress({
    state: TaskState.WORKING,
    text: "Generating script...",
    artifacts: [],
  });

  // Use overrideInput if provided, otherwise use the conversation history
  const scriptInput = overrideInput || task.history;

  // Generate the script using the accepted song
  const scriptResult = await generateScript(
    scriptAgentCard,
    scriptInput,
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
  task.artifacts = [...(task.artifacts || []), ...scriptArtifacts];

  await io.onProgress({
    state: TaskState.INPUT_REQUIRED,
    text: `Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes. Ready to generate images.`,
    artifacts: scriptArtifacts,
    metadata: {
      ...task.metadata,
      currentStep: OrchestrationStep.GENERATE_IMAGES,
    },
  });
}

/**
 * @function handleUserFeedback
 * @description Handles user feedback after an INPUT_REQUIRED state, deciding whether to advance or repeat the current step using LLM interpretation.
 * @param {Task} task - The orchestration task.
 * @param {OrchestrationIO} io - The IO interface for progress and user input.
 */
export async function handleUserFeedback(
  task: Task,
  io: OrchestrationIO
): Promise<void> {
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

  // Use the full history and artifacts for LLM feedback interpretation
  const userMessages = (task.history || []).filter(
    (msg) => msg.role === "user"
  );
  const userComment =
    userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
  if (!userComment) {
    throw new Error(
      "No user message found in history for LLM feedback interpretation."
    );
  }
  const feedback = await interpretUserFeedbackWithLLM({
    history: task.history || [],
    previousOutput: task.artifacts || [],
    userComment,
    agentCard,
  });

  switch (task.metadata?.currentStep) {
    case OrchestrationStep.GENERATE_SONG:
      if (feedback.action === "accept") {
        task.metadata.currentStep =
          OrchestrationStep.GENERATE_SCRIPT_AND_EXTRACT_ENTITIES;
        await continueOrchestration(task, io);
      } else if (feedback.action === "retry" || feedback.action === "modify") {
        await continueOrchestration(task, io, feedback.newInput);
      }
      break;
    case OrchestrationStep.GENERATE_SCRIPT_AND_EXTRACT_ENTITIES:
      if (feedback.action === "accept") {
        task.metadata.currentStep = OrchestrationStep.GENERATE_IMAGES;
        await continueOrchestration(task, io);
      } else if (feedback.action === "retry" || feedback.action === "modify") {
        await continueOrchestration(task, io, feedback.newInput);
      }
      break;
    case OrchestrationStep.GENERATE_IMAGES:
      if (feedback.action === "accept") {
        task.metadata.currentStep = OrchestrationStep.GENERATE_VIDEO_CLIPS;
        await continueOrchestration(task, io);
      } else if (feedback.action === "retry" || feedback.action === "modify") {
        await continueOrchestration(task, io, feedback.newInput);
      }
      break;
    case OrchestrationStep.GENERATE_VIDEO_CLIPS:
      if (feedback.action === "accept") {
        task.metadata.currentStep = OrchestrationStep.COMPILE_AND_UPLOAD_VIDEO;
        await continueOrchestration(task, io);
      } else if (feedback.action === "retry" || feedback.action === "modify") {
        await continueOrchestration(task, io, feedback.newInput);
      }
      break;
    case OrchestrationStep.COMPILE_AND_UPLOAD_VIDEO:
      if (feedback.action === "accept") {
        task.metadata.currentStep = OrchestrationStep.COMPLETED;
        await continueOrchestration(task, io);
      } else if (feedback.action === "retry" || feedback.action === "modify") {
        await continueOrchestration(task, io, feedback.newInput);
      }
      break;
    default:
      await continueOrchestration(task, io);
      break;
  }
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
  task.metadata = {
    ...task.metadata,
    currentStep: OrchestrationStep.GENERATE_SONG,
  };
  await taskStore.updateTask(task);
  await continueOrchestration(task, io);
}

/**
 * Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @param {OrchestrationIO} io - Communication interface for progress and user input
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration_old(
  input: { prompt: string; style?: string; contextId?: string },
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
