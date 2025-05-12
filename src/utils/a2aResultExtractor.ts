/**
 * Helper utilities for extracting structured data from A2A agent results.
 * Delegates all LLM and prompt logic to llmA2aExtractor.ts.
 * @module utils/a2aResultExtractor
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
  const goal =
    "Extract all characters from the agent result, including name, description, and any visual prompt or details for image generation. Return as an array of objects.";
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
  const goal =
    "Extract all unique settings and locations from the agent result, including name, description, and any visual prompt for background image generation. Return as an array of objects.";
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
  const goal = `Extract all scenes from the agent result, including:
  - Scene number/identifier
  - Scene description
  - Characters present in the scene
  - Setting/location where the scene takes place
  - Camera movement/shot type if available
  - Visual prompt suitable for AI video generation
  - Duration or timing information if available
  - Any other technical details helpful for video creation

Return as an array of scene objects, with each scene containing at minimum: sceneNumber, description, prompt, characters, setting, and duration (if available).`;

  return llmExtractAgentData(agentCard, agentResult, goal);
}
