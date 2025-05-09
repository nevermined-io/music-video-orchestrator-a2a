import { ethers, Contract, Signer, BigNumber } from "ethers";
import { Token, CurrencyAmount, Percent, TradeType } from "@uniswap/sdk-core";
import { Pair, Route, Trade } from "@uniswap/v2-sdk";
import { logger } from "../logger/logger";
import {
  RPC_URL,
  PRIVATE_KEY,
  UNISWAP_V2_ROUTER_ADDRESS,
  UNISWAP_V2_FACTORY_ADDRESS,
} from "../config/env";

// ---------------------------------------------------------------------------
// ABI Definitions
// ---------------------------------------------------------------------------
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address recipient, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const UNISWAP_ROUTER_ABI = [
  "function swapTokensForExactTokens(uint amountOut, uint maxAmountIn, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const UNISWAP_PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

// ---------------------------------------------------------------------------
// Provider and Wallet Helpers
// ---------------------------------------------------------------------------
/**
 * Returns an ethers JSON-RPC provider instance.
 *
 * @returns {ethers.providers.JsonRpcProvider} An ethers provider.
 */
const getProvider = () => new ethers.providers.JsonRpcProvider(RPC_URL);

/**
 * Returns an ethers Wallet instance using the provided private key.
 *
 * @returns {ethers.Wallet} An ethers Wallet instance.
 */
const getWallet = () => {
  const provider = getProvider();
  return new ethers.Wallet(PRIVATE_KEY, provider);
};

// ---------------------------------------------------------------------------
// Token Helper Functions
// ---------------------------------------------------------------------------
/**
 * Retrieves token details from an ERC20 contract and returns a Uniswap SDK Token instance.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {number} networkId - The network ID.
 * @returns {Promise<Token>} A promise that resolves to a Uniswap SDK Token instance.
 */
export async function getTokenData(
  tokenAddress: string,
  networkId: number
): Promise<Token> {
  const provider = getProvider();
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  const [decimals, symbol, name] = await Promise.all([
    tokenContract.decimals(),
    tokenContract.symbol(),
    tokenContract.name(),
  ]);
  return new Token(networkId, tokenAddress, decimals, symbol, name);
}

/**
 * Retrieves the token balance for a given wallet as a BigNumber.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {string} walletAddress - The wallet address to query.
 * @returns {Promise<BigNumber>} A promise that resolves to the token balance.
 */
export async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string
): Promise<BigNumber> {
  const provider = getProvider();
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  return tokenContract.balanceOf(walletAddress);
}

/**
 * Checks if a wallet's token balance is sufficient for the required amount.
 * Uses ethers' parseUnits to compute the required value.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {string} walletAddress - The wallet address to query.
 * @param {string} requiredAmount - The required token amount (in human-readable format).
 * @returns {Promise<boolean>} A promise that resolves to true if the balance is sufficient, false otherwise.
 */
export async function isBalanceSufficient(
  tokenAddress: string,
  walletAddress: string,
  requiredAmount: string
): Promise<boolean> {
  const provider = getProvider();
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
  const decimals: number = await tokenContract.decimals();
  const balance: BigNumber = await tokenContract.balanceOf(walletAddress);
  const requiredBN = ethers.utils.parseUnits(requiredAmount, decimals);
  return balance.gte(requiredBN);
}

// ---------------------------------------------------------------------------
// Transfer Function
// ---------------------------------------------------------------------------
/**
 * Transfers the entire token balance from the signer's wallet to the specified agent wallet.
 *
 * @param {string} tokenAddress - The token contract address.
 * @param {Signer} signer - An ethers Signer instance controlling the wallet.
 * @param {string} agentWallet - The destination agent wallet address.
 * @param {amount} amount - The amount to transfer (in smallest units).
 * @returns {Promise<{ success: boolean, txHash?: string }>} A promise that resolves to an object containing the success flag and the transfer transaction hash if applicable.
 */
export async function transferAmountToAgentWallet(
  tokenAddress: string,
  signer: Signer,
  agentWallet: string,
  amount: string
): Promise<{ success: boolean; txHash?: string }> {
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
  const walletAddress = await signer.getAddress();
  const balance: BigNumber = await tokenContract.balanceOf(walletAddress);

  if (balance.lt(amount)) {
    logger.info(`Insufficient funds to transfer from ${walletAddress}.`);
    return { success: false };
  }
  const amountBN = ethers.utils.parseUnits(
    amount,
    await tokenContract.decimals()
  );

  const tx = await tokenContract.transfer(agentWallet, amountBN);
  await tx.wait();
  logger.info(
    `Transferred ${amount.toString()} tokens from ${walletAddress} to agent wallet ${agentWallet}.`
  );
  return { success: true, txHash: tx.hash };
}

