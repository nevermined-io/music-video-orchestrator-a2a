/**
 * @file taskProcessor.ts
 * @description Processes tasks and manages their lifecycle for the music video orchestrator
 */

import { Task, TaskState } from "../models/task";
import { TaskStore } from "../store/taskStore";
import { startOrchestration } from "../orchestrator";
import { Logger } from "../utils/logger";
import {
  OrchestrationIO,
  OrchestrationProgress,
} from "../interfaces/orchestrationIO";

/**
 * @class TaskProcessorOrchestrationIO
 * @description Implements OrchestrationIO for TaskProcessor, updating task status and not supporting user input.
 */
class TaskProcessorOrchestrationIO implements OrchestrationIO {
  constructor(
    private task: Task,
    private updateTaskStatus: TaskProcessor["updateTaskStatus"]
  ) {}

  /**
   * @method onProgress
   * @description Handles progress updates using the domain model and translates to protocol message structure.
   * @param {OrchestrationProgress} progress - The progress update.
   */
  async onProgress(progress: OrchestrationProgress): Promise<void> {
    await this.updateTaskStatus(
      this.task,
      progress.state,
      { role: "agent", parts: [{ type: "text", text: progress.text }] },
      progress.artifacts
    );
  }

  async onInputRequired(_prompt: string, _artifacts?: any[]): Promise<any> {
    throw new Error("User input is not supported in this context");
  }
}

/**
 * @class TaskProcessor
 * @description Handles the processing of individual tasks for music video orchestration
 */
export class TaskProcessor {
  constructor(private taskStore: TaskStore) {}

  /**
   * @method processTask
   * @description Process a single task: validate, update status, run orchestration, handle errors
   * @param {Task} task - The task to process.
   * @param {OrchestrationIO} [io] - Optional IO implementation (WebSocket, HTTP, etc.)
   */
  public async processTask(task: Task, io?: OrchestrationIO): Promise<void> {
    try {
      Logger.info(`Processing task ${task.id}`);
      this.validateTask(task);
      const orchestrationIO =
        io ||
        new TaskProcessorOrchestrationIO(
          task,
          this.updateTaskStatus.bind(this)
        );
      await startOrchestration(task, orchestrationIO);
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
