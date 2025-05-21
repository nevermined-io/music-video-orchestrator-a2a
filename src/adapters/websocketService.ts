/**
 * @file websocketService.ts
 * @description WebSocket service for bidirectional communication with users.
 */

import WebSocket from "ws";
import { SessionManager } from "../store/sessionConnectionStore";
import { resolveUserInput } from "../store/userInputWaitStore";

const wss = new WebSocket.Server({ noServer: true });
const sessionManager = new SessionManager();

wss.on("connection", (ws: WebSocket, req) => {
  // Extract sessionId from query params
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    ws.close();
    return;
  }
  // Store the WebSocket in the session
  sessionManager.updateSession(sessionId, { ws });

  ws.on("message", (message) => {
    try {
      const { sessionId, input } = JSON.parse(message.toString());
      resolveUserInput(sessionId, input);
    } catch (e) {
      // Handle parse errors
    }
  });

  ws.on("close", () => {
    sessionManager.updateSession(sessionId, { ws: undefined });
  });
});

/**
 * Sends a message to the user via WebSocket.
 * @param {string} sessionId - The session identifier.
 * @param {any} data - The data to send.
 */
export function sendToUser(sessionId: string, data: any) {
  const session = sessionManager.getSession(sessionId);
  if (session?.ws && session.ws.readyState === session.ws.OPEN) {
    session.ws.send(JSON.stringify(data));
  }
}

/**
 * Exposes the WebSocketServer instance for integration with Express server.
 */
export { wss };
