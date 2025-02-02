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
  validateCharacterGenerationTask,
  validateVideoGenerationTask,
} from "./taskValidation";

/**
 * Main event handler for steps. This function is subscribed to "step-updated" events.
 * It routes the step to the appropriate handler based on the step name.
 *
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {(data: any) => Promise<void>} - Returns an async function that processes incoming steps.
 */
export function processSteps(payments: any) {
  return async (data: any) => {
    const eventData = JSON.parse(data);
    logger.info(
      `(Music Orchestrator) Received event: ${JSON.stringify(eventData)}`
    );

    const step = await payments.query.getStep(eventData.step_id);

    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Processing step ${step.step_id} [${step.step_status}]: ${step.name}`,
    });

    // Only process steps that are Pending
    if (step.step_status !== AgentExecutionStatus.Pending) {
      logger.warn(`Step ${step.step_id} is not in Pending status. Skipping...`);
      return;
    }

    // Route step to the corresponding handler
    switch (step.name) {
      case "init":
        await handleInitStep(step, payments);
        break;
      case "callSongGenerator":
        await handleCallSongGenerator(step, payments);
        break;
      case "generateMusicScript":
        await handleGenerateMusicScript(step, payments);
        break;
      case "callCharacterGenerator":
        await handleGenerateCharacters(step, payments);
        break;
      case "callVideoGenerator":
        await handleCallVideoGenerator(step, payments);
        break;
      case "compileVideo":
        await handleCompileVideo(step, payments);
        break;
      default:
        logger.warn(`Unrecognized step name: ${step.name}`);
        break;
    }
  };
}

/**
 * Handles the "init" step, which creates the entire pipeline of subsequent steps.
 *
 * @async
 * @function handleInitStep
 * @param {any} step - The current step data (init step).
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function handleInitStep(step: any, payments: any) {
  const songStepId = generateStepId();
  const scriptStepId = generateStepId();
  const characterStepId = generateStepId();
  const videoStepId = generateStepId();
  const compileStepId = generateStepId();

  // Define the sequential steps
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
      step_id: characterStepId,
      task_id: step.task_id,
      predecessor: scriptStepId,
      name: "callCharacterGenerator",
      is_last: false,
    },
    {
      step_id: videoStepId,
      task_id: step.task_id,
      predecessor: characterStepId,
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

  const createResult = await payments.query.createSteps(
    step.did,
    step.task_id,
    { steps }
  );
  logMessage(payments, {
    task_id: step.task_id,
    level: createResult.status === 201 ? "info" : "error",
    message:
      createResult.status === 201
        ? "Workflow steps created successfully."
        : `Error creating steps: ${JSON.stringify(createResult.data)}`,
  });

  // Mark the init step as completed
  await payments.query.updateStep(step.did, {
    ...step,
    step_status: AgentExecutionStatus.Completed,
    output: step.input_query,
  });
}

/**
 * Invokes the Song Generator Agent.
 *
 * - Accepts a prompt as `step.input_query`.
 * - Optionally receives lyrics from `step.input_artifacts`.
 * - The agent returns in `output_artifacts` an array with a single object:
 *   [
 *     {
 *       tags: string[],
 *       lyrics: string,
 *       title: string,
 *       duration: number,
 *       songUrl: string
 *     }
 *   ]
 *
 * @async
 * @function handleCallSongGenerator
 * @param {any} step - The current step data.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function handleCallSongGenerator(step: any, payments: any) {
  // Ensure we have enough balance on the plan
  const hasBalance = await ensureSufficientBalance(
    SONG_GENERATOR_PLAN_DID,
    step,
    payments
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    SONG_GENERATOR_DID
  );

  // Extract the main prompt from input_query
  const prompt = step.input_query;

  // Optionally parse extra lyrics from input_artifacts
  let artifacts: any[] = [];
  if (hasSongMetadata(step)) {
    artifacts = JSON.parse(step.input_artifacts || "[]");
  }

  const taskData = {
    query: prompt, // Main prompt for the song
    name: step.name,
    artifacts: artifacts,
  };

  logger.info(
    `Creating task for Song Generator Agent with prompt: "${prompt}" and optional lyrics.`
  );

  const result = await payments.query.createTask(
    SONG_GENERATOR_DID,
    taskData,
    accessConfig,
    async (cbData) => {
      const taskLog = JSON.parse(cbData);

      if (taskLog.task_status === AgentExecutionStatus.Completed) {
        await validateSongGenerationTask(
          taskLog.task_id,
          SONG_GENERATOR_DID,
          accessConfig,
          step,
          payments
        );
      }
    }
  );

  logMessage(payments, {
    task_id: step.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Song generation task created successfully (Task ID: ${result.data.task.task_id}).`
        : `Error creating Song Generator Task: ${JSON.stringify(result.data)}`,
  });
}

