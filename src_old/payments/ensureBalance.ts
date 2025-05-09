import { logMessage } from "../utils/logMessage";
import { logger } from "../logger/logger";
import { PLAN_DID } from "../config/env";
import { performSwapForPlan, isBalanceSufficient } from "./blockchain";

/**
 * Extracts the token address from a given plan DDO.
 *
 * @param ddo - The plan DDO object.
 * @returns {string | undefined} - The token address, or undefined if not found.
 */
function extractTokenAddress(ddo: any): string | undefined {
  return ddo?.service?.[2]?.attributes?.additionalInformation
    ?.erc20TokenAddress;
}

/**
 * Extracts the token name from a given plan DDO.
 *
 * @param ddo - The plan DDO object.
 * @returns {string | undefined} - The token name, or undefined if not found.
 */
function extractTokenName(ddo: any): string | undefined {
  return ddo?.service?.[2]?.attributes?.additionalInformation?.symbol;
}

/**
 * Extracts the subscription price from a given plan DDO.
 *
 * @param ddo - The plan DDO object.
 * @returns {string} - The subscription price, or undefined if not found.
 */
function extractPlanPrice(ddo: any): string {
  return (
    ddo?.service?.[2]?.attributes?.additionalInformation?.priceHighestDenomination?.toString() ||
    "0"
  );
}

/**
 * Extracts the agent's wallet address from our own plan DDO.
 *
 * @param ddo - Our plan DDO object.
 * @returns {string} - The agent's wallet address, or undefined if not found.
 */
function extractAgentWallet(ddo: any): string {
  return ddo?.publicKey?.[0]?.owner || "";
}

/**
 * Ensures the payment plan has sufficient balance to execute a new task.
 * If the balance is below the required threshold, it attempts to purchase credits.
 * Additionally, if the external plan's payment token differs from our own token (extracted from our own plan DDO)
 * and our balance is insufficient, it performs a swap using Uniswap V2.
 *
 * The subscription price is determined by the external plan's DDO (in service[0].attributes.main.price).
 * If available, that value is used as the required amount.
 *
 * @async
 * @param planDid - The DID of the payment plan to check.
 * @param step - The current step data (used for logging and updating step status).
 * @param payments - The Nevermined Payments instance.
 * @param requiredBalance - The minimum required credits for this task (default is 1).
 * @returns {Promise<boolean>} - Returns true if sufficient balance is secured, false otherwise.
 */
export async function ensureSufficientBalance(
  planDid: string,
  step: any,
  payments: any,
  requiredBalance: number = 1
): Promise<boolean> {
  logMessage(payments, {
    task_id: step.task_id,
    level: "info",
    message: `Checking balance for plan ${planDid}...`,
  });
  const balanceResult = await payments.getPlanBalance(planDid);

  if (
    parseInt(balanceResult.balance) < requiredBalance &&
    !balanceResult.isOwner
  ) {
    logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message: `Insufficient balance for plan ${planDid}. Attempting to purchase credits...`,
    });

    // Retrieve external plan DDO.
    const externalPlanDDO = await payments.getAssetDDO(planDid);
    const externalTokenAddress = extractTokenAddress(externalPlanDDO);

    // Retrieve our own plan DDO.
    const ourPlanDDO = await payments.getAssetDDO(PLAN_DID);
    const ourTokenAddress = extractTokenAddress(ourPlanDDO);
    const externalTokenName = extractTokenName(externalPlanDDO);

    // Determine the required subscription price from the external plan DDO.
    const planPrice = extractPlanPrice(externalPlanDDO);

    // If tokens differ, perform a swap to obtain the external token.
    if (
      externalTokenAddress &&
      ourTokenAddress &&
      externalTokenAddress.toLowerCase() !== ourTokenAddress.toLowerCase()
    ) {
      const agentWallet: string | undefined = await extractAgentWallet(
        ourPlanDDO
      );
      if (agentWallet) {
        const sufficient = await isBalanceSufficient(
          externalTokenAddress,
          agentWallet,
          planPrice
        );

        if (!sufficient) {
          const externalTokenName = extractTokenName(externalPlanDDO);
          logMessage(payments, {
            task_id: step.task_id,
            level: "info",
            message: `Agent under plan ${planDid} accepts subscriptions in ${externalTokenName}. Attempting swap. Required amount: ${planPrice} ${externalTokenName}`,
          });
          const networkId = parseInt(Object.keys(ourPlanDDO._nvm.networks)[0]);
          const {
            success: swapSuccess,
            swapTxHash,
            transferTxHash,
          } = await performSwapForPlan(
            planPrice,
            ourTokenAddress,
            externalTokenAddress,
            agentWallet,
            networkId
          );
          if (!swapSuccess) {
            await logMessage(payments, {
              task_id: step.task_id,
              level: "error",
              message: `Failed to swap tokens for plan ${planDid}.`,
            });
            await payments.query.updateStep(step.did, {
              ...step,
              step_status: "Failed",
              output: "Insufficient balance and failed to swap tokens.",
            });
            return false;
          }
          await logMessage(payments, {
            task_id: step.task_id,
            level: "info",
            message: `Swap successful for plan ${planDid}. Swap tx: ${swapTxHash}`,
          });
          await logMessage(payments, {
            task_id: step.task_id,
            level: "info",
            message: `Transfer successful for plan ${planDid}. Transfer tx: ${transferTxHash}`,
          });
        }
      }
    }

    const message =
      planPrice == "0"
        ? `Ordering free plan ${planDid}.`
        : `Purchasing credits for plan ${planDid} for ${planPrice} ${externalTokenName}.`;
    await logMessage(payments, {
      task_id: step.task_id,
      level: "info",
      message,
    });
    try {
      const orderResult = await payments.orderPlan(planDid);
      if (!orderResult.success) {
        throw new Error(
          `Failed to order credits for plan ${planDid}: Insufficient balance and failed to purchase credits..`
        );
      }
      await logMessage(payments, {
        task_id: step.task_id,
        level: "info",
        message: `Ordered credits for plan ${planDid}. Tx: ${orderResult.agreementId}`,
      });
    } catch (error) {
      logger.error(
        `Error ordering credits for plan ${planDid}: ${error.message}`
      );
      await logMessage(payments, {
        task_id: step.task_id,
        level: "error",
        message: `Error ordering credits for plan ${planDid}: ${error.message}`,
      });
      await payments.query.updateStep(step.did, {
        ...step,
        step_status: "Failed",
        output: `Error ordering credits for plan ${planDid}: ${error.message}`,
      });
      return false;
    }
  }

  return true;
}
