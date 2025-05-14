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
  PORT: number;
  HOST: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
  OPENAI_API_KEY: string;
  MAX_CONCURRENT_TASKS: number;
  MAX_RETRIES: number;
  RETRY_DELAY: number;
  TASK_TIMEOUT: number;
  PINATA_API_KEY: string;
  PINATA_API_SECRET: string;
}

/**
 * @constant defaultConfig
 * @description Default configuration values
 */
export const defaultConfig: Partial<EnvConfig> = {
  PORT: 3000,
  HOST: "localhost",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  MAX_CONCURRENT_TASKS: 1,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  TASK_TIMEOUT: 300000, // 5 minutes
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
