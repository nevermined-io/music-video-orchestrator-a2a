/**
 * @file websocketService.ts
 * @description WebSocket service for bidirectional communication with users.
 */

import WebSocket from "ws";
import { SessionManager } from "../store/sessionConnectionStore";
import { resolveUserInput } from "../store/userInputWaitStore";
import { v4 as uuidv4 } from "uuid";
import { taskStore, taskQueue } from "../tasks/taskContext";
import { Task, TaskState } from "../models/task";
import { WebSocketOrchestrationIO } from "./webSocketOrchestrationIO";

const wss = new WebSocket.Server({ noServer: true });
const sessionManager = new SessionManager();

wss.on("connection", (ws: WebSocket, req) => {
  // Extract sessionId from query params (optional for new tasks)
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  let sessionId = url.searchParams.get("sessionId");

  // Store the WebSocket in the session if sessionId is present
  if (sessionId) {
    sessionManager.updateSession(sessionId, { ws });
  }

  /**
   * Handles incoming WebSocket messages using JSON-RPC 2.0.
   * Supports 'tasks/send' for both new tasks and input to existing tasks.
   */
  ws.on("message", async (message) => {
    let parsed;
    try {
      parsed = JSON.parse(message.toString());
    } catch (e) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        })
      );
      return;
    }

    // Basic JSON-RPC validation
    if (
      !parsed.jsonrpc ||
      parsed.jsonrpc !== "2.0" ||
      !parsed.method ||
      !parsed.id
    ) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed?.id || null,
          error: { code: -32600, message: "Invalid Request" },
        })
      );
      return;
    }

    // Only handle 'tasks/send'
    if (parsed.method === "tasks/send") {
      const { params } = parsed;
      const messageObj = params?.message;
      const sessionIdParam = params?.sessionId || messageObj?.contextId;
      const taskId = messageObj?.taskId;
      const inputText = messageObj?.parts?.[0]?.text;

      // CASE 1: New task (no taskId)
      if (!taskId) {
        // Use provided sessionId for grouping, or generate a new one if not provided
        let effectiveSessionId = sessionIdParam;
        if (!effectiveSessionId) {
          // No sessionId provided: create a new session
          effectiveSessionId = uuidv4();
          sessionManager.createSession(effectiveSessionId, { ws });
        } else {
          // sessionId provided: create session if it doesn't exist, otherwise update
          if (!sessionManager.getSession(effectiveSessionId)) {
            sessionManager.createSession(effectiveSessionId, { ws });
          } else {
            sessionManager.updateSession(effectiveSessionId, { ws });
          }
        }
        const newTaskId = uuidv4();

        // Prepare the statusListener before creating the task
        const statusListener = async (updatedTask) => {
          if (updatedTask.id === newTaskId) {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: uuidv4(),
                result: updatedTask,
              })
            );
          }
        };
        taskStore.addStatusListener(statusListener);
        ws.on("close", () => {
          taskStore.removeStatusListener(statusListener);
        });

        // Create the new task
        const initialStatus = {
          state: TaskState.SUBMITTED,
          timestamp: new Date().toISOString(),
        };
        const task: Task = {
          id: newTaskId,
          sessionId: effectiveSessionId,
          status: initialStatus,
          message: messageObj,
          metadata: params?.metadata,
          history: [initialStatus],
        };

        // Now create the task
        await taskStore.createTask(task);
        // Enqueue the task in the taskQueue with the custom WebSocketOrchestrationIO
        // This ensures concurrency, retries, and unified processing for all tasks
        const io = new WebSocketOrchestrationIO(newTaskId);
        await taskQueue.enqueueTask(task, io);

        return;
      }

      // CASE 2: Input for existing task (must have both taskId and sessionId/contextId)
      if (taskId && sessionIdParam && inputText) {
        // Resolve the pending user input for this session/task
        resolveUserInput(sessionIdParam, inputText);
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: { status: "input received" },
          })
        );
        return;
      }

      // If neither case matches, params are invalid
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: -32602, message: "Invalid params for tasks/send" },
        })
      );
      return;
    }

    // Method not found
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        error: { code: -32601, message: "Method not found" },
      })
    );
  });

  ws.on("close", () => {
    if (sessionId) {
      sessionManager.updateSession(sessionId, { ws: undefined });
    }
  });
});

/**
 * Exposes the WebSocketServer instance for integration with Express server.
 */
export { wss };
