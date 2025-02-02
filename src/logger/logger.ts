import pino from "pino";

/**
 * Provides a configured logger using the pino library.
 * Transport is set to "pino-pretty" for human-readable output.
 * Default log level is "info".
 */
export const logger = pino({
  transport: { target: "pino-pretty" },
  level: "info",
});
