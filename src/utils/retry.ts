/**
 * Retries a function up to N times with a delay.
 * @template T
 * @param {() => Promise<T>} fn - Function to retry
 * @param {number} [retries=3] - Number of retries
 * @param {number} [delayMs=2000] - Delay between retries in ms
 * @returns {Promise<T>} - The result of the function if successful
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 2000
): Promise<T> {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  }
  throw lastError;
}
