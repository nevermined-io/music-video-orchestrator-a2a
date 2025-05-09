/**
 * Utility for mapping available data to agent parameters using an LLM.
 * @module utils/llmParamMapper
 */

import { AgentCard } from "../types/AgentCard";
import { OPENAI_API_KEY } from "../config/env";
import { Logger } from "./logger";

/**
 * Uses an LLM to map available data to the parameters required by an agent's skill.
 * @param {object} options
 * @param {AgentCard} options.agentCard - The agent card of the target agent.
 * @param {any} options.availableData - The data available in the orchestrator (prompt, artifacts, etc).
 * @returns {Promise<any>} - The mapped parameters for the agent.
 */
export async function mapParamsWithLLM({
  agentCard,
  availableData,
}: {
  agentCard: AgentCard;
  availableData: any;
}): Promise<any> {
  /** Log the start of the parameter mapping process */
  Logger.info(
    "[mapParamsWithLLM] Mapping parameters for agent",
    agentCard?.name || agentCard
  );

  // Build the prompt for the LLM
  const prompt = `
You are an expert in API integration, creative task decomposition, and prompt adaptation.

Given:
- An agent card (with all its skills and descriptions)
- The user's original request (available data)

Your task is:

1. Analyze all the skills described in the agent card.
2. Select the most appropriate skill to use for the given user request and intent.
3. Synthesize and adapt the user's original input so that it fits the context, purpose, and requirements of the selected skill. This means you must reinterpret or rewrite the user's request so it is directly actionable and relevant for the selected skill, using the skill's description as a guide. Be as specific and creative as needed, and focus only on what the agent can actually do.
4. Generate the JSON parameters required to call that skill, using the adapted input. If any required parameter is not explicitly present in the available data, infer, deduce, or creatively generate a suitable value based on the context and intent of the input. Always fill all required fields with the best possible guess.
5. Return ONLY the JSON object with the parameters, and nothing else after it. Do NOT include any code block markers (such as triple backticks or \`\`\`json), just the raw JSON object.

Agent card:
${JSON.stringify(agentCard, null, 2)}

Available data (user input and context):
${JSON.stringify(availableData, null, 2)}
`;

  /** Log the prompt that will be sent to the LLM */
  Logger.debug("[mapParamsWithLLM] Prompt for LLM:", prompt);

  try {
    // Call the LLM (stub, replace with your real LLM API call)
    const llmResponse = await callLLM(prompt);

    /** Log the response received from the LLM */
    Logger.debug("[mapParamsWithLLM] LLM response:", llmResponse);

    // Try to extract the JSON from the LLM response
    const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      Logger.error(
        "[mapParamsWithLLM] LLM did not return a valid JSON object:",
        llmResponse
      );
      throw new Error("LLM did not return a valid JSON object: " + llmResponse);
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      Logger.info(
        "[mapParamsWithLLM] Successfully mapped parameters for agent."
      );
      return parsed;
    } catch (err) {
      Logger.error(
        "[mapParamsWithLLM] LLM returned invalid JSON:",
        llmResponse
      );
      throw new Error("LLM returned invalid JSON: " + llmResponse);
    }
  } catch (error) {
    Logger.error("[mapParamsWithLLM] Error during parameter mapping:", error);
    throw error;
  }
}

/**
 * Calls the OpenAI API to generate a response for the given prompt.
 * @param {string} prompt - The prompt to send to the LLM.
 * @returns {Promise<string>} - The LLM's response as a string.
 */
async function callLLM(prompt: string): Promise<string> {
  const apiKey = OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No response from LLM");
  return text.trim();
}
