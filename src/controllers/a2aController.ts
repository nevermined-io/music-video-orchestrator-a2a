/**
 * @file a2aController.ts
 * @description Controller for handling A2A (Agent-to-Agent) interactions
 */

import { Request, Response } from "express";
import { Task, TaskState } from "../models/task";
import { taskStore, taskQueue } from "../tasks/taskContext";
import { ErrorHandler } from "../utils/errorHandler";
import {
  PushNotificationService,
  PushNotificationEvent,
} from "../adapters/pushNotificationService";
import { StreamingService } from "../adapters/streamingService";
import { v4 as uuidv4 } from "uuid";
import { A2AEventType } from "../models/a2aEventType";

/**
 * @class A2AController
 * @description Controls and manages A2A interactions and task processing
 */
export class A2AController {
  private taskStore = taskStore;
  private taskQueue = taskQueue;
  private pushNotificationService: PushNotificationService;
  private streamingService: StreamingService;

  constructor() {
    this.pushNotificationService = new PushNotificationService();
    this.streamingService = new StreamingService();
    this.taskStore.addStatusListener(async (task: Task) => {
      // Notify SSE and webhooks
      const isFinal = [
        TaskState.COMPLETED,
        TaskState.CANCELLED,
        TaskState.FAILED,
      ].includes(task.status.state);
      if (isFinal) {
        const completionEvent: PushNotificationEvent = {
          type: A2AEventType.COMPLETION,
          taskId: task.id,
          timestamp: new Date().toISOString(),
          data: { finalStatus: task.status, artifacts: task.artifacts },
        };
        this.pushNotificationService.notify(task.id, completionEvent);
      } else {
        const event: PushNotificationEvent = {
          type: A2AEventType.STATUS_UPDATE,
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
  public healthCheck = async (_req: Request, res: Response): Promise<void> => {
    res.json({ status: "healthy" });
  };

  /**
   * @method getAgentCard
   * @description Returns the agent's capabilities and metadata
   */
  public getAgentCard = async (_req: Request, res: Response): Promise<void> => {
    res.json({
      name: "Music Video Orchestrator Agent",
      description:
        "Orchestrates the creation of complete music videos from a user prompt, coordinating song, script, and media generation via the A2A protocol. Returns a final video and all intermediate artifacts.",
      url: "http://localhost:8000",
      provider: {
        organization: "Nevermined AG",
        url: "https://nevermined.io",
      },
      version: "1.0.0",
      documentationUrl:
        "https://github.com/nevermined-io/music-video-orchestrator-a2a",
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      authentication: null,
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["application/json", "text/plain"],
      skills: [
        {
          id: "music-video-orchestration",
          name: "Music Video Generation",
          description:
            "Generates a full music video (MP4) from a creative prompt, coordinating song, script, and media generation. Returns the final video and all intermediate artifacts (lyrics, audio, script, images, video clips, IPFS URL).",
          tags: ["music", "video", "orchestration", "a2a", "multimodal"],
          examples: [
            {
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "Create a cyberpunk rap anthem about AI collaboration.",
                },
              ],
            },
            {
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "Make a pop video about summer adventures with robots.",
                },
              ],
            },
          ],
          inputModes: ["text/plain", "application/json"],
          outputModes: ["application/json", "video/mp4", "text/plain"],
          parameters: {
            message: {
              type: "object",
              description:
                "A2A Message object containing the user creative prompt for the music video.",
              properties: {
                role: {
                  type: "string",
                  description: "Role of the sender, usually 'user'.",
                },
                parts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string",
                        enum: ["text"],
                        description: "Type of part, must be 'text'.",
                      },
                      text: {
                        type: "string",
                        description: "Prompt text for the music video.",
                      },
                    },
                    required: ["type", "text"],
                  },
                },
              },
              required: ["role", "parts"],
            },
          },
          returns: {
            type: "object",
            description:
              "Structured result with all generated artifacts and metadata.",
            properties: {
              videoUrl: {
                type: "string",
                description: "IPFS URL of the final video (MP4)",
              },
              lyrics: { type: "string", description: "Generated song lyrics" },
              audioUrl: {
                type: "string",
                description: "URL of the generated audio track",
              },
              script: {
                type: "object",
                description: "Generated script (scenes, characters, settings)",
              },
              images: {
                type: "array",
                items: { type: "string" },
                description: "URLs of generated images",
              },
              videoClips: {
                type: "array",
                items: { type: "string" },
                description: "URLs of generated video clips",
              },
              metadata: {
                type: "object",
                description: "Additional metadata about the process",
              },
            },
          },
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
        res.status(400).json({
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
        res.status(400).json({
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
      // Enqueue the task for processing using TaskQueue
      await this.taskQueue.enqueueTask(task);
      // Respond with the initial task object (status will be updated asynchronously)
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
        res.status(400).json({
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
        res.status(400).json({
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
      // Enqueue the task for processing after subscribing SSE
      this.taskQueue.enqueueTask(task);
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
  public listTasks = async (_req: Request, res: Response): Promise<void> => {
    try {
      const tasks = await this.taskStore.listTasks();
      res.json(tasks);
    } catch (error) {
      ErrorHandler.handleHttpError(error as Error, res);
    }
  };
}
