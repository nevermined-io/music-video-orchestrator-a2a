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

  let lastTaskId: string | undefined;

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
      // Extrae el result según la nueva convención
      const result = parsed?.result;
      const status = result?.status;
      const state = status?.state;
      // Guarda el taskId si viene en el mensaje
      if (result?.id) {
        lastTaskId = result.id;
      }
      // Handle input-required events
      if (state === "input-requireds") {
        // Extrae el prompt del mensaje si existe
        let promptMsg =
          status?.message?.parts?.[0]?.text ||
          "Input required. Please provide feedback (type and press Enter): ";
        console.log("[WS] Prompt shown to user:", promptMsg);
        const userInput = await askUserInput("song");
        // Send the user feedback back to the orchestrator
        const feedbackMsg = {
          jsonrpc: "2.0",
          id: uuidv4(),
          method: "tasks/send",
          params: {
            sessionId,
            message: {
              role: "user",
              parts: [{ type: "text", text: userInput }],
              ...(lastTaskId ? { taskId: lastTaskId } : {}),
            },
          },
        };
        ws.send(JSON.stringify(feedbackMsg));
        console.log("[WS] Sent user feedback:", feedbackMsg);
      }
      // Handle completion/exit
      if (
        state === "completed" ||
        state === "failed" ||
        state === "cancelled"
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
function askUserInput(step: string): string {
  if (step === "song") {
    return "Verse must be shorter and more catchy, like a hymn.";
  } else if (step === "script") {
    return "The script must be more engaging, with more action and drama.";
  } else if (step === "images") {
    return "The images must be more detailed and realistic.";
  } else if (step === "video") {
    return "The video must be more engaging, with more action and drama.";
  }
  return "";
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
