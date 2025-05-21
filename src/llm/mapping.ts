/**
 * LLM-powered parameter mapping for agent calls.
 */

import { callLLM } from "./client";
import { AgentCard } from "../types/AgentCard";
import { Logger } from "../utils/logger";

/**
 * Maps available data to the parameters required by an agent's skill, ensuring the main user input is always placed in the standard A2A `message` field.
 * Many agents define their main input parameter with different names (e.g., "prompt", "idea", "input", "message").
 * This function ensures that, regardless of the parameter name, the main user input is always placed in the `message` field
 * following the A2A protocol: { role: "user", parts: [{ type: "text", text: ... }] }.
 * If the input is present both as a parameter and in `message`, the value in `message` will be used.
 * @param {object} options
 * @param {AgentCard} options.agentCard - The agent card of the target agent.
 * @param {any} options.availableData - The data available in the orchestrator (prompt, artifacts, etc).
 * @returns {Promise<any>} - The mapped parameters for the agent, with the main input in `message`.
 */
export async function llmMapAgentParams({
  agentCard,
  availableData,
}: {
  agentCard: AgentCard;
  availableData: any;
}): Promise<any> {
  Logger.info(
    "[mapParamsWithLLM] Mapping parameters for agent",
    agentCard?.name || agentCard
  );

  // Detect main input field (prompt, idea, input, message, etc.)
  let mainInput = "";
  for (const field of ["prompt", "idea", "input", "message", "text", "query"]) {
    if (
      typeof availableData[field] === "string" &&
      availableData[field].trim()
    ) {
      mainInput = availableData[field];
      break;
    }
  }

  // Build the message field and add it to availableData for the LLM to receive it
  if (mainInput) {
    availableData.message = {
      role: "user",
      parts: [{ type: "text", text: mainInput }],
    };
  }

  // Build the prompt for the LLM
  const prompt = `You are an expert in API integration, creative task decomposition, and prompt adaptation.
Given:
- An agent card (with all its skills and descriptions)
- The user's original request (available data)
Important protocol note:
- In the A2A protocol, every agent call MUST include a 'message' field, even if it is not listed as a parameter in the agentCard. This field is always required and must follow the structure: { role: "user" | "agent", parts: [{ type: "text", text: ... }] }.
Your task is:
1. Analyze all the skills described in the agent card.
2. Select the most appropriate skill to use for the given user request and intent.
3. Synthesize and adapt the user's original input so that it fits the context, purpose, and requirements of the selected skill. This means you must reinterpret or rewrite the user's request so it is directly actionable and relevant for the selected skill, using the skill's description as a guide. Be as specific and creative as needed, and focus only on what the agent can actually do.
4. Generate the JSON parameters required to call that skill, using the adapted input. **You MUST include all required parameters defined in the agentCard for the selected skill, in addition to the 'message' field.**
5. Return ONLY the JSON object with the parameters, and nothing else after it. Do NOT include any code block markers (such as triple backticks or \`\`\`json), just the raw JSON object.
6. If you believe any of the available parameters is more suitable for the message field, set it as the message field in the JSON object, instead of the original user input.
7. Always ensure you construct the message field following the A2A protocol: { role: "user" | "agent", parts: [{ type: "text", text: ... }] }.
8. Example output:
{
  "message": {
    "role": "user",
    "parts": [{ "type": "text", "text": "your main input here" }]
  },
  "taskType": "text2image",
  "duration": 10,
  "imageUrls": ["https://example.com/image1.png"]
}

Agent card:
${JSON.stringify(agentCard, null, 2)}
Available data (user input and context):
${JSON.stringify(availableData, null, 2)}
`;

  Logger.debug("[mapParamsWithLLM] Prompt for LLM:", prompt);

  try {
    const llmResponse = await callLLM(prompt);
    Logger.debug("[mapParamsWithLLM] LLM response:", llmResponse);
    const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      Logger.error(
        "[mapParamsWithLLM] LLM did not return a valid JSON object:",
        llmResponse
      );
      throw new Error("LLM did not return a valid JSON object: " + llmResponse);
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (mainInput) {
      parsed.message = {
        role: "user",
        parts: [{ type: "text", text: mainInput }],
      };
    }
    Logger.info("[mapParamsWithLLM] Successfully mapped parameters for agent.");
    return parsed;
  } catch (error) {
    Logger.error("[mapParamsWithLLM] Error during parameter mapping:", error);
    throw error;
  }
}
