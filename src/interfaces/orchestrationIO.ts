/**
 * @file orchestrationIO.ts
 * @description Interface for orchestration input/output communication.
 */

/**
 * @interface OrchestrationIO
 * @description Interface for orchestration input/output communication.
 */
export interface OrchestrationIO {
  /**
   * Notifies progress to the user.
   * @param progress - Progress data
   */
  onProgress(progress: {
    state: string;
    message: any;
    artifacts?: any[];
  }): Promise<void>;

  /**
   * Requests input from the user and waits for a response.
   * @param prompt - The message to show to the user
   * @param artifacts - Optional artifacts to show
   * @returns The user's response
   */
  onInputRequired(prompt: string, artifacts?: any[]): Promise<any>;
}
