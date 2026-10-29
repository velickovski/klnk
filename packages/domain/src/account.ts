import { z } from 'zod';
export const AccountStatusSchema = z
  .object({
    email: z.email(),
    emailVerified: z.boolean(),
    mailDelivery: z.enum(['disabled', 'configured']),
    reauthenticated: z.boolean(),
  })
  .strict();
export type AccountStatus = z.infer<typeof AccountStatusSchema>;
export const AccountRequestResultSchema = z
  .object({
    accepted: z.literal(true),
    status: z.literal('pending'),
    delivery: z.enum(['disabled', 'configured']),
    message: z.string().max(1000),
  })
  .strict();
export const AccountMutationResultSchema = z
  .object({ ok: z.literal(true), requiresSignIn: z.literal(true) })
  .strict();
export const AccountReauthenticationSchema = z
  .object({
    ok: z.literal(true),
    reauthenticated: z.literal(true),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
