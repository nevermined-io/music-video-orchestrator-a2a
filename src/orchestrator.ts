/**
 * Orchestrates the music video creation workflow.
 * @module orchestrator
 */

import { fetchAgentCard, sendTask } from "./agents/a2aAgentClient";
import { mapParamsWithLLM } from "./utils/llmParamMapper";

/**
 * Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration(input: {
  prompt: string;
}): Promise<any> {
  // Step 1: Fetch the agent card from the song-generator-agent
  const agentCard = await fetchAgentCard("http://localhost:8001");

  // Step 2: Map the input to the agent's expected parameters using the LLM
  const mappedParams = await mapParamsWithLLM({
    agentCard,
    availableData: input,
  });

  // Step 3: Send the task to the song-generator-agent using SSE
  const songResult = await sendTask("http://localhost:8001", mappedParams);

  // Step 4: Fetch the agent card from the script-generator-agent
  const scriptAgentCard = await fetchAgentCard("http://localhost:8002");

  // Step 5: Map the input, song result y datos recopilados para el script generator
  const mappedScriptParams = await mapParamsWithLLM({
    agentCard: scriptAgentCard,
    availableData: {
      ...input,
      songResult,
    },
  });

  // Step 6: Send the task to the script-generator-agent using SSE
  const scriptResult = await sendTask(
    "http://localhost:8002",
    mappedScriptParams
  );

  // Return both results
  return { songResult, scriptResult };
}
