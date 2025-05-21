/**
 * Main entry point for the Orchestrator Agent server.
 * Exposes an HTTP API to trigger the music video workflow and A2A endpoints.
 * @module server
 */

import express from "express";
import a2aRoutes from "./routes/a2aRoutes";
import { Logger } from "./utils/logger";
import { getEnvConfig } from "./config/checkEnv";
import cors from "cors";
import { wss } from "./adapters/websocketService";
import http from "http";

const config = getEnvConfig();

const app = express();
app.use(cors());
app.use(express.json());

// Mount A2A routes at root (for /tasks/* and /.well-known/agent.json)
app.use("/", a2aRoutes);

// Error handling middleware
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    Logger.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

// Create HTTP server and integrate WebSocket upgrade
const server = http.createServer(app);

server.on("upgrade", (request, socket, head) => {
  Logger.info("Upgrade request received");
  // Handle WebSocket upgrade
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

server.listen(config.PORT, config.HOST, () => {
  Logger.info(`Server running at http://${config.HOST}:${config.PORT}`);
  Logger.info(`Environment: ${config.NODE_ENV}`);
  Logger.info(`Log level: ${config.LOG_LEVEL}`);
});
