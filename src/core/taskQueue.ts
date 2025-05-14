/**
 * @file taskQueue.ts
 * @description Manages a queue of tasks with retry logic
 */

import { Task } from "../models/task";
import { TaskProcessor } from "./taskProcessor";

/**
 * @class TaskQueue
 * @description Manages task queuing and processing with retry logic
 */
export class TaskQueue {
  private queue: Task[] = [];
  private processing: Set<string> = new Set();

  constructor(
    private taskProcessor: TaskProcessor,
    private maxConcurrent: number = 1
  ) {}

  /**
   * @method enqueueTask
   * @description Add a task to the queue
   */
  public async enqueueTask(task: Task): Promise<void> {
    this.queue.push(task);
    await this.processNextTasks();
  }

  /**
   * @method processNextTasks
   * @description Process next tasks in queue if capacity allows
   */
  private async processNextTasks(): Promise<void> {
    const availableSlots = this.maxConcurrent - this.processing.size;
    for (let i = 0; i < availableSlots && this.queue.length > 0; i++) {
      const task = this.queue.shift();
      if (!task) continue;
      this.processing.add(task.id);
      this.taskProcessor.processTask(task).finally(() => {
        this.processing.delete(task.id);
        this.processNextTasks();
      });
    }
  }
}
