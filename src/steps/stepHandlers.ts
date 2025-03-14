import fs from "fs";
import path from "path";
import { S3 } from "aws-sdk";
import ffmpeg from "fluent-ffmpeg";
import { logger } from "../logger/logger";
import { logMessage } from "../utils/logMessage";
import { hasSongMetadata, getVideoDuration } from "../utils/utils";
import { AgentExecutionStatus, generateStepId } from "@nevermined-io/payments";

import {
  MUSIC_SCRIPT_GENERATOR_DID,
  SONG_GENERATOR_DID,
  VIDEO_GENERATOR_DID,
  SONG_GENERATOR_PLAN_DID,
  MUSIC_SCRIPT_GENERATOR_PLAN_DID,
  VIDEO_GENERATOR_PLAN_DID,
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
} from "../config/env";

import { ensureSufficientBalance } from "../payments/ensureBalance";
import {
  validateMusicScriptTask,
  validateSongGenerationTask,
  validateImageGenerationTask,
  validateVideoGenerationTask,
} from "./taskValidation";

/* -------------------------------------
   Helper Functions
------------------------------------- */

/**
 * Updates the given step to a failure status with the provided error message.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @param errorMessage - The error message to output.
 * @returns {Promise<void>}
 */
async function updateStepFailure(
  step: any,
  payments: any,
  errorMessage: string
): Promise<void> {
  await logMessage(payments, {
    task_id: step.task_id,
    level: "error",
    message: errorMessage,
  });

  await payments.query.updateStep(step.did, {
    ...step,
    step_status: AgentExecutionStatus.Failed,
    output: errorMessage,
  });
}

/**
 * Generic retry helper.
 * Tries the given operation. If it fails, retries up to maxRetries times before finally rejecting.
 *
 * @param operation - A function returning a promise.
 * @param maxRetries - Maximum number of additional attempts (default is 2).
 * @returns {Promise<T>} - The resolved value from the operation.
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      attempt++;
    }
  }
  throw new Error("Unreachable code in retryOperation");
}

/**
 * Executes a task using payments.query.createTask and validates it via the provided validation function.
 *
 * @param payments - The Payments instance.
 * @param agentDid - The DID of the external agent.
 * @param taskData - The data payload for creating the task.
 * @param accessConfig - The access configuration for the agent.
 * @param validationFn - A function that validates the task output. It receives (taskId, agentDid, accessConfig, step, payments) and returns a promise with the validated artifacts.
 * @param step - The current step object.
 * @returns {Promise<any>} - A promise that resolves with the validated task artifacts.
 */
async function executeTaskWithValidation(
  payments: any,
  agentDid: string,
  taskData: any,
  accessConfig: any,
  validationFn: (
    taskId: string,
    agentDid: string,
    accessConfig: any,
    step: any,
    payments: any
  ) => Promise<any>,
  step: any
): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const result = await payments.query.createTask(
      agentDid,
      taskData,
      accessConfig,
      async (cbData: any) => {
        try {
          const taskLog = JSON.parse(cbData);
          if (taskLog.task_status === AgentExecutionStatus.Completed) {
            const artifacts = await validationFn(
              taskLog.task_id,
              agentDid,
              accessConfig,
              step,
              payments
            );
            resolve(artifacts);
          } else if (taskLog.task_status === AgentExecutionStatus.Failed) {
            reject(
              new Error(`Task failed with status: ${taskLog.task_status}`)
            );
          }
        } catch (err) {
          reject(err);
        }
      }
    );
    if (result.status !== 201) {
      reject(new Error(`Error creating task: ${JSON.stringify(result.data)}`));
    }
  });
}

/* -------------------------------------
   Main Event Handler
------------------------------------- */

/**
 * Processes incoming steps. This function is subscribed to "step-updated" events and routes
 * the step to the appropriate handler based on the step name.
 *
 * @param payments - The Payments instance.
 * @returns {(data: any) => Promise<void>} - An asynchronous function that processes incoming step events.
 */
