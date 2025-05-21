/**
 * LLM client for calling a language model (e.g., OpenAI) with a prompt.
 */

import { OPENAI_API_KEY } from "../config/env";

const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant. Return only the answer, no explanations or formatting.";

/**
 * Calls an LLM (e.g., OpenAI) with the given prompt and returns the response as a string.
 * @param {string} prompt - The prompt to send to the LLM.
 * @param {object} [options] - Optional configuration (model, endpoint, apiKey, temperature, maxTokens, systemPrompt)
 * @param {string} [options.systemPrompt] - Optional system prompt for the LLM (default: generic assistant)
 * @returns {Promise<string>} - The LLM's response as a string.
 */
export async function callLLM(
  prompt: string,
  options?: {
    model?: string;
    endpoint?: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }
): Promise<string> {
  const apiKey = options?.apiKey || OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const endpoint = options?.endpoint || DEFAULT_OPENAI_ENDPOINT;
  const model = options?.model || DEFAULT_OPENAI_MODEL;
  const temperature = options?.temperature ?? 0.2;
  const maxTokens = options?.maxTokens ?? 2048;
  const systemPrompt = options?.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("No response from LLM");
  return text.trim();
}
