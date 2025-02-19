import { logMessage } from "../utils/logMessage";
import { logger } from "../logger/logger";

/**
 * Ensures a payment plan has sufficient balance to execute a new task.
 * If the balance is below the required threshold, it attempts to purchase more credits.
 *
 * @async
 * @function ensureSufficientBalance
 * @param {string} planDid - The DID of the payment plan to check.
 * @param {any} step - The current step data, used to update status if needed.
 * @param {any} payments - The Nevermined Payments instance.
 * @param {number} [requiredBalance=1] - The minimum required credits for this task.
 * @returns {Promise<boolean>} - Returns true if sufficient balance is secured, false otherwise.
 */
export async function ensureSufficientBalance(
  planDid: string,
  step: any,
  payments: any,
  requiredBalance: number = 1
): Promise<boolean> {
  //logger.info(`Checking balance for plan ${planDid}...`);
  //const planDDO = await payments.getAssetDDO(planDid);
  //logger.info(`Plan DDO: ${JSON.stringify(planDDO)}`);

  const balanceResult = await payments.getPlanBalance(planDid);

  if (balanceResult.balance < requiredBalance && !balanceResult.isOwner) {
    logger.warn(
      `Insufficient balance in plan ${planDid}. Attempting to order credits...`
    );
    const orderResult = await payments.orderPlan(planDid);

    if (!orderResult.success) {
      logger.error(`Failed to order credits for plan ${planDid}.`);
      await logMessage(payments, {
        task_id: step.task_id,
        level: "error",
        message: `Failed to order credits for plan ${planDid}.`,
      });

      await payments.query.updateStep(step.did, {
        ...step,
        step_status: "Failed",
        output: "Insufficient balance and failed to purchase credits.",
      });

      return false;
    }
  }

  logger.info(`Balance check successful for plan ${planDid}.`);
  return true;
}
