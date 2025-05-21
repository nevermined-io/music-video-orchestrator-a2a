/**
 * LLM-powered extractors for structured data from agent results.
 */

import { callLLM } from "./client";

/**
 * Extracts data from an A2A agent result using a flexible extraction goal.
 * @param {any} agentCard - The AgentCard describing the agent's output structure.
 * @param {any} agentResult - The actual result from the agent (output of sendTask).
 * @param {string} extractionGoal - A clear English description of what to extract.
 * @returns {Promise<any>} - The extracted data as a structured object.
 */
export async function extractAgentData(
  agentCard: any,
  agentResult: any,
  extractionGoal: string
): Promise<any> {
  // Build a prompt for the LLM to extract the required data
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
  const llmResponse = await callLLM(prompt, {
    systemPrompt:
      "You are a specialized JSON parser for multi-agent workflows. Return ONLY valid JSON without any wrapper text, explanations, or code formatting.",
    maxTokens: 32768,
    temperature: 0.2,
  });
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
 * Extracts all characters from a script agent result.
 * @param {any} agentCard - The AgentCard for the script generator.
 * @param {any} agentResult - The result from the script generator.
 * @returns {Promise<any[]>} - Array of character objects.
 */
export async function extractCharacters(
  agentCard: any,
  agentResult: any
): Promise<any[]> {
  const goal = `
  Extract all characters from the agent result, including:
    - name (as used in the script and scene descriptions)
    - description (physical and personality details)
    - any visual prompt or details for image generation
  
  IMPORTANT:
  - Only include each character once, even if they appear in multiple scenes.
  - The name must match exactly how it appears in the script or character list.
  - If a character is referenced in any scene, they must be included in the output.
  - If the agent result provides a character list, use that as the authoritative source for names and details.
  
  Return as an array of character objects.
  `;
  return extractAgentData(agentCard, agentResult, goal);
}

/**
 * Extracts all settings (locations) from a script agent result.
 * @param {any} agentCard - The AgentCard for the script generator.
 * @param {any} agentResult - The result from the script generator.
 * @returns {Promise<any[]>} - Array of setting/location objects.
 */
export async function extractSettings(
  agentCard: any,
  agentResult: any
): Promise<any[]> {
  const goal = `
    Extract all unique settings (locations) from the agent result. 
    - For each setting, include: 
      - name (the identifier or name of the location as used in the script or scene list)
      - description (detailed description of the location)
      - any visual prompt or details for background image generation
    - If multiple scenes share the same location, extract the location only once.
    - Do NOT extract one setting per scene; group scenes that logically occur in the same place and return only one object for each unique location.
    - The name must match the identifier used in the script for that location.
    Return as an array of unique setting/location objects.
    `;
  return extractAgentData(agentCard, agentResult, goal);
}

/**
 * Extracts all scenes from a script agent result, with prompts suitable for video generation.
 * @param {any} agentCard - The AgentCard for the script generator.
 * @param {any} agentResult - The result from the script generator.
 * @returns {Promise<any[]>} - Array of scene objects with video generation prompts.
 */
export async function extractScenes(
  agentCard: any,
  agentResult: any
): Promise<any[]> {
  const goal = `
  Extract all scenes from the agent result, including:
    - Scene number/identifier
    - Scene description or prompt
    - Characters present in the scene (as an array of character names)
      - IMPORTANT: The characters array must be filled by matching the names mentioned in each scene's description with the names in the character list provided in the agent result.
      - Do NOT leave the characters array empty. Every scene must have at least one character, and the names must match exactly those in the character list.
      - If a character is referenced in the scene description (even indirectly or by role), include them using the exact name from the character list.
    - Setting/location identifier where the scene takes place. This must match exactly one of the settings in the settings array (do not invent new settings).
    - Camera movement/shot type if available
    - Visual prompt suitable for AI video generation
    - Duration or timing information if available
    - Any other technical details helpful for video creation
  
  Return as an array of scene objects, with each scene containing at minimum: sceneNumber, description or prompt, characters (non-empty, matching the character list), setting (referencing the correct setting identifier), and duration (if available).
  `;

  return extractAgentData(agentCard, agentResult, goal);
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
  const result = await extractAgentData(agentCard, agentResult, extractionGoal);
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
  const result = await extractAgentData(agentCard, agentResult, extractionGoal);
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
  const result = await extractAgentData(agentCard, agentResult, extractionGoal);
  return {
    songUrl: result?.songUrl || "",
    title: result?.title || "",
  };
}