export function processSteps(payments: any) {
  return async (data: any) => {
    const eventData = JSON.parse(data);
    logger.info(
      `(Music Orchestrator) Received event: ${JSON.stringify(eventData)}`
    );

    const step = await payments.query.getStep(eventData.step_id);

    // Only process steps that are Pending
    if (step.step_status !== AgentExecutionStatus.Pending) {
      logger.warn(`Step ${step.step_id} is not in Pending status. Skipping...`);
      return;
    }

    // Use a mapping of step names to handler functions for cleaner routing.
    const handlers: { [key: string]: Function } = {
      init: handleInitStep,
      callSongGenerator: handleCallSongGenerator,
      generateMusicScript: handleGenerateMusicScript,
      callImagesGenerator: handleCallImagesGenerator,
      callVideoGenerator: handleCallVideoGenerator,
      compileVideo: handleCompileVideo,
    };

    const handler = handlers[step.name];
    if (handler) {
      await handler(step, payments);
    } else {
      logger.warn(`Unrecognized step name: ${step.name}`);
    }
  };
}

/* -------------------------------------
   Step Handlers
------------------------------------- */

/**
 * Handles the "init" step by creating the entire workflow pipeline.
 *
 * @param step - The current step object for initialization.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when the workflow steps have been created and the init step is updated.
 */
export async function handleInitStep(step: any, payments: any) {
  const songStepId = generateStepId();
  const scriptStepId = generateStepId();
  const imagesStepId = generateStepId();
  const videoStepId = generateStepId();
  const compileStepId = generateStepId();

  const steps = [
    {
      step_id: songStepId,
      task_id: step.task_id,
      predecessor: step.step_id,
      name: "callSongGenerator",
      is_last: false,
    },
    {
      step_id: scriptStepId,
      task_id: step.task_id,
      predecessor: songStepId,
      name: "generateMusicScript",
      is_last: false,
    },
    {
      step_id: imagesStepId,
      task_id: step.task_id,
      predecessor: scriptStepId,
      name: "callImagesGenerator",
      is_last: false,
    },
    {
      step_id: videoStepId,
      task_id: step.task_id,
      predecessor: imagesStepId,
      name: "callVideoGenerator",
      is_last: false,
    },
    {
      step_id: compileStepId,
      task_id: step.task_id,
      predecessor: videoStepId,
      name: "compileVideo",
      is_last: true,
    },
  ];

  await logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating steps for task ${step.task_id}: ${steps
      .map((s) => s.name)
      .join(", ")}`,
  });

  await payments.query.createSteps(step.did, step.task_id, { steps });

  // Mark the init step as completed.
  await payments.query.updateStep(step.did, {
    ...step,
    step_status: AgentExecutionStatus.Completed,
    output: step.input_query,
  });
}

/**
 * Invokes the Song Generator Agent to generate a song based on the provided prompt and optional lyrics.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when the song generation task completes or fails.
 */
export async function handleCallSongGenerator(step: any, payments: any) {
  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating task for Song Generator Agent with prompt: "${step.input_query}"`,
  });

  const hasBalance = await ensureSufficientBalance(
    SONG_GENERATOR_PLAN_DID,
    step,
    payments
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    SONG_GENERATOR_DID
  );
  const prompt = step.input_query;
  const input_artifacts = hasSongMetadata(step) ? step.input_artifacts : [];
  const taskData = {
    input_query: prompt,
    name: step.name,
    input_artifacts,
  };

  try {
    await retryOperation(
      () =>
        executeTaskWithValidation(
          payments,
          SONG_GENERATOR_DID,
          taskData,
          accessConfig,
          validateSongGenerationTask,
          step
        ),
      2
    );
  } catch (error: any) {
    await updateStepFailure(
      step,
      payments,
      `Song generation task failed: ${error.message || error}`
    );
  }
}

/**
 * Handles the generation of a music script by invoking the Music Script Generator Agent.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when the music script generation task completes or fails.
 */
