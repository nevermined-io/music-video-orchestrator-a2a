/**
 * @file orchestrationIO.ts
 * @description Interface for orchestration input/output communication.
 */

import { TaskState } from "../models/task";

/**
 * @interface OrchestrationProgress
 * @description Domain model for orchestration progress updates.
 */
export interface OrchestrationProgress {
  state: TaskState;
  text: string;
  artifacts?: any[];
  metadata?: any;
}

/**
 * @interface OrchestrationIO
 * @description Interface for orchestration communication (progress and user input).
 */
export interface OrchestrationIO {
  /**
   * @method onProgress
   * @description Handle a progress update in the orchestration workflow.
   * @param {OrchestrationProgress} progress - The progress update.
   */
  onProgress(progress: OrchestrationProgress): Promise<void>;
}
