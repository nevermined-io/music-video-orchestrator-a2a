/**
 * Main entry point for the Orchestrator Agent server.
 * Exposes an HTTP API to trigger the music video workflow and A2A endpoints.
 * @module server
 */

import express, { Request, Response } from "express";
import { startOrchestration } from "./orchestrator";
import a2aRoutes from "./routes/a2aRoutes";
import { Logger } from "./utils/logger";
import { getEnvConfig } from "./config/checkEnv";
import cors from "cors";

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

/**
 * POST /music-video
 * Starts the music video creation workflow.
 * Body: { prompt: string }
 */
app.post("/music-video", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ error: "Missing prompt" });
      return;
    }
    const result = await startOrchestration({ prompt });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(config.PORT, config.HOST, () => {
  Logger.info(`Server running at http://${config.HOST}:${config.PORT}`);
  Logger.info(`Environment: ${config.NODE_ENV}`);
  Logger.info(`Log level: ${config.LOG_LEVEL}`);
});
