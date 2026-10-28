# M2 Network contract proposal — not implemented

Owner: `/root/platform`. Prepared while M0/M1 await independent acceptance. No M2 application files were changed. Root owns contracts/routes/migrations and must approve the final shape before this card proceeds.

## Connection revisions

Proposed additions to `NetworkConnectionSchema`:

```ts
status: z.enum(['pending', 'accepted', 'declined', 'blocked', 'removed']),
authorityVersion: z.number().int().positive().optional(),
blockedBy: z.array(id).max(2).optional(),
```

Add `unblock` and `remove` to the connection action route enum. Optional fields support existing stored records: `authorityVersion ?? version` is the previous authority epoch. Unknown historical blockers must fail closed, or require both participants to unblock; do not infer one blocker from an ambiguous disabled-inbound flag.

- Every edit increments optimistic `version`. Only changes to acceptance, blocking/removal, or inbound permission increment `authorityVersion`.
- Mute/unmute changes notification presentation only. It never denies a request or changes the authority epoch. Notification publishers/readers must honour `mutedBy` for their own owner.
- Declined/removed connections can be invited again. Reuse the same record/pair, start a fresh pending invitation and require fresh acceptance. Flip logical `fromId/toId` when the other participant invites, while preserving the original storage record's `ownerA/ownerB`; the store's identity guard must remain intact.
- Block records the acting owner. Unblock only removes that owner's block; any remaining block remains effective. Removing the last block leaves an unaccepted connection requiring a fresh invite, never automatic restored consent.
- Both owners may remove a connection. Old pending work remains fenced by the changed authority epoch.

## Policy edit revision versus delegated authority

Proposed server-managed additions to `NetworkPolicySchema`/`NetworkPolicy` (not policy input):

```ts
authorityVersions: z.object({
  ask: z.number().int().positive(),
  meeting: z.number().int().positive(),
}).strict().optional(),
```

`policy.version` always increments for optimistic updates. For old records, absent operation epochs fall back to their original policy revision. New policies begin at epoch 1. Saving unrelated fields preserves the operation epoch:

- Ask authority depends on enabled, trusted members, topics, allowQuestions, expiry and shared memory selection.
- Meeting authority depends on enabled, trusted members, topics, allowMeetings, autoAcceptMeetings, scheduling constraints and expiry.
- Reminder preferences affect neither authority epoch. Question settings do not invalidate meetings; meeting schedules do not invalidate questions.

Requests and acceptances must bind an explicit operation epoch. Preferred new field: `conversation.authorityVersions`, preserving existing `policyVersions` as the display/audit revision; acceptance records should likewise distinguish authority epoch from edit revision. If root instead reuses `policyVersions` for operation epochs, document that semantic change and update all strict authority/receipt tests together. Never silently rewrite an existing acceptance to manufacture fresh approval.

This first operation-level scheme still conservatively pauses requests when another member/topic in the same operation changes. Truly per-member/topic revocation epochs are a subsequent refinement; do not claim that all possible unrelated edits are independent until those are implemented.

## Plain delivery versus autonomy

- Explicit `inform` delivery requires active accounts, an accepted connection, recipient inbound permission, a future request deadline and no explicit message opt-out. Default disabled autonomy, empty topics, missing mutual trust and expired delegation do not block an owner's exact message to an accepted member.
- A question may similarly reach the recipient owner for an explicit human answer. Only an *automatic answer from memory* needs enabled scoped delegation, current epochs, selected confirmed memories and all existing source/sharing/expiry checks.
- Meetings retain scoped authority and two matching term acceptances. Default policies never grant automatic meeting acceptance or memory disclosure.

Voice `inform` still needs the separate exact readback/dictation confirmation boundary; simplifying network delivery must not bypass that security control.

## Human question answer

Proposed shared input schema and authenticated route:

```ts
NetworkAnswerInputSchema = z.object({
  version: z.number().int().positive(),
  answer: z.string().trim().min(1).max(1500),
}).strict();
// POST /network/conversations/:id/answer
```

An unanswered question becomes `awaiting_approval` with the recipient in `decisionOwnerIds`; no proposal is required for this state. `answer(owner,id,input)` checks the current bearer/account/connection, exact current conversation version, ask kind and recipient ownership inside the owner locks. It publishes exactly the owner's supplied answer with role `owner`, completes `answered`, and ends the task. It cannot mint meeting authority or export private memory. Expired, foreign, cancelled or already answered requests reject stale edits.

## Meeting counterproposal

```ts
NetworkCounterproposalInputSchema = z.object({
  version: z.number().int().positive(),
  slot: NetworkSlotSchema,
}).strict();
// POST /network/conversations/:id/counterproposal
```

Only an owner currently asked for a meeting decision may counterpropose. Preserve purpose/topic/location/participants; validate a future slot and availability. Replace the proposal with a new version/hash, clear old acceptances, save a fresh exact owner-approval receipt for the proposer, and ask the other owner for an explicit decision. Keep the existing deadline and six-exchange bound.

The calendar commit currently requires a slot from the initiator's original candidate list. Permit an alternate slot only when **both owners have new exact owner-approval receipts for that proposal hash/version**. An original `owner_request` acceptance never carries over to a counterproposal, and old receipts cannot approve new terms. Recheck all current authority and availability in the atomic commit.

## Manual availability

Proposed storage kinds: `busy` and `availability` (forward migration of `network_records.kind`, update `NetworkKind`; backup/export/delete remains owner-bound).

```ts
NetworkBusyBlockInputSchema = z.object({
  slot: NetworkSlotSchema,
  label: z.string().trim().min(1).max(80),
}).strict();
NetworkBusyBlockSchema = NetworkBusyBlockInputSchema.extend({
  id, ownerId: id, revision: z.number().int().positive(),
  createdAt: instant, updatedAt: instant,
});
// Owner-only GET/POST /network/calendar/busy
// Owner-only DELETE /network/calendar/busy/:id with expectedRevision

NetworkAvailabilityInputSchema = z.object({
  source: z.literal('manual'),
  validUntil: instant,
  acknowledged: z.literal(true),
}).strict();
// PUT /network/calendar/availability
```

Availability is an explicit owner acknowledgement that their manual klnk calendar is maintained, valid for at most 30 days. Zero busy blocks can be legitimate only after this acknowledgement; absence of busy records alone is not an availability source. Confirming manual availability never claims Google/EventKit sync.

`available()` checks both canonical events and private busy blocks under the same owner locks. Delegated recipient autoaccept requires a current explicit availability source covering the entire slot; the atomic calendar commit repeats this check. Without a source, ask the recipient to approve the exact proposed time. Exact personal approval remains possible after the owner reviews their actual availability.

Calendar output additions should use defaults/optional fields for existing client fixtures: `busyBlocks` and content-free `availability` status for the current owner. Never expose the peer's private busy details or source metadata.

## Required verification

New regressions must cover default message delivery, explicit opt-out/block/expiry, no default memory disclosure or meeting autonomy, mute without delivery blockage and silent notifications, reinvite in both directions with stable storage identity, independent blocker removal, stale-version fencing, unrelated policy settings, recipient-only answers, counterproposal receipt replacement, busy-block conflict checks, source-less autoaccept prevention and concurrent agreement conflicts.

Existing tests asserting that mute blocks delivery, that all policy saves revoke every operation, or that no permitted memory must terminate a question are historical behavior tests. Replace those expectations explicitly after the new product contract is approved, while preserving independent authority and privacy regressions.
