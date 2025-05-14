/**
 * @file a2aController.ts
 * @description Controller for handling A2A (Agent-to-Agent) interactions
 */

import { Request, Response } from "express";
import { Task, TaskState } from "../models/task";
import { TaskStore } from "../core/taskStore";
import { SessionManager } from "../core/sessionManager";
import { ErrorHandler } from "../core/errorHandler";
import { TaskProcessor } from "../core/taskProcessor";
import { TaskQueue } from "../core/taskQueue";
import {
  PushNotificationService,
  PushNotificationEventType,
  PushNotificationEvent,
} from "../services/pushNotificationService";
import { StreamingService } from "../services/streamingService";
import { v4 as uuidv4 } from "uuid";

/**
 * @class A2AController
 * @description Controls and manages A2A interactions and task processing
 */
export class A2AController {
  private taskStore: TaskStore;
  private sessionManager: SessionManager;
  private taskProcessor: TaskProcessor;
  private taskQueue: TaskQueue;
  private pushNotificationService: PushNotificationService;
  private streamingService: StreamingService;

  constructor() {
    this.taskStore = new TaskStore();
    this.sessionManager = new SessionManager();
    this.taskProcessor = new TaskProcessor(this.taskStore);
    this.taskQueue = new TaskQueue(this.taskProcessor, 2);
    this.pushNotificationService = new PushNotificationService();
    this.streamingService = new StreamingService();
    this.taskStore.addStatusListener(async (task: Task) => {
      // Notificar SSE y webhooks
      const isFinal = [
        TaskState.COMPLETED,
        TaskState.CANCELLED,
        TaskState.FAILED,
      ].includes(task.status.state);
      if (isFinal) {
        const completionEvent: PushNotificationEvent = {
          type: PushNotificationEventType.COMPLETION,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: { finalStatus: task.status, artifacts: task.artifacts },
        };
        this.pushNotificationService.notify(task.id, completionEvent);
      } else {
        const event: PushNotificationEvent = {
          type: PushNotificationEventType.STATUS_UPDATE,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: { status: task.status, artifacts: task.artifacts },
        };
        this.pushNotificationService.notify(task.id, event);
      }
      this.streamingService.notifyTaskUpdate(task);
    });
  }

  /**
   * @method healthCheck
   * @description Check service health
   */
  public healthCheck = async (req: Request, res: Response): Promise<void> => {
    res.json({ status: "healthy" });
  };

  /**
   * @method getAgentCard
   * @description Returns the agent's capabilities and metadata
   */
  public getAgentCard = async (req: Request, res: Response): Promise<void> => {
    res.json({
      name: "A2A Example Agent",
      description: "A simple A2A agent example.",
      url: "http://localhost:8001",
      version: "1.0.0",
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["application/json", "text/plain"],
      skills: [
        {
          id: "echo",
          name: "Echo",
          description: "Echoes the input text.",
          tags: ["echo"],
          examples: ["Say hello"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
        },
      ],
    });
  };

  /**
   * @method sendTask
   * @description Handle JSON-RPC 2.0 A2A task send (single-turn)
   */
  public sendTask = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jsonrpc, id, method, params } = req.body;
      if (jsonrpc !== "2.0" || !id || !method || !params) {
        res
          .status(400)
          .json({
            jsonrpc: "2.0",
            id: id || null,
            error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
          });
        return;
      }
      const { message, sessionId, metadata } = params;
      if (
        !message ||
        !message.parts ||
        !message.parts[0] ||
        !message.parts[0].text
      ) {
        res
          .status(400)
          .json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Task must contain a non-empty message text",
            },
          });
        return;
      }
      const task: Task = {
        id: uuidv4(),
        sessionId,
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        },
        message,
        metadata,
      };
      await this.taskStore.createTask(task);
      await this.taskQueue.enqueueTask(task);
      res.json({ jsonrpc: "2.0", id, result: task });
    } catch (error) {
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };

  /**
   * @method sendTaskSubscribe
   * @description Handle JSON-RPC 2.0 A2A task send with subscription (SSE or webhook)
   */
  public sendTaskSubscribe = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { jsonrpc, id, method, params } = req.body;
      if (jsonrpc !== "2.0" || !id || !method || !params) {
        res
          .status(400)
          .json({
            jsonrpc: "2.0",
            id: id || null,
            error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
          });
        return;
      }
      const { message, sessionId, metadata, notification } = params;
      if (
        !message ||
        !message.parts ||
        !message.parts[0] ||
        !message.parts[0].text
      ) {
        res
          .status(400)
          .json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Task must contain a non-empty message text",
            },
          });
        return;
      }
      const task: Task = {
        id: uuidv4(),
        sessionId,
        status: {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        },
        message,
        metadata,
      };
      await this.taskStore.createTask(task);
      await this.taskQueue.enqueueTask(task);
      // Notification mode: webhook or SSE
      const mode = notification?.mode || "sse";
      const eventTypes = notification?.eventTypes || [];
      if (mode === "webhook" && notification?.url) {
        await this.pushNotificationService.subscribeWebhook(task.id, {
          taskId: task.id,
          webhookUrl: notification.url,
          eventTypes,
        });
        res.json({ jsonrpc: "2.0", id, result: { taskId: task.id } });
        return;
      }
      // Default: SSE mode (keep connection open)
      this.pushNotificationService.subscribeSSE(task.id, res, {
        taskId: task.id,
        eventTypes,
      });
    } catch (error) {
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };

  /**
   * @method getTaskStatus
   * @description Get status of a specific task
   */
  public getTaskStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await this.taskStore.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json(task);
    } catch (error) {
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };

  /**
   * @method listTasks
   * @description List all tasks
   */
  public listTasks = async (req: Request, res: Response): Promise<void> => {
    try {
      const tasks = await this.taskStore.listTasks();
      res.json(tasks);
    } catch (error) {
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };
}
