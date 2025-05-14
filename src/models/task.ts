/**
 * @file task.ts
 * @description Type definitions for task-related entities
 */

/**
 * @enum TaskState
 * @description Possible states of a task
 */
export enum TaskState {
  SUBMITTED = "submitted",
  WORKING = "working",
  INPUT_REQUIRED = "input-required",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  FAILED = "failed",
}

/**
 * @interface Task
 * @description Represents a task in the system
 */
export interface Task {
  id: string;
  sessionId?: string;
  status: {
    state: TaskState;
    timestamp: string;
    message?: any;
  };
  message: any;
  metadata?: any;
  artifacts?: any[];
  history?: any[];
}
