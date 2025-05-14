/**
 * @file a2aRoutes.ts
 * @description Express routes for A2A functionality
 */

import express from "express";
import { A2AController } from "../controllers/a2aController";

const router = express.Router();
const controller = new A2AController();

// Health check
router.get("/health", controller.healthCheck);

// Agent information
router.get("/.well-known/agent.json", controller.getAgentCard);

// Task management
router.get("/tasks", controller.listTasks);
router.post("/tasks/send", controller.sendTask);
router.post("/tasks/sendSubscribe", controller.sendTaskSubscribe);
router.get("/tasks/:taskId", controller.getTaskStatus);

export default router;
