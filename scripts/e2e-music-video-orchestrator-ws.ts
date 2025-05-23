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
 * @param {string} [params.contextId] Optional session ID
 * @returns {Promise<void>}
 */
export async function orchestrateMusicVideoWithWebSocket(params: {
  prompt: string;
  contextId?: string;
}): Promise<void> {
  const contextId = params.contextId || uuidv4();
  const ws = new WebSocket(`${CONFIG.wsUrl}?contextId=${contextId}`);

  let lastTaskId: string | undefined;

  ws.on("open", () => {
    // Send the initial orchestration request as a JSON-RPC message
    const message = {
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "tasks/send",
      params: {
        contextId,
        message: {
          role: "user",
          parts: [{ kind: "text", text: params.prompt }],
          messageId: uuidv4(),
          kind: "message",
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
      const result = parsed?.result;
      const status = result?.status;
      const state = status?.state;
      // Read metadata from result or status
      const metadata = result?.metadata || status?.metadata || {};
      const currentStep = metadata.currentStep;

      if (result?.id) {
        lastTaskId = result.id;
      }

      if (state === "input-required") {
        // Generate feedback based on the currentStep
        let userInput;
        switch (currentStep) {
          case "generate_song":
            userInput = "Lyrics must be more catchy and engaging."; // Accept the song
            break;
          case "generate_script_and_extract_entities":
            userInput = "ok"; // Accept the script and entities
            break;
          case "generate_images":
            userInput = "The images must be more detailed and realistic.";
            break;
          case "generate_video_clips":
            userInput =
              "The video must be more engaging, with more action and drama.";
            break;
          default:
            userInput = "ok";
        }

        let promptMsg =
          status?.message?.parts?.[0]?.text ||
          "Input required. Please provide feedback (type and press Enter): ";
        console.log("[WS] Prompt shown to user:", promptMsg);

        const feedbackMsg = {
          jsonrpc: "2.0",
          id: uuidv4(),
          method: "tasks/send",
          params: {
            contextId,
            message: {
              role: "user",
              parts: [{ kind: "text", text: userInput }],
              ...(lastTaskId ? { taskId: lastTaskId } : {}),
              messageId: uuidv4(),
              kind: "message",
            },
          },
        };
        ws.send(JSON.stringify(feedbackMsg));
        console.log("[WS] Sent user feedback:", feedbackMsg);
      }

      if (
        state === "completed" ||
        state === "failed" ||
        state === "canceled" ||
        state === "rejected"
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

// Run the script if called directly
if (require.main === module) {
  const prompt =
    process.argv[2] || "A cyberpunk rap anthem about AI collaboration";
  orchestrateMusicVideoWithWebSocket({ prompt }).catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}
