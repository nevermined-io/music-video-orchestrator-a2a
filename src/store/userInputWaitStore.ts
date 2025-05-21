/**
 * Service for handling user feedback and interaction.
 * Provides utilities for waiting and resolving user input in input-required state.
 */

/**
 * Map to store pending user input resolvers by sessionId.
 */
const userInputWaiters: Map<string, (input: string) => void> = new Map();

/**
 * Waits for user input for a given sessionId.
 * Resolves when the user provides feedback via WebSocket or another channel.
 * @param {string} sessionId - The session or task identifier.
 * @returns {Promise<string>} The user response.
 */
export function waitForUserInput(sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    userInputWaiters.set(sessionId, resolve);
  });
}

/**
 * Resolves the user input promise for a given sessionId.
 * Should be called by the channel that receives user feedback.
 * @param {string} sessionId - The session or task identifier.
 * @param {string} input - The user response.
 */
export function resolveUserInput(sessionId: string, input: string): void {
  const resolver = userInputWaiters.get(sessionId);
  if (resolver) {
    resolver(input);
    userInputWaiters.delete(sessionId);
  }
}
