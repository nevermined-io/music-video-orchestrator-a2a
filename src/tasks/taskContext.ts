/**
 * @file taskContext.ts
 * @description Shared context for TaskStore, TaskProcessor, and TaskQueue singletons.
 */

import { TaskStore } from "../store/taskStore";
import { TaskProcessor } from "./taskProcessor";
import { TaskQueue } from "./taskQueue";

export const taskStore = new TaskStore();
export const taskProcessor = new TaskProcessor(taskStore);
export const taskQueue = new TaskQueue(taskProcessor, {
  maxConcurrent: 2,
  maxRetries: 3,
  retryDelay: 1000,
});
