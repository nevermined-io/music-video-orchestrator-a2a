/**
 * Main entry point for the Orchestrator Agent server.
 * Exposes an HTTP API to trigger the music video workflow.
 * @module server
 */

import express, { Request, Response } from "express";
import { startOrchestration } from "./orchestrator";

const app = express();
app.use(express.json());

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Orchestrator Agent listening on port ${PORT}`);
});