export async function handleGenerateMusicScript(step: any, payments: any) {
  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating task for Music Script Generator Agent with input_query: "${step.input_query}"`,
  });

  const hasBalance = await ensureSufficientBalance(
    MUSIC_SCRIPT_GENERATOR_PLAN_DID,
    step,
    payments
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    MUSIC_SCRIPT_GENERATOR_DID
  );
  const taskData = {
    input_query: step.input_query,
    name: step.name,
    input_artifacts: step.input_artifacts,
  };

  try {
    await retryOperation(
      () =>
        executeTaskWithValidation(
          payments,
          MUSIC_SCRIPT_GENERATOR_DID,
          taskData,
          accessConfig,
          validateMusicScriptTask,
          step
        ),
      2
    );
  } catch (error: any) {
    await updateStepFailure(
      step,
      payments,
      `Music script task failed: ${error.message || error}`
    );
  }
}

/**
 * Invokes the Images Generator Agent to generate images for characters and settings.
 *
 * @param step - The current step object.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when all image generation tasks complete or fail.
 */
export async function handleCallImagesGenerator(step: any, payments: any) {
  const [{ characters, settings, duration, songUrl, prompts, title }] =
    step.input_artifacts;

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating image generation tasks for ${characters.length} characters and ${settings.length} settings...`,
  });

  const hasBalance = await ensureSufficientBalance(
    VIDEO_GENERATOR_PLAN_DID,
    step,
    payments,
    characters.length + settings.length
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    VIDEO_GENERATOR_DID
  );

  /**
   * Creates an image generation task for a given subject.
   *
   * @param subject - The subject object (character or setting).
   * @param subjectType - The type of the subject, either "character" or "setting".
   * @returns {Promise<any>} - A promise that resolves with the validated task artifacts.
   */
  async function createImageTask(
    subject: any,
    subjectType: "character" | "setting"
  ): Promise<any> {
    const taskData = {
      name: step.name,
      input_query: subject.imagePrompt,
      input_artifacts: [{ inference_type: "text2image" }],
    };
    return retryOperation(
      () =>
        executeTaskWithValidation(
          payments,
          VIDEO_GENERATOR_DID,
          taskData,
          accessConfig,
          (taskId, agentDid, accessCfg, _step, payments) =>
            validateImageGenerationTask(
              taskId,
              agentDid,
              accessCfg,
              payments,
              subject.id || subject.name,
              subjectType
            ),
          step
        ),
      2
    );
  }

  try {
    const charactersPromises = characters.map((character: any) =>
      createImageTask(character, "character")
    );
    const settingsPromises = settings.map((setting: any) =>
      createImageTask(setting, "setting")
    );

    const results = await Promise.all([
      ...charactersPromises,
      ...settingsPromises,
    ]);

    // Update the subjects with their generated image URL.
    results.forEach((result) => {
      if (result.subjectType === "character") {
        const char = characters.find((c: any) => c.name === result.id);
        if (char) char.imageUrl = result.url;
      } else if (result.subjectType === "setting") {
        const sett = settings.find((s: any) => s.id === result.id);
        if (sett) sett.imageUrl = result.url;
      }
    });

    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `All image generation tasks completed successfully: 
        characters:
        ${characters.map((c: any) => c.imageUrl).join(", ")}
        settings:
        ${settings.map((s: any) => s.imageUrl).join(", ")}`,
    });

    await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      output: "All image generation tasks completed",
      output_artifacts: [
        { characters, settings, duration, songUrl, prompts, title },
      ],
    });
  } catch (error: any) {
    logger.error(
      `Image generation failed: ${error.message || error}. Aborting task`
    );
    await updateStepFailure(
      step,
      payments,
      `Image generation failed: ${error.message || error}`
    );
  }
}

/**
 * Creates a video generation task for a single prompt.
 *
 * This function performs one attempt to create a task. If any error occurs,
 * it is thrown so that the caller (using retryOperation) can retry as needed.
 *
 * @param promptObject - The prompt object containing video generation parameters.
 * @param settings - Array of available setting objects.
 * @param characters - Array of available character objects.
 * @param accessConfig - The access configuration for the Video Generator Agent.
 * @param payments - The Payments instance.
 * @param step - The current step object.
 * @returns {Promise<any>} - A promise resolving with validated task artifacts.
 * @throws {Error} - If the task creation or validation fails.
 */
