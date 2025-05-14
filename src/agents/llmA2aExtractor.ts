/**
 * Utilities for extracting and mapping data from A2A agent results using an LLM.
 * @module agents/llmA2aExtractor
 */

import { OPENAI_API_KEY } from "../config/env";
import { Logger } from "../core/logger";
import { AgentCard } from "../types/AgentCard";

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
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a specialized JSON parser for multi-agent workflows. Return ONLY valid JSON without any wrapper text, explanations, or code formatting.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 32768,
      temperature: 0.2,
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

/**
 * Uses an LLM to extract relevant data from an agent result, guided by the agent's AgentCard and a natural language extraction goal.
 * @param {any} agentCard - The AgentCard describing the agent's output structure.
 * @param {any} agentResult - The actual result from the agent (output of sendTask).
 * @param {string} extractionGoal - A clear English description of what to extract.
 * @returns {Promise<any>} - The extracted data as a structured object.
 */
export async function llmExtractAgentData(
  agentCard: any,
  agentResult: any,
  extractionGoal: string
): Promise<any> {
  const prompt = `
You are an expert in parsing and transforming agent outputs for a multi-agent creative workflow.

Context:
- The orchestrator is building a music video by coordinating several agents.
- Each agent exposes its capabilities and output structure via an AgentCard (see below).
- The orchestrator needs to extract specific information from the agent's output to pass to the next step.

AgentCard (describes the agent's output structure):
${JSON.stringify(agentCard, null, 2)}

Agent Result (actual output from the agent):
${JSON.stringify(agentResult, null, 2)}

Extraction Goal:
${extractionGoal}

Instructions:
- Carefully analyze the AgentCard and the agent result.
- Extract ONLY the information relevant to the extraction goal.
- If a field is missing, leave it as null or an empty string.
- Return ONLY the JSON object, with no explanations, markdown, or code blocks.
`;

  const llmResponse = await callLLM(prompt);
  const jsonMatch = llmResponse.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("LLM did not return a valid JSON object: " + llmResponse);
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error("LLM returned invalid JSON: " + llmResponse);
  }
}

/**
 * Uses an LLM to extract the image URL from an agent result, guided by the agent's AgentCard.
 * @param {any} agentCard - The AgentCard describing the agent's output structure.
 * @param {any} agentResult - The actual result from the agent (output of sendTask).
 * @returns {Promise<string>} - The extracted image URL, or an empty string if not found.
 */
export async function llmExtractImageUrl(
  agentCard: any,
  agentResult: any
): Promise<string> {
  const extractionGoal = `Extract ONLY the direct URL of the generated image from the agent result. If there is more than one image, return the first one. If no image URL is found, return an empty string. The output must be a JSON object: { "imageUrl": "..." }`;
  const result = await llmExtractAgentData(
    agentCard,
    agentResult,
    extractionGoal
  );
  return result?.imageUrl || "";
}

/**
 * Uses an LLM to extract the video URL from an agent result, guided by the agent's AgentCard.
 * @param {any} agentCard - The AgentCard describing the agent's output structure.
 * @param {any} agentResult - The actual result from the agent (output of sendTask).
 * @returns {Promise<string>} - The extracted video URL, or an empty string if not found.
 */
export async function llmExtractVideoUrl(
  agentCard: any,
  agentResult: any
): Promise<string> {
  const extractionGoal = `Extract ONLY the direct URL of the generated video from the agent result. If there is more than one video, return the first one. If no video URL is found, return an empty string. The output must be a JSON object: { "videoUrl": "..." }`;
  const result = await llmExtractAgentData(
    agentCard,
    agentResult,
    extractionGoal
  );
  return result?.videoUrl || "";
}

/**
 * Uses an LLM to extract the song URL and title from a song agent result, guided by the agent's AgentCard.
 * @param {any} agentCard - The AgentCard describing the agent's output structure.
 * @param {any} agentResult - The actual result from the agent (output of sendTask).
 * @returns {Promise<{ songUrl: string, title: string }>} - The extracted song URL and title, or empty strings if not found.
 */
export async function llmExtractSongInfo(
  agentCard: any,
  agentResult: any
): Promise<{ songUrl: string; title: string }> {
  const extractionGoal = `Extract ONLY the direct URL of the generated song (audio) and the title from the agent result. The output must be a JSON object: { "songUrl": "...", "title": "..." }`;
  const result = await llmExtractAgentData(
    agentCard,
    agentResult,
    extractionGoal
  );
  return {
    songUrl: result?.songUrl || "",
    title: result?.title || "",
  };
}

/**
 * Maps available data to the parameters required by an agent's skill, ensuring the main user input is always placed in the standard A2A `message` field.
 *
 * Many agents define their main input parameter with different names (e.g., "prompt", "idea", "input", "message").
 * This function ensures that, regardless of the parameter name, the main user input is always placed in the `message` field
 * following the A2A protocol: { role: "user", parts: [{ type: "text", text: ... }] }.
 *
 * If the input is present both as a parameter and in `message`, the value in `message` will be used.
 *
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

  // Construye el campo message y añádelo a availableData para que el LLM lo reciba
  if (mainInput) {
    availableData.message = {
      role: "user",
      parts: [{ type: "text", text: mainInput }],
    };
  }

  // Aquí podrías aplicar lógica adicional para mapear otros campos si es necesario
  return availableData;
}
