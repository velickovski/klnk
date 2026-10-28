import { logger } from './logging.js';

/** Worker failures contain fixed classifications only. Payloads and provider errors
 * must never be passed to this interface. HTTP composition can inject Pino. */
export interface WorkerLogger {
  error(fields: { event: string; reasonCode: string }): void;
}

export const workerLogger: WorkerLogger = logger;
