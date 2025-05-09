/**
 * Generic client for interacting with any A2A Agent (Song Generator, Script Generator, etc).
 * @module agents/a2aAgentClient
 */

import { AgentCard } from "../types/AgentCard";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../utils/logger";
import http from "http";
import https from "https";
import { URL } from "url";

/**
 * Fetches the Agent Card from any A2A agent.
 * @param {string} agentUrl - Base URL of the agent (e.g. http://localhost:8001)
 * @returns {Promise<AgentCard>}
 */
export async function fetchAgentCard(agentUrl: string): Promise<AgentCard> {
  const url = `${agentUrl}/.well-known/agent.json`;
  Logger.info("[fetchAgentCard] Fetching agent card from", url);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      Logger.error(
        "[fetchAgentCard] Failed to fetch agent card:",
        response.statusText
      );
      throw new Error(`Failed to fetch agent card: ${response.statusText}`);
    }
    const agentCard = await response.json();
    Logger.info(
      "[fetchAgentCard] Successfully fetched agent card:",
      agentCard?.name || agentCard
    );
    return agentCard;
  } catch (error: any) {
    Logger.error("[fetchAgentCard] Error:", error);
    throw error;
  }
}

/**
 * Validates and normalizes the A2A message according to the protocol.
 * @param {any} params Input parameters that may contain the message or the idea
 * @returns {object} Normalized A2A message
 */
function normalizeA2AMessage(params: any): object {
  let message = params.message;
  if (!message) {
    const text = params.idea;
    if (typeof text !== "string" || !text.trim()) {
      Logger.error(
        "[normalizeA2AMessage] Cannot build A2A message: params.idea must be a non-empty string"
      );
      throw new Error(
        "Cannot build A2A message: params.idea must be a non-empty string"
      );
    }
    message = {
      role: "user",
      parts: [{ type: "text", text }],
    };
  } else if (typeof message === "string") {
    message = {
      role: "user",
      parts: [{ type: "text", text: message }],
    };
  } else if (typeof message === "object") {
    if (!message.role) message.role = "user";
    if (!Array.isArray(message.parts)) {
      Logger.error(
        "[normalizeA2AMessage] A2A message must have a 'parts' array"
      );
      throw new Error("A2A message must have a 'parts' array");
    }
    if (message.parts.length > 0) {
      const part = message.parts[0];
      if (part.type === "text" && typeof part.text !== "string") {
        Logger.error(
          "[normalizeA2AMessage] A2A message.parts[0] of type 'text' must have a 'text' field"
        );
        throw new Error(
          "A2A message.parts[0] of type 'text' must have a 'text' field"
        );
      }
    } else {
      Logger.error(
        "[normalizeA2AMessage] A2A message must have at least one part"
      );
      throw new Error("A2A message must have at least one part");
    }
  } else {
    Logger.error(
      "[normalizeA2AMessage] A2A message must be a string or an object"
    );
    throw new Error("A2A message must be a string or an object");
  }
  return message;
}

/**
 * Builds the JSON-RPC 2.0 request body for /tasks/sendSubscribe with SSE notification.
 * @param {any} params Parameters for the agent
 * @returns {object} JSON-RPC request body
 */
function buildJsonRpcRequest(params: any): object {
  const sessionId = uuidv4();
  const requestId = uuidv4();
  const message = normalizeA2AMessage(params);
  return {
    jsonrpc: "2.0",
    id: requestId,
    method: "tasks/sendSubscribe",
    params: {
      sessionId,
      message,
      metadata: params,
      acceptedOutputModes: params.acceptedOutputModes || ["text"],
      notification: {
        mode: "sse",
        eventTypes: ["status_update", "completion", "error"],
      },
    },
  };
}

/**
 * Creates and returns an HTTP(S) request object for SSE communication.
 * @param {string} agentUrl Base URL of the agent
 * @returns {object} { client, url, options }
 */
function createSSERequest(agentUrl: string) {
  const url = new URL("/tasks/sendSubscribe", agentUrl);
  const isHttps = url.protocol === "https:";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
  };
  const client = isHttps ? https : http;
  return { client, url, options };
}

/**
 * Parses a single SSE event block and returns event type and data string.
 * @param {string} rawEvent The raw SSE event string
 * @returns {object} An object containing eventType and data
 */
function parseSSEEvent(rawEvent: string): { eventType: string; data: string } {
  const lines = rawEvent.split("\n");
  let data = "";
  let eventType = "message"; // Default event type per SSE spec

  for (const line of lines) {
    if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    } else if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    }
  }

  return { eventType, data };
}

/**
 * Processes an SSE chunk, accumulating in the buffer and calling onEvent for each parsed event.
 * @param {string} chunk Received SSE chunk
 * @param {object} bufferObj Object with buffer property (to maintain reference)
 * @param {(eventType: string, data: string) => void} onEvent Callback for each parsed SSE event
 */
function processSSEChunk(
  chunk: string,
  bufferObj: { buffer: string },
  onEvent: (eventType: string, data: string) => void
) {
  bufferObj.buffer += chunk;
  let eventEnd;
  while ((eventEnd = bufferObj.buffer.indexOf("\n\n")) !== -1) {
    const rawEvent = bufferObj.buffer.slice(0, eventEnd);
    bufferObj.buffer = bufferObj.buffer.slice(eventEnd + 2);
    const { eventType, data } = parseSSEEvent(rawEvent);
    if (data) {
      onEvent(eventType, data);
    }
  }
}

/**
 * Sends a task to any A2A agent using /tasks/sendSubscribe and processes SSE events from the same connection.
 * @param agentUrl Base URL of the agent (e.g. http://localhost:8001)
 * @param params Parameters for the agent
 * @returns {Promise<any>} Resolves with the final result when the task is completed.
 */
export async function sendTask(agentUrl: string, params: any): Promise<any> {
  Logger.info(
    "[sendTask] Sending task to agent",
    agentUrl,
    "with params:",
    params
  );
  return new Promise((resolve, reject) => {
    const jsonRpcRequest = buildJsonRpcRequest(params);
    const { client, url, options } = createSSERequest(agentUrl);
    const req = client.request(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Server responded with status ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      const bufferObj = { buffer: "" };
      Logger.info(
        "[sendTask] SSE connection established. Waiting for events..."
      );
      res.on("data", (chunk) => {
        processSSEChunk(chunk, bufferObj, (eventType, data) => {
          try {
            const parsed = JSON.parse(data);
            Logger.info(`[sendTask][SSE][${eventType}]`, parsed);

            // Handle based on SSE event type
            if (eventType === "status_update") {
              // Process status update
              // If final is true, resolve the promise as this is the end of the task
              if (parsed?.final === true) {
                resolve(parsed);
              }
            } else if (eventType === "artifact") {
              // Process artifact event
              // Check if this is the last chunk of the artifact
              if (parsed?.artifact?.lastChunk === true) {
                resolve(parsed);
              }
            } else if (eventType === "error") {
              // Reject the promise with the error
              reject(parsed);
            } else if (eventType === "completion") {
              // Handle explicit completion events
              resolve(parsed);
            }
          } catch (err) {
            Logger.error("[sendTask] Failed to parse SSE data:", data, err);
          }
        });
      });
      res.on("end", () => {
        Logger.info("[sendTask] SSE connection closed by server.");
        resolve(null);
      });
      res.on("error", (err) => {
        reject(err);
      });
    });
    req.on("error", (err) => {
      reject(err);
    });
    req.write(JSON.stringify(jsonRpcRequest));
    req.end();
  });
}
