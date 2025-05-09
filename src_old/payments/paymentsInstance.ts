import { Payments, EnvironmentName } from "@nevermined-io/payments";
import { logger } from "../logger/logger";

/**
 * Initializes the Nevermined Payments Library, which serves as
 * the primary interface to the Nevermined Payments API.
 *
 * @param {string} nvmApiKey - The Nevermined API key for authentication.
 * @param {string} environment - The environment name: 'testing', 'staging', or 'production'.
 * @returns {Payments} - An authenticated instance of the Payments class.
 * @throws {Error} - Throws an error if login to the Payments library fails.
 */
export function initializePayments(
  nvmApiKey: string,
  environment: string
): Payments {
  logger.info("Initializing Nevermined Payments Library...");

  const payments = Payments.getInstance({
    nvmApiKey,
    environment: environment as EnvironmentName,
  });

  if (!payments.isLoggedIn) {
    throw new Error("Failed to log in to the Nevermined Payments Library");
  }

  return payments;
}
