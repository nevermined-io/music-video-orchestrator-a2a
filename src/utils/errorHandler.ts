/**
 * @file errorHandler.ts
 * @description Advanced error handling implementation for A2A protocol
 */

import { Response } from "express";

/**
 * @class ErrorHandler
 * @description Handles errors and retries for A2A tasks
 */
export class ErrorHandler {
  /**
   * @static
   * @method handleHttpError
   * @description Handles an error in an HTTP response
   * @param {Error} error - Error to handle
   * @param {Response} res - Express response object
   */
  public static handleHttpError(error: Error, res: Response): void {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
