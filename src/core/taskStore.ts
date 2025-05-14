/**
 * @file taskStore.ts
 * @description Storage management for tasks
 */

import { Task } from "../models/task";

/**
 * @typedef {Function} StatusListener
 * @description Function type for task status update listeners
 */
type StatusListener = (task: Task) => Promise<void>;

/**
 * @class TaskStore
 * @description Manages task storage and retrieval
 */
export class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private statusListeners: Set<StatusListener> = new Set();

  /**
   * @method addStatusListener
   * @description Add a listener for task status updates
   */
  public addStatusListener(listener: StatusListener): void {
    this.statusListeners.add(listener);
  }

  /**
   * @method notifyStatusListeners
   * @description Notify all listeners about a task update
   */
  private async notifyStatusListeners(task: Task): Promise<void> {
    await Promise.all(
      Array.from(this.statusListeners).map((listener) => listener(task))
    );
  }

  /**
   * @method createTask
   * @description Create a new task in the store
   */
  public async createTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    await this.notifyStatusListeners(task);
    return task;
  }

  /**
   * @method getTask
   * @description Retrieve a task by ID
   */
  public async getTask(taskId: string): Promise<Task | null> {
    return this.tasks.get(taskId) || null;
  }

  /**
   * @method updateTask
   * @description Update an existing task
   */
  public async updateTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    await this.notifyStatusListeners(task);
    return task;
  }

  /**
   * @method listTasks
   * @description Get all tasks in the store
   */
  public async listTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }
}
