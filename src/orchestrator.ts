/**
 * Orchestrates the music video creation workflow.
 * @module orchestrator
 */

import { fetchAgentCard, sendTask } from "./agents/a2aAgentClient";
import { llmMapAgentParams } from "./utils/llmA2aExtractor";
import {
  extractCharacters,
  extractSettings,
  extractScenes,
} from "./utils/a2aResultExtractor";
import { Logger } from "./utils/logger";

/**
 * Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration(input: {
  prompt: string;
}): Promise<any> {
  Logger.info(
    "[startOrchestration] Starting music video orchestration process"
  );

  // Step 1: Fetch the agent card from the song-generator-agent
  const songAgentCard = await fetchAgentCard("http://localhost:8001");
  Logger.info("[startOrchestration] Fetched song agent card");

  // Step 2: Map the input to the agent's expected parameters using the LLM
  const mappedParams = await llmMapAgentParams({
    agentCard: songAgentCard,
    availableData: input,
  });

  // Step 3: Send the task to the song-generator-agent using SSE
  Logger.info("[startOrchestration] Sending task to song generator agent");
  const songResult = await sendTask("http://localhost:8001", mappedParams);
  Logger.info("[startOrchestration] Received song generation result");

  // Step 4: Fetch the agent card from the script-generator-agent
  const scriptAgentCard = await fetchAgentCard("http://localhost:8002");
  Logger.info("[startOrchestration] Fetched script agent card");

  // Step 5: Map the input, song result and collected data for the script generator
  const mappedScriptParams = await llmMapAgentParams({
    agentCard: scriptAgentCard,
    availableData: {
      ...input,
      songResult,
    },
  });

  // Step 6: Send the task to the script-generator-agent using SSE
  Logger.info("[startOrchestration] Sending task to script generator agent");
  const scriptResult = await sendTask(
    "http://localhost:8002",
    mappedScriptParams
  );
  Logger.info("[startOrchestration] Received script generation result");

  // Step 7: Extract characters, settings, and scenes from script result
  Logger.info(
    "[startOrchestration] Extracting characters, settings, and scenes from script result"
  );

  const [characters, settings, scenes] = await Promise.all([
    extractCharacters(scriptAgentCard, scriptResult),
    extractSettings(scriptAgentCard, scriptResult),
    extractScenes(scriptAgentCard, scriptResult),
  ]);

  Logger.info(
    `[startOrchestration] Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes`
  );

  // Return the complete result with extracted data
  return {
    songResult,
    scriptResult,
    extractedData: {
      characters,
      settings,
      scenes,
    },
  };
}
