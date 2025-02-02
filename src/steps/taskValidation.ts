import { AgentExecutionStatus } from "@nevermined-io/payments";
import { logger } from "../logger/logger";
import { logMessage } from "../utils/logMessage";

/**
 * Validates the result of a song generation task, marking the step as completed with song details.
 *
 * @async
 * @function validateSongGenerationTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that generated the song.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step to update.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function validateSongGenerationTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  parentStep: any,
  payments: any
) {
  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const taskData = taskResult.data;

  let artifacts: any;
  try {
    artifacts = JSON.parse(taskData.task.output_artifacts || "[]");
    if (
      !artifacts[0].title ||
      !artifacts[0].tags ||
      !artifacts[0].lyrics ||
      !artifacts[0].songUrl ||
      !artifacts[0].duration
    ) {
      throw new Error("Missing required song metadata");
    }
  } catch (error) {
    logger.error(`Error parsing song artifacts: ${(error as Error).message}`);
    await payments.query.updateStep(parentStep.did, {
      ...parentStep,
      step_status: AgentExecutionStatus.Failed,
      output: "Missing required song metadata",
      output_artifacts: [],
    });
    return;
  }

  artifacts[0].idea = parentStep.input_query;

  const result = await payments.query.updateStep(parentStep.did, {
    ...parentStep,
    step_status: AgentExecutionStatus.Completed,
    output: artifacts[0].title,
    output_artifacts: artifacts[0] || [],
  });

  logMessage(payments, {
    task_id: parentStep.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Step ${parentStep.step_id} updated with generated song data.`
        : `Error storing generated song data: ${JSON.stringify(result.data)}`,
  });
}

/**
 * Validates the result of a music script generation task, marking the parent step as completed if successful.
 *
 * @async
 * @function validateMusicScriptTask
 * @param {string} taskId - The ID of the sub-task in question.
 * @param {string} agentDid - The DID of the agent that executed the task.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step that initiated this task.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function validateMusicScriptTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  parentStep: any,
  payments: any
) {
  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const taskData = taskResult.data;

  if (taskData.task.task_status !== AgentExecutionStatus.Completed) {
    return;
  }
  const [{ transformedScenes, characters }] = JSON.parse(
    taskData.task.output_artifacts || "[]"
  );
  const { tags, lyrics, duration, songUrl } = JSON.parse(
    parentStep.input_artifacts || "[]"
  );

  const result = await payments.query.updateStep(parentStep.did, {
    ...parentStep,
    step_status: AgentExecutionStatus.Completed,
    output:
      taskData.task.output || "Music script generation encountered an error.",
    output_artifacts: [
      {
        tags,
        lyrics,
        duration,
        songUrl,
        prompts: transformedScenes,
        characters,
      },
    ],
  });

  logMessage(payments, {
    task_id: parentStep.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Parent step ${parentStep.step_id} updated successfully with sub-task ${taskId}.`
        : `Error updating parent step with sub-task ${taskId}: ${JSON.stringify(
            result.data
          )}`,
  });
}
/**
 * Validates the result of a single character image generation task, returning the artifacts produced (e.g., image url).
 *
 * @async
 * @function validateCharacterGenerationTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that generated the image.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step that initiated this task.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<string[]>} - Returns the artifacts array from the image generator (URL, etc.).
 */
export async function validateCharacterGenerationTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  payments: any
): Promise<string[]> {
  logger.info(`Validating image generation task ${taskId}...`);

  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );

  return JSON.parse(taskResult.data.task.output_artifacts)[0];
}

/**
 * Validates the result of a single video generation task, returning the artifacts produced (e.g., video URLs, durations).
 *
 * @async
 * @function validateVideoGenerationTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that generated the video.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<string[]>} - Returns the artifacts array from the video generator (URLs, durations, etc.).
 */
export async function validateVideoGenerationTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  payments: any
): Promise<string[]> {
  logger.info(`Validating video generation task ${taskId}...`);

  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const artifacts = JSON.parse(taskResult.data.task.output_artifacts || "[]");

  return artifacts[0] ?? null;
}

/**
 * Validates the final compilation step that combines video clips and overlays the audio track.
 *
 * @async
 * @function validateCompileVideoTask
 * @param {string} taskId - The ID of the sub-task.
 * @param {string} agentDid - The DID of the agent that performed the compilation.
 * @param {any} accessConfig - The agent's access configuration.
 * @param {any} parentStep - The parent step to update.
 * @param {any} payments - The Nevermined Payments instance.
 * @returns {Promise<void>}
 */
export async function validateCompileVideoTask(
  taskId: string,
  agentDid: string,
  accessConfig: any,
  parentStep: any,
  payments: any
) {
  const taskResult = await payments.query.getTaskWithSteps(
    agentDid,
    taskId,
    accessConfig
  );
  const taskData = taskResult.data;

  if (taskData.task.task_status !== AgentExecutionStatus.Completed) {
    return;
  }

  const result = await payments.query.updateStep(parentStep.did, {
    ...parentStep,
    step_status: AgentExecutionStatus.Completed,
    output: "Final compiled music video ready",
    output_artifacts: taskData.task.output_artifacts || [],
  });

  logMessage(payments, {
    task_id: parentStep.task_id,
    level: result.status === 201 ? "info" : "error",
    message:
      result.status === 201
        ? `Final music video is available at step ${parentStep.step_id}.`
        : `Error storing final music video data: ${JSON.stringify(
            result.data
          )}`,
  });
}
