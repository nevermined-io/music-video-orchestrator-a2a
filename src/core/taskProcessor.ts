/**
 * @file taskProcessor.ts
 * @description Processes tasks and manages their lifecycle
 */

import { Task, TaskState } from "../models/task";
import { TaskStore } from "./taskStore";

/**
 * @class TaskProcessor
 * @description Handles the processing of individual tasks
 */
export class TaskProcessor {
  constructor(private taskStore: TaskStore) {}

  /**
   * @method processTask
   * @description Process a single task (dummy implementation)
   */
  public async processTask(task: Task): Promise<void> {
    // Simulate work
    await this.updateTaskStatus(task, TaskState.WORKING, {
      role: "agent",
      parts: [{ text: "Processing..." }],
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.updateTaskStatus(task, TaskState.COMPLETED, {
      role: "agent",
      parts: [{ text: "Done!" }],
    });
  }

  /**
   * @method updateTaskStatus
   * @description Update task status and persist changes
   */
  private async updateTaskStatus(
    task: Task,
    state: TaskState,
    message?: any
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
      history: [...(currentTask.history || []), statusUpdate],
    };
    await this.taskStore.updateTask(updatedTask);
  }
}
