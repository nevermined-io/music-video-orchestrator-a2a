/**
 * @file e2e-music-video-orchestrator.ts
 * @description End-to-end test script for the Music Video Orchestrator Agent (A2A protocol)
 *
 * This script:
 * 1. Checks if the orchestrator server is running, starts it if not.
 * 2. Fetches and prints the agentCard from /.well-known/agent.json.
 * 3. Sends a JSON-RPC 2.0 A2A task (music video prompt) to /tasks/send.
 * 4. Polls for task completion and prints the final result (video URL, lyrics, audio, etc).
 *
 * Usage: npx ts-node scripts/e2e-music-video-orchestrator.ts
 */

import axios from "axios";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";

const CONFIG = {
  serverUrl: process.env.SERVER_URL || "http://localhost:8000",
  pollingInterval: 5000, // 5 seconds
  maxRetries: 120, // 10 minutes
};

/**
 * Checks if the orchestrator server is running
 * @returns {Promise<boolean>} True if server is running, false otherwise
 */
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await axios.get(`${CONFIG.serverUrl}/health`);
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Starts the orchestrator server using npm run start
 * @returns {Promise<void>}
 */
async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("Starting orchestrator server...");
    const serverProcess = spawn("npm", ["run", "start"], {
      stdio: "inherit",
      shell: true,
    });
    let startTimeout: NodeJS.Timeout;
    let checkInterval: NodeJS.Timeout;
    startTimeout = setTimeout(() => {
      clearInterval(checkInterval);
      serverProcess.kill();
      reject(new Error("Server failed to start within 30 seconds timeout"));
    }, 30000);
    checkInterval = setInterval(async () => {
      if (await isServerRunning()) {
        clearTimeout(startTimeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
    serverProcess.on("error", (error) => {
      clearTimeout(startTimeout);
      clearInterval(checkInterval);
      reject(new Error(`Failed to start server: ${error.message}`));
    });
    serverProcess.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(startTimeout);
        clearInterval(checkInterval);
        reject(new Error(`Server process exited with code ${code}`));
      }
    });
  });
}

/**
 * Fetches the agentCard from /.well-known/agent.json
 * @returns {Promise<any>} The agentCard JSON
 */
async function fetchAgentCard(): Promise<any> {
  const url = `${CONFIG.serverUrl}/.well-known/agent.json`;
  const response = await axios.get(url);
  return response.data;
}

/**
 * Creates a new music video orchestration task using JSON-RPC 2.0 (A2A protocol)
 * @param {string} prompt The creative prompt for the music video
 * @returns {Promise<string>} Task ID
 */
async function createMusicVideoTask(prompt: string): Promise<string> {
  const message = {
    role: "user",
    parts: [{ type: "text", text: prompt }],
  };
  const jsonRpcRequest = {
    jsonrpc: "2.0",
    id: uuidv4(),
    method: "tasks/send",
    params: {
      id: uuidv4(),
      sessionId: uuidv4(),
      message,
    },
  };
  const response = await axios.post(
    `${CONFIG.serverUrl}/tasks/send`,
    jsonRpcRequest
  );
  if (response.data && response.data.result && response.data.result.id) {
    return response.data.result.id;
  }
  throw new Error("Invalid response from server: missing result.id");
}

/**
 * Polls the status of a task until completion
 * @param {string} taskId The task ID
 * @returns {Promise<any>} Final task result
 */
async function pollTaskStatus(taskId: string): Promise<any> {
  let retries = 0;
  let lastState = "";
  while (retries < CONFIG.maxRetries) {
    const response = await axios.get(`${CONFIG.serverUrl}/tasks/${taskId}`);
    const status = response.data.status.state;
    if (status !== lastState) {
      console.log(`Task status: ${status}`);
      lastState = status;
    }
    if (status === "completed") {
      console.log("Music video orchestration completed!");
      return response.data;
    } else if (status === "failed") {
      throw new Error(`Task failed: ${response.data.status.error}`);
    } else if (status === "canceled") {
      throw new Error("Task was canceled");
    } else if (status === "rejected") {
      throw new Error("Task was rejected");
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIG.pollingInterval));
    retries++;
  }
  throw new Error("Timeout waiting for music video orchestration");
}

/**
 * Main e2e test runner
 */
async function main() {
  try {
    // 1. Ensure server is running
    if (!(await isServerRunning())) {
      await startServer();
    }
    // 2. Fetch and print agentCard
    const agentCard = await fetchAgentCard();
    console.log("\n--- AgentCard ---\n", JSON.stringify(agentCard, null, 2));
    // 3. Send orchestration task
    const prompt = "A cyberpunk rap anthem about AI collaboration";
    console.log(`\nSending music video orchestration task: '${prompt}'`);
    const taskId = await createMusicVideoTask(prompt);
    console.log(`Task created with ID: ${taskId}`);
    // 4. Poll for completion
    const result = await pollTaskStatus(taskId);
    console.log(
      "\n--- Final Orchestration Result ---\n",
      JSON.stringify(result, null, 2)
    );
    // 5. Print summary of artifacts
    if (result.artifacts) {
      console.log("\nArtifacts:");
      for (const artifact of result.artifacts) {
        if (artifact.parts) {
          for (const part of artifact.parts) {
            if (part.type === "text") {
              console.log("Text:", part.text);
            } else if (part.type === "audio") {
              console.log("Audio URL:", part.audioUrl);
            } else if (part.type === "video") {
              console.log("Video URL:", part.videoUrl);
            } else if (part.type === "data") {
              console.log("Data:", JSON.stringify(part.data));
            }
          }
        }
      }
    }
    // 6. Print main outputs if present
    if (result.status?.message?.parts) {
      for (const part of result.status.message.parts) {
        if (part.type === "text") {
          console.log("\nStatus message:", part.text);
        }
      }
    }
  } catch (error: any) {
    console.error("E2E test failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
