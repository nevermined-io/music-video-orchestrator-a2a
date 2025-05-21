/**
 * Utility for subscribing to A2A task updates via Server-Sent Events (SSE)
 * Follows the robust pattern of the external script for real-time updates.
 * @module core/sseClient
 */

import EventSource from "eventsource";
import { Logger } from "../utils/logger";

/**
 * Subscribes to task updates using Server-Sent Events (SSE)
 * @param {string} taskUrl - The full URL to the task notifications endpoint
 * @param {object} [options] - Optional config (maxConnectionAttempts, reconnectDelay)
 * @returns {Promise<any>} Resolves with the final task result or rejects on error/cancellation
 */
export function subscribeToTaskUpdates(
  taskUrl: string,
  options?: { maxConnectionAttempts?: number; reconnectDelay?: number }
): Promise<any> {
  const maxConnectionAttempts = options?.maxConnectionAttempts ?? 5;
  const reconnectDelay = options?.reconnectDelay ?? 1000;

  return new Promise((resolve, reject) => {
    let lastProgress = 0;
    let lastMessage = "";
    let reconnectAttempts = 0;

    function connect() {
      const eventSource = new EventSource(taskUrl, {
        headers: { Accept: "text/event-stream" },
      });

      eventSource.onopen = () => {
        reconnectAttempts = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const notification = JSON.parse(event.data);

          // Handle status
          if (notification.data?.status?.state) {
            // Check for completion or error states
            if (
              ["completed", "failed", "cancelled"].includes(
                notification.data.status.state
              )
            ) {
              eventSource.close();
              if (notification.data.status.state === "completed") {
                resolve(notification.data);
              } else {
                reject(
                  new Error(
                    `Task ${notification.data.status.state.toLowerCase()}: ${
                      notification.data.error || "Unknown error"
                    }`
                  )
                );
              }
            }
          }

          // Handle progress updates
          if (
            notification.data?.progress &&
            notification.data.progress > lastProgress
          ) {
            lastProgress = notification.data.progress;
          }

          // Handle message updates
          if (notification.data?.parts) {
            const currentMessage = notification.data.parts
              .filter((part: any) => part.type === "text")
              .map((part: any) => part.text)
              .join("\n");
            if (currentMessage && currentMessage !== lastMessage) {
              lastMessage = currentMessage;
            }
          }
        } catch (error) {
          // Optionally log parse errors
        }
      };

      eventSource.onerror = (event) => {
        Logger.error("SSE connection error", event);
        eventSource.close();
        if (reconnectAttempts < maxConnectionAttempts) {
          reconnectAttempts++;
          setTimeout(connect, reconnectDelay);
        } else {
          reject(
            new Error(
              "Max reconnection attempts reached or SSE connection error"
            )
          );
        }
      };
    }

    connect();
  });
}
