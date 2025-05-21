/**
 * @file webSocketOrchestrationIO.ts
 * @description OrchestrationIO implementation for WebSocket communication with the user.
 */

import {
  OrchestrationIO,
  OrchestrationProgress,
} from "../interfaces/orchestrationIO";
import { TaskState } from "../models/task";
import { taskStore } from "../tasks/taskContext";
import { v4 as uuidv4 } from "uuid";

/**
 * @typedef {object} ProgressUpdate
 * @property {TaskState} state - The current state of the task.
 * @property {any} message - The message object (role, parts, etc.).
 * @property {any[]} [artifacts] - Optional artifacts related to the task.
 */
export interface ProgressUpdate {
  state: TaskState;
  message: any;
  artifacts?: any[];
}

/**
 * @class WebSocketOrchestrationIO
 * @implements {OrchestrationIO}
 * @description Handles progress and input requests via WebSocket for a given session.
 */
export class WebSocketOrchestrationIO implements OrchestrationIO {
  private taskId: string;

  /**
   * @constructor
   * @param {string} taskId - The task identifier for the current session.
   */
  constructor(taskId: string) {
    this.taskId = taskId;
  }

  /**
   * @method onProgress
   * @description Sends progress updates to the user via WebSocket using JSON-RPC
   * @param {OrchestrationProgress} progress - Progress information to send.
   */
  async onProgress(progress: OrchestrationProgress): Promise<void> {
    const task = await taskStore.getTask(this.taskId);
    if (!task) return;
    const statusUpdate = {
      state: progress.state,
      timestamp: new Date().toISOString(),
      message: progress.text
        ? {
            role: "agent",
            parts: [
              {
                type: "text",
                text: progress.text,
              },
            ],
            messageId: uuidv4(),
          }
        : undefined,
    };
    const updatedTask = {
      ...task,
      status: statusUpdate,
      artifacts: progress.artifacts || task.artifacts,
      history: [...(task.history || []), statusUpdate],
      metadata: {
        ...task.metadata,
        ...progress.metadata,
      },
    };
    await taskStore.updateTask(updatedTask);
  }
}
