/**
 * Helper utilities for extracting structured data from A2A agent results.
 * Delegates all LLM and prompt logic to llmA2aExtractor.ts.
 * @module agents/a2aResultExtractor
 */

import { llmExtractAgentData } from "./llmA2aExtractor";

/**
 * Extracts data from an A2A agent result using a flexible extraction goal.
 * @param {any} agentCard - The AgentCard describing the agent's output structure.
 * @param {any} agentResult - The actual result from the agent (output of sendTask).
 * @param {string} extractionGoal - A clear English description of what to extract.
 * @returns {Promise<any>} - The extracted data as a structured object.
 */
export async function extractFromA2aResult(
  agentCard: any,
  agentResult: any,
  extractionGoal: string
): Promise<any> {
  return llmExtractAgentData(agentCard, agentResult, extractionGoal);
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
  return llmExtractAgentData(agentCard, agentResult, goal);
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
  return llmExtractAgentData(agentCard, agentResult, goal);
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

  return llmExtractAgentData(agentCard, agentResult, goal);
}
