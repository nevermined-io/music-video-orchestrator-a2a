/**
 * @file websocketService.ts
 * @description WebSocket service for bidirectional communication with users.
 */

import WebSocket from "ws";
import { SessionManager } from "../store/sessionConnectionStore";
import { v4 as uuidv4 } from "uuid";
import { taskStore, taskQueue } from "../tasks/taskContext";
import { Message, Task, TaskState } from "../models/task";
import { WebSocketOrchestrationIO } from "./webSocketOrchestrationIO";
import { handleUserFeedback } from "../orchestrator";

const wss = new WebSocket.Server({ noServer: true });
const sessionManager = new SessionManager();

wss.on("connection", (ws: WebSocket, req) => {
  // Extract contextId from query params (optional for new tasks)
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  let contextId = url.searchParams.get("contextId");

  // Store the WebSocket in the session if contextId is present
  if (contextId) {
    sessionManager.updateSession(contextId, { ws });
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
      const messageObj: Message = params?.message;
      const contextIdParam = params?.contextId || messageObj?.contextId;
      const taskId = messageObj?.taskId;

      // CASE 1: New task (no taskId)
      if (!taskId) {
        // Use provided contextId for grouping, or generate a new one if not provided
        let effectiveContextId = contextIdParam;
        if (!effectiveContextId) {
          // No contextId provided: create a new session
          effectiveContextId = uuidv4();
          sessionManager.createSession(effectiveContextId, { ws });
        } else {
          // contextId provided: create session if it doesn't exist, otherwise update
          if (!sessionManager.getSession(effectiveContextId)) {
            sessionManager.createSession(effectiveContextId, { ws });
          } else {
            sessionManager.updateSession(effectiveContextId, { ws });
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
          contextId: effectiveContextId,
          status: initialStatus,
          metadata: {
            ...(params?.metadata || {}),
            statusHistory: [initialStatus],
          },
          history: [messageObj],
        };

        // Now create the task
        await taskStore.createTask(task);
        // Enqueue the task in the taskQueue with the custom WebSocketOrchestrationIO
        const io = new WebSocketOrchestrationIO(newTaskId);
        await taskQueue.enqueueTask(task, io);

        return;
      }

      // CASE 2: Input for existing task (must have both taskId and contextId/contextId)
      if (taskId && contextIdParam) {
        // Load the existing task
        const task = await taskStore.getTask(taskId);
        if (!task) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              error: { code: -32000, message: "Task not found" },
            })
          );
          return;
        }

        // Create the IO for this task (WebSocketOrchestrationIO)
        const io = new WebSocketOrchestrationIO(taskId);

        // Process the user input and continue orchestration
        try {
          task.history = [...(task.history || []), messageObj];
          await taskStore.updateTask(task);
          await handleUserFeedback(task, io);
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: { status: "input processed" },
            })
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              error: {
                code: -32001,
                message: "Failed to process input",
                details: err?.message,
              },
            })
          );
        }
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
    if (contextId) {
      sessionManager.updateSession(contextId, { ws: undefined });
    }
  });
});

/**
 * Exposes the WebSocketServer instance for integration with Express server.
 */
export { wss };