async function createVideoTaskForPrompt(
  promptObject: any,
  settings: any[],
  characters: any[],
  accessConfig: any,
  payments: any,
  step: any
): Promise<any> {
  // Select a setting: try to match promptObject.settingId; otherwise choose one at random.
  let setting = settings.find((s: any) => s.id === promptObject.settingId);
  if (!setting) {
    setting = settings[Math.floor(Math.random() * settings.length)];
  }
  // Filter characters that are included in the scene.
  const charactersInScene = characters.filter((c: any) =>
    promptObject.charactersInScene.includes(c.name)
  );

  // Build task data.
  const taskData = {
    name: step.name,
    input_query: promptObject.prompt,
    input_artifacts: [
      {
        inference_type: "text2video",
        images: [
          setting.imageUrl,
          ...charactersInScene.map((c: any) => c.imageUrl),
        ],
        duration: promptObject.duration,
      },
    ],
  };

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating video generation task for prompt: "${promptObject.prompt}"`,
  });

  // Attempt to create the task.
  return new Promise<any>((resolve, reject) => {
    payments.query
      .createTask(
        VIDEO_GENERATOR_DID,
        taskData,
        accessConfig,
        async (cbData: any) => {
          try {
            const taskLog = JSON.parse(cbData);
            if (taskLog.task_status === AgentExecutionStatus.Completed) {
              const artifacts = await validateVideoGenerationTask(
                taskLog.task_id,
                VIDEO_GENERATOR_DID,
                accessConfig,
                payments
              );
              resolve(artifacts);
            } else if (taskLog.task_status === AgentExecutionStatus.Failed) {
              reject(new Error(`Task ${taskLog.task_id} failed`));
            }
          } catch (err) {
            reject(err);
          }
        }
      )
      .then((result: any) => {
        if (result.status !== 201) {
          reject(
            new Error(
              `Error creating video generation task: ${JSON.stringify(
                result.data
              )}`
            )
          );
        }
      })
      .catch((err: any) => {
        reject(err);
      });
  });
}
/**
 * Handles video generation tasks for multiple prompts.
 *
 * @param step - The current step data.
 * @param payments - The Payments instance.
 * @returns {Promise<void>} - A promise that resolves when all video tasks complete or fails.
 */
export async function handleCallVideoGenerator(
  step: any,
  payments: any
): Promise<void> {
  const [{ prompts, characters, settings, duration, ...inputArtifacts }] =
    step.input_artifacts;

  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Creating video generation tasks for ${prompts.length} scenes...`,
  });

  const hasBalance = await ensureSufficientBalance(
    VIDEO_GENERATOR_PLAN_DID,
    step,
    payments,
    prompts.length
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    VIDEO_GENERATOR_DID
  );

  // Use retryOperation to handle retries.
  const videoTaskPromises = prompts.map((promptObject: any) =>
    retryOperation(
      () =>
        createVideoTaskForPrompt(
          promptObject,
          settings,
          characters,
          accessConfig,
          payments,
          step
        ),
      2
    )
  );

  try {
    const results = await Promise.all(videoTaskPromises);

    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `All video generation tasks completed successfully:`,
    });

    await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      output: "All video generation tasks completed",
      output_artifacts: [
        { ...inputArtifacts, duration, generatedVideos: results },
      ],
    });
  } catch (error: any) {
    logger.error(
      `Video generation failed: ${error.message || error}. Aborting task`
    );
    await updateStepFailure(
      step,
      payments,
      `Video generation failed: ${error.message || error}`
    );
  }
}

/* -------------------------------------
   Video Compilation Helpers
------------------------------------- */

/**
 * Retrieves durations for a list of video URLs and returns valid videos.
 *
 * @param videoUrls - Array of video URLs.
 * @returns {Promise<Array<{url: string, duration: number}>>} - Array of valid video objects.
 */
async function getValidVideos(
  videoUrls: string[]
): Promise<Array<{ url: string; duration: number }>> {
  const videoList = await Promise.all(
    videoUrls.map(async (videoUrl: string) => {
      try {
        const dur = await getVideoDuration(videoUrl);
        return { url: videoUrl, duration: dur };
      } catch (err) {
        logger.warn(
          `Skipping ${videoUrl}, failed to retrieve duration: ${
            (err as Error).message
          }`
        );
        return null;
      }
    })
  );
  return videoList.filter(
    (v): v is { url: string; duration: number } => v !== null
  );
}

/**
 * Merges multiple video clips using FFmpeg.
 *
 * @param videos - Array of valid video objects.
 * @param outputPath - The temporary output file path.
 * @returns {Promise<void>}
 */
