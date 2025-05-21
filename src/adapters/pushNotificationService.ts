/**
 * @file pushNotificationService.ts
 * @description Service for handling push notifications using Server-Sent Events (SSE) and webhooks
 */

import { Response } from "express";
import { A2AEventType } from "../models/a2aEventType";

/**
 * @interface PushNotificationEvent
 * @description Structure of a push notification event
 */
export interface PushNotificationEvent {
  type: A2AEventType;
  taskId: string;
  timestamp: string;
  data: any;
}

/**
 * @interface PushNotificationConfig
 * @description Configuration for push notification subscriptions
 */
export interface PushNotificationConfig {
  taskId: string;
  eventTypes: A2AEventType[];
  webhookUrl?: string;
}

/**
 * @class PushNotificationService
 * @description Manages SSE connections and push notifications
 */
export class PushNotificationService {
  private connections: Map<string, Set<Response>> = new Map();
  private subscriptions: Map<string, PushNotificationConfig> = new Map();

  /**
   * @method subscribeSSE
   * @description Subscribe a client to SSE notifications for a task
   */
  public subscribeSSE(
    taskId: string,
    res: Response,
    config: PushNotificationConfig
  ): void {
    if (!config.eventTypes || config.eventTypes.length === 0) {
      config.eventTypes = [
        A2AEventType.STATUS_UPDATE,
        A2AEventType.ARTIFACT,
        A2AEventType.ERROR,
        A2AEventType.COMPLETION,
      ];
    }
    this.subscriptions.set(taskId, config);
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new Set());
    }
    this.connections.get(taskId)?.add(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(
      `event: ${A2AEventType.STATUS_UPDATE}\ndata: ${JSON.stringify({
        status: "connected",
      })}\n\n`
    );
    res.on("close", () => {
      this.unsubscribe(taskId, res);
    });
  }

  /**
   * @method subscribeWebhook
   * @description Register a webhook for push notifications for a task
   */
  public async subscribeWebhook(
    taskId: string,
    config: PushNotificationConfig
  ): Promise<void> {
    if (!config.eventTypes || config.eventTypes.length === 0) {
      config.eventTypes = [
        A2AEventType.STATUS_UPDATE,
        A2AEventType.ARTIFACT,
        A2AEventType.ERROR,
        A2AEventType.COMPLETION,
      ];
    }
    this.subscriptions.set(taskId, config);
  }

  /**
   * @method unsubscribe
   * @description Unsubscribe a client from push notifications
   */
  public unsubscribe(taskId: string, res: Response): void {
    const connections = this.connections.get(taskId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        this.connections.delete(taskId);
        this.subscriptions.delete(taskId);
      }
    }
  }

  /**
   * @method notify
   * @description Send a notification to all subscribed clients for a task
   */
  public notify(taskId: string, event: PushNotificationEvent): void {
    const connections = this.connections.get(taskId);
    const config = this.subscriptions.get(taskId);
    if (!config) return;
    if (config.eventTypes.includes(event.type)) {
      if (connections) {
        connections.forEach((res) => {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });
      }
      if (config.webhookUrl) {
        this.sendWebhookNotification(config.webhookUrl, event);
      }
    }
  }

  /**
   * @private
   * @method sendWebhookNotification
   * @description Send a notification to a webhook URL
   */
  private async sendWebhookNotification(
    webhookUrl: string,
    event: PushNotificationEvent
  ): Promise<void> {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch (error) {
      // Log error if needed
    }
  }
}
