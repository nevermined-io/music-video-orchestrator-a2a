/**
 * Generic client for interacting with any A2A Agent (Song Generator, Script Generator, etc).
 * @module agents/a2aAgentClient
 */

import { AgentCard } from "../types/AgentCard";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../utils/logger";
import axios from "axios";

/**
 * Fetches the Agent Card from any A2A agent.
 * @param {string} agentUrl - Base URL of the agent (e.g. http://localhost:8000)
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
 * Validates and normalizes the A2A message according to the protocol and the agent's requirements.
 * @param {any} params Input parameters that will be normalized
 * @param {any} agentCard The agent card describing the agent's API
 * @returns {object} Normalized A2A message
 */
function normalizeA2AMessage(params: any, agentCard: any): object {
  // If a message object is already provided, validate it according to A2A protocol
  let message = params.message;
  if (message) {
    if (typeof message === "string") {
      // If message is a string, convert it to proper A2A message object
      message = {
        role: "user",
        parts: [{ type: "text", text: message }],
      };
    } else if (typeof message === "object") {
      // Validate existing message object
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
  } else {
    // No message was provided, so we need to build one from the parameters
    // using the agent card to determine required fields

    // Find the first skill in the agent card
    const skills = agentCard?.skills || [];

    if (skills.length === 0) {
      Logger.error("[normalizeA2AMessage] Agent card has no skills defined");
      throw new Error("Agent card has no skills defined");
    }

    const firstSkill = skills[0];
    const parameters = firstSkill.parameters || [];

    // Try to find a primary text parameter (often 'prompt', 'idea', or similar)
    let primaryTextValue = "";

    // Check if there's a common text parameter with a value
    for (const commonField of [
      "prompt",
      "idea",
      "text",
      "message",
      "query",
      "input",
    ]) {
      if (
        typeof params[commonField] === "string" &&
        params[commonField].trim()
      ) {
        primaryTextValue = params[commonField];
        break;
      }
    }

    // If not found, try to find the first required parameter in the skill
    if (!primaryTextValue) {
      const requiredParams = parameters.filter((p: any) => p.required === true);
      for (const param of requiredParams) {
        if (params[param.name] && typeof params[param.name] === "string") {
          primaryTextValue = params[param.name];
          break;
        }
      }
    }

    // If still not found, just use the first string parameter we can find
    if (!primaryTextValue) {
      for (const key in params) {
        if (typeof params[key] === "string" && params[key].trim()) {
          primaryTextValue = params[key];
          break;
        }
      }
    }

    // If we still can't find a valid text value, construct a JSON representation
    if (!primaryTextValue) {
      try {
        primaryTextValue = JSON.stringify(params, null, 2);
      } catch (e) {
        Logger.error(
          "[normalizeA2AMessage] Failed to build A2A message from parameters"
        );
        throw new Error("Failed to build A2A message from parameters");
      }
    }

    // Build the message using the primary text value
    message = {
      role: "user",
      parts: [{ type: "text", text: primaryTextValue }],
    };

    // Add metadata to preserve all parameters
    message.metadata = { originalParams: params };
  }

  return message;
}

/**
 * Builds the JSON-RPC 2.0 request body for /tasks/send.
 * @param {any} params Parameters for the agent
 * @param {any} agentCard The agent card describing the agent's API
 * @returns {object} JSON-RPC request body
 */
function buildJsonRpcSendRequest(params: any, agentCard: AgentCard): object {
  const sessionId = params.sessionId || uuidv4();
  const requestId = uuidv4();
  const message = normalizeA2AMessage(params, agentCard);

  // Create a shallow copy of params and remove the 'message' field to avoid duplication in metadata
  const paramsForMetadata = { ...params };
  if ("message" in paramsForMetadata) {
    delete paramsForMetadata.message;
  }
  return {
    jsonrpc: "2.0",
    id: requestId,
    method: "tasks/send",
    params: {
      sessionId,
      message,
      metadata: paramsForMetadata,
      acceptedOutputModes: params.acceptedOutputModes || ["text"],
    },
  };
}

/**
 * Sends a task to any A2A agent using /tasks/send and polls for completion.
 * @param agentUrl Base URL of the agent (e.g. http://localhost:8000)
 * @param params Parameters for the agent
 * @param agentCard The agent card describing the agent's API
 * @param pollingInterval Polling interval in ms (default: 2000)
 * @param maxRetries Maximum number of polling attempts (default: 120)
 * @returns {Promise<any>} Resolves with the final result when the task is completed.
 */
export async function sendTask(
  agentUrl: string,
  params: any,
  agentCard: AgentCard,
  pollingInterval = 2000,
  maxRetries = 120
): Promise<any> {
  Logger.info(
    "[sendTask] Sending task to agent",
    agentUrl,
    "with params:",
    params
  );
  // 1. Send the initial task
  const jsonRpcRequest = buildJsonRpcSendRequest(params, agentCard);
  const sendResponse = await axios.post(
    `${agentUrl}/tasks/send`,
    jsonRpcRequest,
    {
      headers: { "Content-Type": "application/json" },
    }
  );
  if (
    !sendResponse.data ||
    !sendResponse.data.result ||
    !sendResponse.data.result.id
  ) {
    throw new Error("Invalid response from agent: missing result.id");
  }
  const taskId = sendResponse.data.result.id;
  Logger.info(`[sendTask] Task created with ID: ${taskId}`);

  // 2. Poll for completion
  let retries = 0;
  let lastState = "";
  while (retries < maxRetries) {
    let statusResponse;
    try {
      statusResponse = await axios.get(`${agentUrl}/tasks/${taskId}`, {
        timeout: 30000,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
          Connection: "close",
        },
      });
    } catch (error) {
      if (error.isAxiosError) {
        Logger.error("Axios error:", {
          message: error.message,
          code: error.code,
          errno: error.errno,
          config: error.config,
          stack: error.stack,
        });
      } else {
        Logger.error("Unknown error:", error);
      }
      throw error;
    }
    const status = statusResponse.data.status.state;
    if (status !== lastState) {
      Logger.info(`[sendTask] Task status: ${status}`);
      lastState = status;
    }
    if (status === "completed") {
      Logger.info("[sendTask] Task completed!");
      return statusResponse.data;
    } else if (status === "failed") {
      throw new Error(
        `[sendTask] Task failed: ${statusResponse.data.status.error}`
      );
    } else if (status === "cancelled") {
      throw new Error("[sendTask] Task was cancelled");
    }
    await new Promise((resolve) => setTimeout(resolve, pollingInterval));
    retries++;
  }
  throw new Error("[sendTask] Timeout waiting for task completion");
}
