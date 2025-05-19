/**
 * @file taskProcessor.ts
 * @description Processes tasks and manages their lifecycle for the music video orchestrator
 */

import { Task, TaskState } from "../models/task";
import { TaskStore } from "./taskStore";
import { startOrchestration } from "../orchestrator";
import { Logger } from "../utils/logger";

/**
 * @class TaskProcessor
 * @description Handles the processing of individual tasks for music video orchestration
 */
export class TaskProcessor {
  constructor(private taskStore: TaskStore) {}

  /**
   * @method processTask
   * @description Process a single task: validate, update status, run orchestration, handle errors
   */
  public async processTask(task: Task): Promise<void> {
    try {
      Logger.info(`Processing task ${task.id}`);
      this.validateTask(task);
      await this.updateTaskStatus(task, TaskState.WORKING, {
        role: "agent",
        parts: [{ type: "text", text: "Orchestrating music video..." }],
      });
      // Call the main orchestrator
      const prompt = task.message?.parts?.[0]?.text;
      const orchestrationResult = await startOrchestration({ prompt });
      // Save artifacts and result
      await this.updateTaskStatus(
        task,
        TaskState.COMPLETED,
        {
          role: "agent",
          parts: [
            { type: "text", text: "Music video orchestration completed!" },
          ],
        },
        [
          {
            name: "MusicVideoArtifacts.json",
            parts: [{ type: "data", data: orchestrationResult }],
          },
        ]
      );
    } catch (error) {
      Logger.error(
        `Error processing task ${task.id}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      await this.updateTaskStatus(task, TaskState.FAILED, {
        role: "agent",
        parts: [
          {
            type: "text",
            text:
              error instanceof Error
                ? error.message
                : "Unknown error occurred during processing",
          },
        ],
      });
      throw error;
    }
  }

  /**
   * @method validateTask
   * @description Validate task data before processing
   */
  private validateTask(task: Task): void {
    if (!task?.message?.parts) {
      throw new Error("Task message is empty or invalid");
    }
    const textParts = task.message.parts.filter(
      (part: any) =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0
    );
    if (textParts.length === 0) {
      throw new Error("Task must contain a non-empty text prompt");
    }
  }

  /**
   * @method updateTaskStatus
   * @description Update task status and persist changes
   */
  private async updateTaskStatus(
    task: Task,
    state: TaskState,
    message?: any,
    artifacts?: any[]
  ): Promise<void> {
    const currentTask = await this.taskStore.getTask(task.id);
    if (!currentTask) throw new Error(`Task ${task.id} not found`);
    const statusUpdate = {
      state,
      timestamp: new Date().toISOString(),
      message,
    };
    const updatedTask = {
      ...currentTask,
      status: statusUpdate,
      artifacts: artifacts || currentTask.artifacts,
      history: [...(currentTask.history || []), statusUpdate],
    };
    await this.taskStore.updateTask(updatedTask);
  }
}