// ---------------------------------------------------------------------------
// Uniswap Helper Functions
// ---------------------------------------------------------------------------
/**
 * Retrieves the Uniswap pair address for the provided tokens.
 *
 * @param {Token} tokenA - The first token.
 * @param {Token} tokenB - The second token.
 * @param {ethers.providers.Provider} provider - The ethers provider.
 * @returns {Promise<string>} A promise that resolves to the Uniswap pair address.
 */
async function getPairAddress(
  tokenA: Token,
  tokenB: Token,
  provider: ethers.providers.Provider
): Promise<string> {
  const factory = new Contract(
    UNISWAP_V2_FACTORY_ADDRESS,
    FACTORY_ABI,
    provider
  );
  const [token0, token1] = tokenA.sortsBefore(tokenB)
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
  return factory.getPair(token0.address, token1.address);
}

/**
 * Creates a Uniswap Pair instance by fetching reserves from the pair contract.
 *
 * @param {string} pairAddress - The address of the Uniswap pair contract.
 * @param {Token} tokenA - The first token.
 * @param {Token} tokenB - The second token.
 * @param {ethers.providers.Provider} provider - The ethers provider.
 * @returns {Promise<Pair>} A promise that resolves to a Pair instance.
 */
async function getPairInstance(
  pairAddress: string,
  tokenA: Token,
  tokenB: Token,
  provider: ethers.providers.Provider
): Promise<Pair> {
  const pairContract = new Contract(pairAddress, UNISWAP_PAIR_ABI, provider);
  const reserves = await pairContract.getReserves();
  const [token0, token1] = tokenA.sortsBefore(tokenB)
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
  const reserve0 = CurrencyAmount.fromRawAmount(
    token0,
    reserves.reserve0.toString()
  );
  const reserve1 = CurrencyAmount.fromRawAmount(
    token1,
    reserves.reserve1.toString()
  );
  return new Pair(reserve0, reserve1);
}

// ---------------------------------------------------------------------------
// Main Swap Function
// ---------------------------------------------------------------------------
/**
 * Performs a token swap using Uniswap V2 from our token to an external token.
 * After a successful swap, it transfers all swapped tokens to the agent's wallet.
 *
 * @param {string} requiredAmount - The required external token amount in smallest units.
 * @param {string} ourTokenAddress - The address of our token.
 * @param {string} externalTokenAddress - The address of the external token.
 * @param {string} agentWallet - The agent's wallet address.
 * @param {number} networkId - The network ID.
 * @returns {Promise<{ success: boolean, swapTxHash?: string, transferTxHash?: string }>} A promise that resolves to an object containing the success flag and the transaction hashes for the swap and transfer operations.
 */
export async function performSwapForPlan(
  requiredAmount: string,
  ourTokenAddress: string,
  externalTokenAddress: string,
  agentWallet: string,
  networkId: number
): Promise<{ success: boolean; swapTxHash?: string; transferTxHash?: string }> {
  try {
    const provider = getProvider();
    const wallet = getWallet();

    // Fetch token data concurrently.
    const [ourToken, extToken] = await Promise.all([
      getTokenData(ourTokenAddress, networkId),
      getTokenData(externalTokenAddress, networkId),
    ]);

    // Create the desired output amount.
    const amountOut = CurrencyAmount.fromRawAmount(extToken, requiredAmount);

    // Retrieve Uniswap pair address and instance.
    const pairAddress = await getPairAddress(ourToken, extToken, provider);
    const pairInstance = await getPairInstance(
      pairAddress,
      ourToken,
      extToken,
      provider
    );

    // Build the trade route.
    const route = new Route([pairInstance], ourToken, extToken);

    // Create a trade for EXACT_OUTPUT.
    const trade = new Trade(route, amountOut, TradeType.EXACT_OUTPUT);
    const slippageTolerance = new Percent("100", "10000"); // 1%
    const maxAmountIn = trade
      .maximumAmountIn(slippageTolerance)
      .quotient.toString();

    // Approve the router to spend our token.
    const ourTokenContract = new Contract(ourToken.address, ERC20_ABI, wallet);
    await ourTokenContract.approve(UNISWAP_V2_ROUTER_ADDRESS, maxAmountIn);

    // Execute the swap.
    const router = new Contract(
      UNISWAP_V2_ROUTER_ADDRESS,
      UNISWAP_ROUTER_ABI,
      wallet
    );
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const swapTx = await router.swapTokensForExactTokens(
      requiredAmount,
      maxAmountIn,
      [ourToken.address, extToken.address],
      await wallet.getAddress(),
      deadline
    );
    await swapTx.wait();
    logger.info(`Swap completed successfully with TX hash: ${swapTx.hash}`);

    // Transfer all swapped tokens to the agent wallet.
    const transferResult = await transferAmountToAgentWallet(
      extToken.address,
      wallet,
      agentWallet,
      requiredAmount
    );

    return {
      success: true,
      swapTxHash: swapTx.hash,
      transferTxHash: transferResult.txHash,
    };
  } catch (error) {
    logger.error(
      `Swap error: ${error instanceof Error ? error.message : error}`
    );
    return { success: false };
  }
}
