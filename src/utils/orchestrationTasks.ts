import { llmMapAgentParams, llmExtractSongInfo } from "./llmA2aExtractor";
import { sendTask } from "../agents/a2aAgentClient";

/**
 * Generates a song using the song generator agent.
 * @param {any} songAgentCard - The agent card for the song generator.
 * @param {any} input - The input data (e.g. { prompt: string })
 * @returns {Promise<any>} - The result of the song generation.
 */
export async function generateSong(
  songAgentCard: any,
  input: any
): Promise<any> {
  const mappedParams = await llmMapAgentParams({
    agentCard: songAgentCard,
    availableData: input,
  });
  const songResult = await sendTask(
    "http://localhost:8001",
    mappedParams,
    songAgentCard
  );
  const { songUrl, title } = await llmExtractSongInfo(
    songAgentCard,
    songResult
  );
  return { songResult, songUrl, title };
}

/**
 * Generates a script using the script generator agent.
 * @param {any} scriptAgentCard - The agent card for the script generator.
 * @param {any} input - The input data (e.g. { prompt: string })
 * @param {any} songResult - The result from the song generator.
 * @returns {Promise<any>} - The result of the script generation.
 */
export async function generateScript(
  scriptAgentCard: any,
  input: any,
  songResult: any
): Promise<any> {
  const mappedScriptParams = await llmMapAgentParams({
    agentCard: scriptAgentCard,
    availableData: {
      ...input,
      songResult,
    },
  });
  return await sendTask(
    "http://localhost:8002",
    mappedScriptParams,
    scriptAgentCard
  );
}