async function mergeVideos(
  videos: Array<{ url: string; duration: number }>,
  outputPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let ffmpegChain = ffmpeg();
    videos.forEach((clip) => {
      ffmpegChain = ffmpegChain.input(clip.url);
    });
    ffmpegChain
      .complexFilter([
        { filter: "concat", options: { n: videos.length, v: 1, a: 0 } },
      ])
      .on("start", (cmd) => {
        logger.info(`FFmpeg merge (video only) started with command: ${cmd}`);
      })
      .on("error", (err) => {
        logger.error(`Error merging videos: ${(err as Error).message}`);
        reject(err);
      })
      .on("end", () => {
        logger.info("Video-only merge completed successfully.");
        resolve();
      })
      .save(outputPath);
  });
}

/**
 * Overlays an audio track onto a video using FFmpeg.
 *
 * @param videoPath - The path of the video file.
 * @param audioUrl - The URL of the audio track.
 * @param outputPath - The final output file path.
 * @returns {Promise<void>}
 */
async function addAudioToVideo(
  videoPath: string,
  audioUrl: string,
  outputPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioUrl)
      .videoCodec("copy")
      .audioCodec("aac")
      .on("start", (cmd) => {
        logger.info(`FFmpeg final merge (audio) started with command: ${cmd}`);
      })
      .on("error", (err) => {
        logger.error(`Error adding audio track: ${(err as Error).message}`);
        reject(err);
      })
      .on("end", () => {
        logger.info("Final video with audio merged successfully.");
        resolve();
      })
      .save(outputPath);
  });
}

/**
 * Uploads a video file to S3 and returns its public URL.
 *
 * @param filePath - The local file path of the video.
 * @returns {Promise<string>} - The URL of the uploaded video.
 */
async function uploadVideoToS3(
  filePath: string,
  fileName: string
): Promise<string> {
  const s3 = new S3({
    region: AWS_REGION,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  });
  const s3Bucket = "nvm-music-video-swarm-bck";
  const s3Key = path.basename(fileName);
  const fileStream = fs.createReadStream(filePath);
  logger.info(`Uploading final video to S3: ${s3Bucket}/${s3Key}`);
  const uploadResult = await s3
    .upload({
      Bucket: s3Bucket,
      Key: s3Key,
      Body: fileStream,
      ContentType: "video/mp4",
      ACL: "public-read",
    })
    .promise();
  logger.info(`Final video uploaded to S3: ${uploadResult.Location}`);
  return uploadResult.Location;
}

/**
 * Handles the "compileVideo" step by concatenating video clips,
 * overlaying audio, uploading the final output to S3, and updating the step.
 *
 * @param step - The current step data.
 * @param payments - The Payments instance.
 * @returns {Promise<void>}
 */
export async function handleCompileVideo(
  step: any,
  payments: any
): Promise<void> {
  try {
    const [{ generatedVideos, duration, songUrl, title }] =
      step.input_artifacts;
    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Compiling video clips with audio for "${title}"...`,
    });

    if (
      !generatedVideos ||
      !Array.isArray(generatedVideos) ||
      generatedVideos.length === 0
    ) {
      throw new Error("No generated videos found for compilation.");
    }
    if (!duration || duration <= 0) {
      throw new Error("Invalid or missing song duration for compilation.");
    }
    if (!songUrl) {
      throw new Error("No song/audio URL provided for final compilation.");
    }

    const validVideos = await getValidVideos(generatedVideos);
    if (validVideos.length === 0) {
      throw new Error("No valid videos with durations were found.");
    }

    const tempOutputPath = path.join(
      "/tmp",
      `final_compilation_${Date.now()}.mp4`
    );
    await mergeVideos(validVideos, tempOutputPath);

    const finalOutputPath = path.join(
      "/tmp",
      `final_with_audio_${Date.now()}.mp4`
    );
    await addAudioToVideo(tempOutputPath, songUrl, finalOutputPath);
    const convertedTitle =
      title.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".mp4";

    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Compilation completed for "${title}". Uploading to S3...`,
    });

    const finalVideoUrl = await uploadVideoToS3(
      finalOutputPath,
      convertedTitle
    );

    await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      output: "Video clip compilation completed",
      output_artifacts: [finalVideoUrl],
    });

    fs.unlinkSync(tempOutputPath);
    fs.unlinkSync(finalOutputPath);
  } catch (err: any) {
    await updateStepFailure(
      step,
      payments,
      `Compilation failed: ${err.message || err}`
    );
  }
}
