import { createHash } from 'node:crypto';
import type {
  ApplicationToolName,
  ApplicationToolStatus,
} from '../../../../packages/domain/src/index.js';

/** Created by the authenticated broker, never decoded from model arguments. */
export type ToolActorContext = {
  ownerId: string;
  liveReceiptId: string;
  authSessionHash: string;
  callId: string;
  authorizedMissionId?: string;
};
export type ToolOutcome = {
  schemaVersion: 1;
  requestId: string;
  toolName: ApplicationToolName;
  status: ApplicationToolStatus;
  reasonCode: string;
  verification:
    | 'local_commit'
    | 'provider_readback'
    | 'provider_terminal_event'
    | 'unconfirmed'
    | 'policy_denial';
  data?: Record<string, unknown>;
};
export interface OwnerToolGateway {
  invoke(context: ToolActorContext, toolName: string, argumentsJson: string): Promise<ToolOutcome>;
}
/** Stable metadata identity, not a digest of private arguments or voice content. */
export function toolRequestId(
  context: Pick<ToolActorContext, 'ownerId' | 'liveReceiptId' | 'callId'>,
) {
  const bytes = createHash('sha256')
    .update(JSON.stringify([context.ownerId, context.liveReceiptId, context.callId]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x80;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
