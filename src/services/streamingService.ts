/**
 * @file streamingService.ts
 * @description Service for handling real-time streaming events using Server-Sent Events (SSE)
 */

import { Response } from "express";
import { Task, TaskState } from "../models/task";
import { A2AEventType } from "../models/a2aEventType";

/**
 * @interface StreamingConnection
 * @description Represents a streaming connection with its configuration
 */
interface StreamingConnection {
  response: Response;
  taskId: string;
}

/**
 * @class StreamingService
 * @description Manages SSE connections and streaming events for real-time task updates
 */
export class StreamingService {
  private connections: Map<string, Set<StreamingConnection>> = new Map();

  /**
   * @method subscribe
   * @description Subscribe a client to streaming events for a task
   */
  public subscribe(taskId: string, res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new Set());
    }
    const connection: StreamingConnection = { response: res, taskId };
    this.connections.get(taskId)?.add(connection);
    res.on("close", () => {
      this.unsubscribe(taskId, res);
    });
  }

  /**
   * @method unsubscribe
   * @description Unsubscribe a client from streaming events
   */
  public unsubscribe(taskId: string, res: Response): void {
    const connections = this.connections.get(taskId);
    if (connections) {
      connections.forEach((conn) => {
        if (conn.response === res) {
          connections.delete(conn);
        }
      });
      if (connections.size === 0) {
        this.connections.delete(taskId);
      }
    }
  }

  /**
   * @method notifyTaskUpdate
   * @description Send a task update to all subscribed clients
   */
  public notifyTaskUpdate(task: Task): void {
    const connections = this.connections.get(task.id);
    if (!connections) return;
    const isFinal = [
      TaskState.COMPLETED,
      TaskState.CANCELLED,
      TaskState.FAILED,
    ].includes(task.status.state);
    const event = {
      id: task.id,
      status: task.status,
      final: isFinal,
    };
    connections.forEach((connection) => {
      connection.response.write(
        `event: ${A2AEventType.STATUS_UPDATE}\ndata: ${JSON.stringify(
          event
        )}\n\n`
      );
      if (isFinal) {
        connection.response.write(
          `event: ${A2AEventType.COMPLETION}\ndata: ${JSON.stringify(
            event
          )}\n\n`
        );
      }
    });
  }

  /**
   * @method notifyError
   * @description Send an error notification to all subscribed clients
   */
  public notifyError(
    taskId: string,
    code: number,
    message: string,
    data?: any
  ): void {
    const connections = this.connections.get(taskId);
    if (!connections) return;
    const event = {
      id: taskId,
      error: { code, message, data },
    };
    connections.forEach((connection) => {
      connection.response.write(
        `event: ${A2AEventType.ERROR}\ndata: ${JSON.stringify(event)}\n\n`
      );
    });
  }
}
