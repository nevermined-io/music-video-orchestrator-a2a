/**
 * Script to orchestrate a music video using the Nevermined Orchestrator agent with SSE notifications (A2A JSON-RPC 2.0)
 * This script makes a single POST request to /tasks/sendSubscribe with notification.mode: 'sse',
 * and processes SSE events directly from the response stream.
 *
 * Usage: npx ts-node scripts/e2e-music-video-orchestrator-sse.ts [prompt]
 */

import { v4 as uuidv4 } from "uuid";
import http from "http";
import https from "https";
import { URL } from "url";

// Configuration
const CONFIG = {
  serverUrl: process.env.SERVER_URL || "http://localhost:8000",
  eventTypes: ["status_update", "completion", "artifact_update"],
};

/**
 * Sends a music video orchestration task and processes SSE events from the same connection
 * @param {Object} params Orchestration parameters
 * @param {string} params.prompt The creative prompt for the music video
 * @param {string} [params.sessionId] Optional session ID
 * @returns {Promise<void>}
 */
async function orchestrateMusicVideoWithNotifications(params: {
  prompt: string;
  sessionId?: string;
}): Promise<void> {
  // Build the message according to A2A
  const message = {
    role: "user",
    parts: [{ type: "text", text: params.prompt }],
  };

  // JSON-RPC 2.0 request body with SSE notification
  const jsonRpcRequest = {
    jsonrpc: "2.0",
    id: uuidv4(),
    method: "tasks/sendSubscribe",
    params: {
      id: uuidv4(),
      sessionId: params.sessionId || uuidv4(),
      message,
      notification: {
        mode: "sse",
        eventTypes: CONFIG.eventTypes,
      },
    },
  };

  // Prepare HTTP(S) request options
  const url = new URL("/tasks/sendSubscribe", CONFIG.serverUrl);
  const isHttps = url.protocol === "https:";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
  };

  // Choose http or https module
  const client = isHttps ? https : http;

  // Make the POST request and process SSE events from the response
  await new Promise<void>((resolve, reject) => {
    const req = client.request(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Server responded with status ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let buffer = "";
      console.log("SSE connection established. Waiting for events...");
      res.on("data", (chunk) => {
        buffer += chunk;
        let eventEnd;
        while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);
          processSSEEvent(rawEvent);
        }
      });
      res.on("end", () => {
        console.log("SSE connection closed by server.");
        resolve();
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

/**
 * Parses and processes a single SSE event block
 * @param {string} rawEvent The raw SSE event string
 */
function processSSEEvent(rawEvent: string) {
  const lines = rawEvent.split("\n");
  let eventType = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }
  if (data) {
    try {
      const parsed = JSON.parse(data);
      console.log(`[SSE][${eventType}]`, parsed);
      // Exit if the task is completed, failed, or canceled
      const state = parsed?.result?.status?.state;
      if (
        state === "completed" ||
        state === "failed" ||
        state === "canceled" ||
        eventType === "completion" ||
        eventType === "error"
      ) {
        console.log("Final event received. Exiting.");
        process.exit(0);
      }
    } catch (err) {
      console.error("Failed to parse SSE data:", data, err);
    }
  }
}

// Run the script if called directly
if (require.main === module) {
  const prompt =
    process.argv[2] || "A cyberpunk rap anthem about AI collaboration";
  orchestrateMusicVideoWithNotifications({ prompt })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { orchestrateMusicVideoWithNotifications };
