/**
 * @file env.ts
 * @description Environment configuration and validation
 */

import dotenv from "dotenv";

dotenv.config();

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
export const PINATA_API_KEY = process.env.PINATA_API_KEY!;
export const PINATA_API_SECRET = process.env.PINATA_API_SECRET!;

export interface EnvConfig {
  /** The port the server listens on */
  PORT: number;
  /** The host the server binds to */
  HOST: string;
  /** Node environment (development, production, etc.) */
  NODE_ENV: string;
  /** Log level for the logger */
  LOG_LEVEL: string;
  /** OpenAI API key */
  OPENAI_API_KEY: string;
  /** Maximum number of concurrent tasks */
  MAX_CONCURRENT_TASKS: number;
  /** Maximum number of retries for a task */
  MAX_RETRIES: number;
  /** Delay between retries in ms */
  RETRY_DELAY: number;
  /** Task timeout in ms */
  TASK_TIMEOUT: number;
  /** Pinata API key for IPFS uploads */
  PINATA_API_KEY: string;
  /** Pinata API secret for IPFS uploads */
  PINATA_API_SECRET: string;
}

/**
 * @constant defaultConfig
 * @description Default configuration values
 */
export const defaultConfig: Partial<EnvConfig> = {
  PORT: 8000,
  HOST: "localhost",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  MAX_CONCURRENT_TASKS: 1,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  TASK_TIMEOUT: 300000, // 5 minutes
  OPENAI_API_KEY: "",
  PINATA_API_KEY: "",
  PINATA_API_SECRET: "",
};

/**
 * @constant requiredEnvVars
 * @description List of required environment variables
 */
export const requiredEnvVars: (keyof EnvConfig)[] = [
  "OPENAI_API_KEY",
  "PINATA_API_KEY",
  "PINATA_API_SECRET",
];
