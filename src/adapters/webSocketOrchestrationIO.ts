/**
 * @file webSocketOrchestrationIO.ts
 * @description OrchestrationIO implementation for WebSocket communication with the user.
 */

import { OrchestrationIO } from "../interfaces/orchestrationIO";
import { sendToUser } from "./websocketService";
import { waitForUserInput } from "../store/userInputWaitStore";
import { TaskState } from "../models/task";

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
  private sessionId: string;

  /**
   * @constructor
   * @param {string} sessionId - The session identifier for the user connection.
   */
  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * @method onProgress
   * @description Sends progress updates to the user via WebSocket.
   * @param {ProgressUpdate} progress - Progress information (state, message, artifacts).
   */
  async onProgress(progress: ProgressUpdate): Promise<void> {
    sendToUser(this.sessionId, {
      type: "progress",
      state: progress.state,
      message: progress.message,
      artifacts: progress.artifacts,
    });
  }

  /**
   * @method onInputRequired
   * @description Sends an input request to the user and waits for their response via WebSocket.
   * @param {string} prompt - The prompt/question for the user.
   * @param {any[]} [artifacts] - Optional artifacts to send with the prompt.
   * @returns {Promise<any>} - Resolves with the user's input.
   */
  async onInputRequired(prompt: string, artifacts?: any[]): Promise<any> {
    sendToUser(this.sessionId, {
      type: "input_required",
      prompt,
      artifacts,
    });
    return await waitForUserInput(this.sessionId);
  }
}
