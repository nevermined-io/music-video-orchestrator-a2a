/**
 * Script to orchestrate a music video using the Nevermined Orchestrator agent with WebSocket notifications (A2A JSON-RPC 2.0)
 * This script connects to the WebSocket server, sends the initial orchestration request,
 * and interacts bidirectionally, handling input-required events and sending user feedback.
 *
 * Usage: npx ts-node scripts/e2e-music-video-orchestrator-ws.ts [prompt]
 */

import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";

const CONFIG = {
  wsUrl: process.env.WS_URL || "ws://localhost:8000", // Same port as HTTP server
};

/**
 * Orchestrates a music video using WebSocket for bidirectional communication
 * @param {Object} params Orchestration parameters
 * @param {string} params.prompt The creative prompt for the music video
 * @param {string} [params.sessionId] Optional session ID
 * @returns {Promise<void>}
 */
export async function orchestrateMusicVideoWithWebSocket(params: {
  prompt: string;
  sessionId?: string;
}): Promise<void> {
  const sessionId = params.sessionId || uuidv4();
  const ws = new WebSocket(`${CONFIG.wsUrl}?sessionId=${sessionId}`);

  ws.on("open", () => {
    // Send the initial orchestration request as a JSON-RPC message
    const message = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tasks/send",
      params: {
        sessionId,
        message: {
          role: "user",
          parts: [{ type: "text", text: params.prompt }],
        },
      },
    };
    ws.send(JSON.stringify(message));
    console.log("[WS] Sent orchestration request", message);
  });

  ws.on("message", async (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      console.log("[WS][event]", parsed);
      // Handle input-required events
      if (
        parsed?.type === "input-required" ||
        parsed?.data?.status?.state === "input-required"
      ) {
        // Show the message to the user and wait for input
        const promptMsg =
          parsed.message ||
          parsed.data?.message ||
          "Input required. Please provide feedback (type and press Enter): ";
        const userInput = await askUserInput(promptMsg);
        // Send the user feedback back to the orchestrator
        ws.send(JSON.stringify({ sessionId, input: userInput }));
        console.log("[WS] Sent user feedback:", userInput);
      }
      // Optionally handle completion/exit
      const state =
        parsed?.data?.status?.state || parsed?.result?.status?.state;
      if (
        state === "completed" ||
        state === "failed" ||
        state === "cancelled" ||
        parsed?.type === "completion" ||
        parsed?.type === "error"
      ) {
        console.log("Final event received. Exiting.");
        ws.close();
        process.exit(0);
      }
    } catch (err) {
      console.error("Failed to parse WS data:", data.toString(), err);
    }
  });

  ws.on("close", () => {
    console.log("[WS] Connection closed.");
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err);
    process.exit(1);
  });
}

/**
 * Prompts the user for input via stdin
 * @param {string} prompt The prompt message
 * @returns {Promise<string>} The user input
 */
function askUserInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`\n${prompt}\n> `);
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(data.toString().trim());
    });
  });
}

// Run the script if called directly
if (require.main === module) {
  const prompt =
    process.argv[2] || "A cyberpunk rap anthem about AI collaboration";
  orchestrateMusicVideoWithWebSocket({ prompt }).catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}