/**
 * Handles the generation of a music script by calling the Music Script Generator Agent.
 *
 * @async
 * @function handleGenerateMusicScript
 * @param {any} step - The current step data.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function handleGenerateMusicScript(step: any, payments: any) {
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
    query: step.input_query, // Possibly the idea for the music video
    name: step.name,
    additional_params: [],
    artifacts: JSON.parse(step.input_artifacts || "[]"),
  };

  const result = await payments.query.createTask(
    MUSIC_SCRIPT_GENERATOR_DID,
    taskData,
    accessConfig,
    async (cbData) => {
      const taskLog = JSON.parse(cbData);

      if (taskLog.task_status === AgentExecutionStatus.Completed) {
        await validateMusicScriptTask(
          taskLog.task_id,
          MUSIC_SCRIPT_GENERATOR_DID,
          accessConfig,
          step,
          payments
        );
      }
    }
  );

  logMessage(payments, {
    task_id: step.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Music script task created successfully (Task ID: ${result.data.task.task_id}).`
        : `Error querying Music Script Generator: ${JSON.stringify(
            result.data
          )}`,
  });
}

/**
 * Invokes the Character Generator Agent to generate characters for the music video.
 * The number of characters is determined by the step.input_artifacts from the previous step.
 * The agent returns an array of character objects in `output_artifacts`.
 * @async
 * @function handleGenerateCharacters
 * @param {any} step - The current step data.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function handleGenerateCharacters(step: any, payments: any) {
  let artifacts: any[] = [];
  if (step.input_artifacts) {
    logger.info(
      `Parsing input_artifacts for callCharacterGenerator: ${step.input_artifacts}`
    );
    try {
      artifacts = JSON.parse(step.input_artifacts || "[]");
    } catch (err) {
      logger.error(
        "Failed to parse input_artifacts for callCharacterGenerator."
      );
    }
  }
  const [{ characters, duration, songUrl, prompts }] = artifacts;

  // Ensure enough balance for multiple tasks
  const hasBalance = await ensureSufficientBalance(
    VIDEO_GENERATOR_PLAN_DID,
    step,
    payments,
    characters.length || 1
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    VIDEO_GENERATOR_DID
  );

  // Create a task for each character
  const tasksPromises = characters.map(async (character: any) => {
    logger.info(
      `Creating task for Character Generator Agent with character: "${character.name}"`
    );
    return new Promise(async (resolve, reject) => {
      const taskData = {
        name: step.name,
        query: character.image_prompt,
        additional_params: [
          {
            inference_type: "text2image",
          },
        ],
      };

      const createResult = await payments.query.createTask(
        VIDEO_GENERATOR_DID,
        taskData,
        accessConfig,
        async (cbData) => {
          const taskLog = JSON.parse(cbData);
          if (taskLog.task_status === AgentExecutionStatus.Completed) {
            try {
              const artifacts = await validateCharacterGenerationTask(
                taskLog.task_id,
                VIDEO_GENERATOR_DID,
                accessConfig,
                payments
              );
              resolve(artifacts);
            } catch (err2) {
              reject(err2);
            }
          }
        }
      );

      if (createResult.status !== 201) {
        reject(
          `Error creating character generation task: ${JSON.stringify(
            createResult.data
          )}`
        );
      }
    });
  });

  try {
    const results = await Promise.all(tasksPromises);

    //Append to each character its image url
    results.forEach((result, index) => {
      characters[index].imageUrl = result;
    });

    const updateResult = await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      output: "All character generation tasks completed",
      output_artifacts: [
        {
          characters,
          duration,
          songUrl,
          prompts,
        },
      ],
    });

    logMessage(payments, {
      task_id: step.task_id,
      level: updateResult.status === 201 ? "info" : "error",
      message:
        updateResult.status === 201
          ? "Successfully generated all characters."
          : `Error updating step with characters: ${JSON.stringify(
              updateResult.data
            )}`,
    });
  } catch (err) {
    logger.error(`Character generation failed: ${err}`);
    await payments.query.updateStep(step.did, {
      ...step,
      step_status: "Failed",
      output: `Error generating characters: ${err}`,
    });
  }
}

/**
 * Invokes the Video Generator Agent for each prompt in parallel.
 * The number of prompts is determined by the step.input_artifacts from the previous step.
 *
 * @async
 * @function handleCallVideoGenerator
 * @param {any} step - The current step data.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function handleCallVideoGenerator(step: any, payments: any) {
  let artifacts: any[] = [];
  logger.info(
    `Parsing input_artifacts for callVideoGenerator: ${step.input_artifacts}`
  );
  try {
    artifacts = JSON.parse(step.input_artifacts || "[]");
  } catch (err) {
    logger.error("Failed to parse input_artifacts for callVideoGenerator.");
  }

  // Suppose we have an array of prompts for each shot
  const [{ prompts, characters, duration, ...inputArtifacts }] = artifacts;

  //Repeat prompts until we have enough to fill the song duration (each prompt is a 5 seconds video)
  const promptsToFillDuration: any = [];
  let totalPromptsDuration = 0;
  while (totalPromptsDuration < duration) {
    promptsToFillDuration.push(...prompts);
    totalPromptsDuration += prompts.length * 5;
  }

  logger.info(
    `Creating video generation tasks for ${promptsToFillDuration.length} prompts...`
  );

  // Ensure enough balance for multiple tasks
  const hasBalance = await ensureSufficientBalance(
    VIDEO_GENERATOR_PLAN_DID,
    step,
    payments,
    promptsToFillDuration.length
  );
  if (!hasBalance) return;

  const accessConfig = await payments.query.getServiceAccessConfig(
    VIDEO_GENERATOR_DID
  );

  const tasksPromises = promptsToFillDuration.map(async (promptObject) => {
    logger.info(
      `Creating task for Video Generator Agent with prompt: "${JSON.stringify(
        promptObject
      )}"`
    );

    //For each video, collect its image prompt, its video prompt and the character image url for the characters in the scene
    let character = characters.find(
      (character) => character.name === promptObject.charactersInScene[0]
    );
    if (!character) {
      //get a random character
      character = characters[Math.floor(Math.random() * characters.length)];
    }

    return new Promise(async (resolve, reject) => {
      const taskData = {
        name: step.name,
        query: promptObject.imagePrompt,
        additional_params: [
          {
            inference_type: "text2video",
            image_url: character.imageUrl,
            video_prompt: promptObject.videoPrompt,
          },
        ],
      };

      const createResult = await payments.query.createTask(
        VIDEO_GENERATOR_DID,
        taskData,
        accessConfig,
        async (cbData) => {
          const taskLog = JSON.parse(cbData);
          if (taskLog.task_status === AgentExecutionStatus.Completed) {
            try {
              const artifacts = await validateVideoGenerationTask(
                taskLog.task_id,
                VIDEO_GENERATOR_DID,
                accessConfig,
                payments
              );
              resolve(artifacts);
            } catch (err2) {
              reject(err2);
            }
          }
        }
      );

      if (createResult.status !== 201) {
        reject(
          `Error creating video generation task: ${JSON.stringify(
            createResult.data
          )}`
        );
      }
    });
  });

  try {
    const results: any = [];
    for (const res of tasksPromises) {
      results.push(await res());
    }

    const updateResult = await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      output: "All video generation tasks completed",
      output_artifacts: [
        {
          ...inputArtifacts,
          duration,
          generatedVideos: results,
        },
      ],
    });

    logMessage(payments, {
      task_id: step.task_id,
      level: updateResult.status === 201 ? "info" : "error",
      message:
        updateResult.status === 201
          ? "Successfully generated all video prompts."
          : `Error updating step with videos: ${JSON.stringify(
              updateResult.data
            )}`,
    });
  } catch (err) {
    logger.error(`Video generation failed: ${err}`);
    await payments.query.updateStep(step.did, {
      ...step,
      step_status: "Failed",
      output: `Error generating videos: ${err}`,
    });
  }
}

/**
 * Handles the "compileVideo" step, merging multiple video clips to match
 * the song duration and then overlaying the audio track.
 *
 * @async
 * @function handleCompileVideo
 * @param {any} step - The current step data.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function handleCompileVideo(step: any, payments: any) {
  try {
    // 1. Parse the input artifacts to retrieve the required data (song duration, generated videos, etc.)
    // let data: any;
    // try {
    //   data = JSON.parse(step.input_artifacts);
    // } catch (parseErr) {
    //   logger.error(
    //     "Failed to parse input artifacts in compileVideo step:",
    //     parseErr
    //   );
    //   throw parseErr;
    // }
    const [{ generatedVideos, duration, songUrl }] = JSON.parse(
      step.input_artifacts
    );

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

    // 2. Retrieve durations for each video URL
    //    We'll create an array of objects: { url, duration: number }.
    logger.info(`Retrieving durations for ${generatedVideos.length} videos...`);

    const videoList = await Promise.all(
      generatedVideos.map(async (videoUrl: string) => {
        try {
          const dur = await getVideoDuration(videoUrl);
          return { url: videoUrl, duration: dur };
        } catch (err) {
          logger.warn(
            `Skipping ${videoUrl}, failed to retrieve duration: ${err.message}`
          );
          return null; // We'll filter out null below
        }
      })
    );

    // Filter out any null entries (failed to retrieve duration)
    const validVideos = videoList.filter(Boolean) as {
      url: string;
      duration: number;
    }[];

    if (validVideos.length === 0) {
      throw new Error("No valid videos with durations were found.");
    }

    // 3. Build a compilation list until totalVideoTime >= song duration
    let totalVideoTime = 0;
    const compilationList: { url: string; duration: number }[] = [];

    while (totalVideoTime < duration) {
      const randomIndex = Math.floor(Math.random() * validVideos.length);
      const chosen = validVideos[randomIndex];
      if (!chosen || !chosen.url || !chosen.duration) {
        continue;
      }
      compilationList.push(chosen);
      totalVideoTime += chosen.duration;
    }

    logger.info(
      `Selected ${compilationList.length} video segments for final compilation (~${totalVideoTime}s total).`
    );

    // 3. Use Fluent FFmpeg to concatenate these selected video clips into a single video.
    //    Then overlay/merge the audio from songUrl.
    //    NOTE: If songUrl or video URLs are remote, ffmpeg can usually handle them directly,
    //    but for complex scenarios, you may need to download them locally first.

    // Create a temporary file name for the final video
    const outputFileName = `final_compilation_${Date.now()}.mp4`;
    const tempOutputPath = path.join("/tmp", outputFileName);

    // Merge the videos (without audio).
    await new Promise<void>((resolve, reject) => {
      // Start fluent-ffmpeg
      let ffmpegChain = ffmpeg();

      // Add each selected video as input
      compilationList.forEach((clip) => {
        ffmpegChain = ffmpegChain.input(clip.url);
      });

      // Use the concat filter. This example uses the "concat" filter with n inputs.
      // Each input might have different frame rates, resolutions, etc. In real usage,
      // you may need to ensure consistent formats or add scaling filters.
      ffmpegChain
        .complexFilter([
          {
            filter: "concat",
            options: {
              n: compilationList.length,
              v: 1,
              a: 0,
            },
          },
        ])
        .on("start", (cmd) => {
          logger.info(`FFmpeg merge (video only) started with command: ${cmd}`);
        })
        .on("error", (err) => {
          logger.error(`Error merging videos: ${err.message}`);
          reject(err);
        })
        .on("end", () => {
          logger.info("Video-only merge completed successfully.");
          resolve();
        })
        .save(tempOutputPath);
    });

    // Step B: Overlay/merge the audio using a second pass.
    // Alternatively, you could do this in one pass with a more complex filter,
    // but splitting into two can be simpler for demonstration.

    const finalOutputPath = path.join(
      "/tmp",
      `final_with_audio_${Date.now()}.mp4`
    );

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(tempOutputPath) // The merged video
        .input(songUrl) // The generated song
        .videoCodec("copy") // Keep the video stream as-is
        .audioCodec("aac") // Transcode or copy as needed
        .on("start", (cmd) => {
          logger.info(
            `FFmpeg final merge (audio) started with command: ${cmd}`
          );
        })
        .on("error", (err) => {
          logger.error(`Error adding audio track: ${err.message}`);
          reject(err);
        })
        .on("end", () => {
          logger.info("Final video with audio merged successfully.");
          resolve();
        })
        .save(finalOutputPath);
    });

    // 4. Upload finalOutputPath to S3 with public permissions.
    //    (Adjust AWS credentials and S3 settings as needed.)

    const s3 = new S3({
      region: AWS_REGION,
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    });

    const s3Bucket = "nvm-music-video-swarm-bucket";
    const s3Key = `${path.basename(finalOutputPath)}`;

    let finalVideoUrl: string;

    try {
      const fileStream = fs.createReadStream(finalOutputPath);

      logger.info(`Uploading final video to S3: ${s3Bucket}/${s3Key}`);
      const uploadResult = await s3
        .upload({
          Bucket: s3Bucket,
          Key: s3Key,
          Body: fileStream,
          ContentType: "video/mp4",
        })
        .promise();

      finalVideoUrl = uploadResult.Location; // The public URL to the S3 object
      logger.info(`Final video uploaded to S3: ${finalVideoUrl}`);
    } catch (uploadErr) {
      logger.error(`Failed to upload final video to S3: ${uploadErr.message}`);
      throw uploadErr;
    }

    // 5. Update the step as Completed, storing the finalVideoUrl in output_artifacts
    const updateResult = await payments.query.updateStep(step.did, {
      ...step,
      step_status: AgentExecutionStatus.Completed,
      output: "Video clip compilation completed",
      output_artifacts: [finalVideoUrl],
    });

    if (updateResult.status === 201) {
      await logMessage(payments, {
        task_id: step.task_id,
        level: "info",
        message: `Final music video compiled and uploaded: ${finalVideoUrl}`,
      });
      logger.info(`Step updated with final video URL: ${finalVideoUrl}`);
    } else {
      logger.error(`Error updating step: ${JSON.stringify(updateResult.data)}`);
    }

    fs.unlinkSync(tempOutputPath);
    fs.unlinkSync(finalOutputPath);
  } catch (err: any) {
    logger.error(`Error in handleCompileVideo: ${err?.message || err}`);
    // Mark step as Failed
    await payments.query.updateStep(step.did, {
      ...step,
      step_status: "Failed",
      output: `Compilation failed: ${err?.message || err}`,
    });
  }
}
