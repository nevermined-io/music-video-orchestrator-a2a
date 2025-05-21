/**
 * Utilities for building prompts for LLM interpretation of user feedback.
 */
import { callLLM } from "./client";

/**
 * Builds a prompt for the LLM to interpret user feedback and suggest the next action.
 * The LLM must return a JSON object: { action: "accept" | "retry" | "modify", newInput?: object }
 * @param {object} params - The context for the LLM
 * @param {any} params.previousInput - The previous input parameters used
 * @param {any} params.previousOutput - The previous output/artifact generated
 * @param {string} params.userComment - The user's feedback or comment
 * @param {any} params.agentCard - The agentCard object describing the agent's skills and output structure
 * @param {string} [params.skillId] - Optional skillId to select the relevant skill from the agentCard
 * @returns {string} The prompt to send to the LLM
 */
export function buildLLMInterpretationPrompt({
  previousInput,
  previousOutput,
  userComment,
  agentCard,
  skillId,
}: {
  previousInput: any;
  previousOutput: any;
  userComment: string;
  agentCard: any;
  skillId?: string;
}): string {
  let skill: any = undefined;
  if (agentCard && Array.isArray(agentCard.skills)) {
    if (skillId) {
      skill = agentCard.skills.find((s: any) => s.id === skillId);
    }
    if (!skill) {
      skill = agentCard.skills[0];
    }
  }
  const outputStructure = skill && skill.returns ? skill.returns : null;
  const outputStructureStr = outputStructure
    ? JSON.stringify(outputStructure, null, 2)
    : "(not specified)";
  const previousOutputStr =
    typeof previousOutput === "string"
      ? previousOutput
      : JSON.stringify(previousOutput, null, 2);

  return `
You are an orchestration assistant. The user previously requested:
${JSON.stringify(previousInput, null, 2)}

The agent generated this output (structure defined below):
${previousOutputStr}

The output structure is:
${outputStructureStr}

The system asked the user:
${
  userComment.includes("System prompt to user:")
    ? userComment
    : '"' + userComment + '"'
}

Based on the user's feedback, return a JSON object with:
- action: "accept" if the user is satisfied and wants to continue,
- action: "retry" if the user wants to repeat this step,
- action: "modify" if the user wants to change the input (in this case, provide the newInput object).

Example outputs:
{ "action": "accept" }
{ "action": "retry" }
{ "action": "modify", "newInput": { ... } }

Return ONLY the JSON object, no explanations.
`;
}

/**
 * Interprets user feedback in context using the LLM, returning an action and optionally a new input.
 * @param {object} params - The context for interpretation
 * @param {any} params.previousInput - The previous input parameters used
 * @param {any} params.previousOutput - The previous output/artifact generated
 * @param {string} params.userPromptMessage - The system prompt/message shown to the user
 * @param {string} params.userComment - The user's feedback or comment
 * @param {any} params.agentCard - The agentCard object describing the agent's skills and output structure
 * @param {string} [params.skillId] - Optional skillId to select the relevant skill from the agentCard
 * @returns {Promise<{ action: "accept" | "retry" | "modify"; newInput?: any }>} The interpreted action and new input if applicable
 */
export async function interpretUserFeedbackWithLLM({
  previousInput,
  previousOutput,
  userPromptMessage,
  userComment,
  agentCard,
  skillId,
}: {
  previousInput: any;
  previousOutput: any;
  userPromptMessage: string;
  userComment: string;
  agentCard: any;
  skillId?: string;
}): Promise<{ action: "accept" | "retry" | "modify"; newInput?: any }> {
  const contextualUserComment = `System prompt to user: "${userPromptMessage}"
User response: "${userComment}"`;

  const prompt = buildLLMInterpretationPrompt({
    previousInput,
    previousOutput,
    userComment: contextualUserComment,
    agentCard,
    skillId,
  });

  const llmResult = await callLLM(prompt, {
    systemPrompt:
      "You are a creative assistant. Return ONLY the JSON object as specified, no explanations.",
    temperature: 0.2,
    maxTokens: 1024,
  });

  const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM did not return a valid JSON object: " + llmResult);
  }
  return JSON.parse(jsonMatch[0]);
}
