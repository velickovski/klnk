import { createHash, randomUUID } from 'node:crypto';
import {
  NetworkAcceptanceSchema,
  NetworkConnectionSchema,
  NetworkConversationSchema,
  NetworkEventSchema,
  NetworkPolicySchema,
  NetworkProposalSchema,
  NetworkSlotSchema,
  NetworkBusyInputSchema,
  NetworkBusySchema,
  NetworkAvailabilityInputSchema,
  NetworkAvailabilitySchema,
  type NetworkBusy,
  type NetworkAvailability,
  type NetworkAcceptance,
  type NetworkConnection,
  type NetworkConversation,
  type NetworkEvent,
  type NetworkPolicy,
  type NetworkProposal,
  type NetworkReminder,
  type NetworkTerms,
} from '../../../../packages/domain/src/network.js';
import { Database, type SQL } from '../db.js';
import { HttpError } from '../errors.js';
import {
  assertNetworkAuthority,
  canonicalProposalHash,
  meetingRuleAllows,
  networkReceiptId,
  policyAuthorityVersion,
} from './policy.js';
import { lockNetworkOwners, NetworkStore, type NetworkRecord } from './store.js';
import { networkPreferences } from './preferences.js';

function stableId(key: string): string {
  const hex = createHash('sha256').update(`klnk-calendar-v1:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function conflict(code: string, message: string): never {
  throw new HttpError(409, code, message);
}
function notFound(): never {
  throw new HttpError(404, 'not_found', 'Calendar item not found.');
}
function ownersOf(conversation: NetworkConversation) {
  return [conversation.initiatorId, conversation.recipientId].sort();
}
function sameOwners(a: readonly string[], b: readonly string[]) {
  return (
    a.length === 2 && new Set(a).size === 2 && [...a].sort().join(':') === [...b].sort().join(':')
  );
}
function hasOwners(record: NetworkRecord, owners: readonly string[]) {
  return sameOwners([record.ownerA, record.ownerB ?? ''], owners);
}
function sameSlot(a: NetworkTerms['slot'], b: NetworkTerms['slot']) {
  return (
    Date.parse(a.startAt) === Date.parse(b.startAt) &&
    Date.parse(a.endAt) === Date.parse(b.endAt) &&
    a.timezone === b.timezone
  );
}
function acceptanceKey(value: NetworkAcceptance) {
  return JSON.stringify(NetworkAcceptanceSchema.parse(value));
}
function sameAcceptances(a: NetworkAcceptance[], b: NetworkAcceptance[]) {
  return (
    a.length === 2 &&
    b.length === 2 &&
    a.map(acceptanceKey).sort().join('|') === b.map(acceptanceKey).sort().join('|')
  );
}

/** Internal calendar only. No provider transport, device sync or push-delivery claim. */
export class InternalCalendar {
  constructor(private db: Database) {}

  async saveBusy(
    owner: string,
    input: unknown,
    id: string = randomUUID(),
    expectedVersion?: number,
  ): Promise<NetworkBusy> {
    const parsed = NetworkBusyInputSchema.parse(input);
    if (Date.parse(parsed.slot.endAt) <= Date.now())
      conflict('network_busy_expired', 'Choose a busy block that has not ended.');
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = new NetworkStore(this.db, sql),
        old = await store.get<NetworkBusy>('busy', id);
      if (old && (old.ownerA !== owner || old.ownerB)) notFound();
      if (old && old.version !== expectedVersion)
        conflict('network_busy_changed', 'The busy block changed. Refresh before editing.');
      if (!old && expectedVersion !== undefined) notFound();
      const at = new Date().toISOString();
      const value: NetworkBusy = {
        ...parsed,
        id,
        ownerId: owner,
        version: (old?.version ?? 0) + 1,
        createdAt: old?.value.createdAt ?? at,
        updatedAt: at,
      };
      await store.put({
        id,
        kind: 'busy',
        ownerA: owner,
        status: 'active',
        version: value.version,
        value,
      });
      return value;
    });
  }

  async deleteBusy(owner: string, id: string, expectedVersion: number) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = new NetworkStore(this.db, sql),
        old = await store.get<NetworkBusy>('busy', id);
      if (!old || old.ownerA !== owner || old.ownerB) notFound();
      if (old.version !== expectedVersion)
        conflict('network_busy_changed', 'The busy block changed. Refresh before removing it.');
      await store.remove('busy', id);
      return { ok: true as const };
    });
  }

  async confirmAvailability(owner: string, input: unknown): Promise<NetworkAvailability> {
    const parsed = NetworkAvailabilityInputSchema.parse(input),
      through = Date.parse(parsed.confirmedThrough);
    if (through <= Date.now() || through > Date.now() + 30 * 86400000)
      conflict(
        'network_availability_range',
        'Confirm your maintained manual calendar for up to thirty days.',
      );
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = new NetworkStore(this.db, sql),
        id = stableId(`availability:${owner}`),
        old = await store.get<NetworkAvailability>('availability', id);
      const value: NetworkAvailability = {
        ownerId: owner,
        source: 'manual',
        confirmedThrough: parsed.confirmedThrough,
        updatedAt: new Date().toISOString(),
      };
      await store.put({
        id,
        kind: 'availability',
        ownerA: owner,
        status: 'confirmed',
        version: (old?.version ?? 0) + 1,
        value,
      });
      return value;
    });
  }

  /** A source is an explicit owner acknowledgement, never inferred from an
   * empty calendar. Peers receive neither its details nor private busy blocks. */
  async hasAvailability(sql: SQL, owner: string, slot: NetworkTerms['slot']) {
    const record = await new NetworkStore(this.db, sql).get<NetworkAvailability>(
      'availability',
      stableId(`availability:${owner}`),
    );
    if (!record || record.ownerA !== owner || record.ownerB) return false;
    const value = NetworkAvailabilitySchema.parse(record.value);
    return (
      value.ownerId === owner &&
      Date.parse(value.confirmedThrough) > Date.now() &&
      Date.parse(value.confirmedThrough) >= Date.parse(slot.endAt)
    );
  }

  /** A read of current conflicts, not a reservation. Commit repeats it under owner row locks. */
  async available(
    sql: SQL,
    ownerIds: readonly string[],
    input: NetworkTerms['slot'],
    excludingEventId?: string,
  ): Promise<boolean> {
    const slot = NetworkSlotSchema.parse(input),
      store = new NetworkStore(this.db, sql),
      seen = new Set<string>();
    for (const owner of [...new Set(ownerIds)].sort()) {
      for (const record of await store.list<NetworkBusy>(owner, 'busy')) {
        if (record.ownerA !== owner || record.ownerB) continue;
        const block = NetworkBusySchema.parse(record.value);
        if (
          block.ownerId === owner &&
          Date.parse(block.slot.startAt) < Date.parse(slot.endAt) &&
          Date.parse(block.slot.endAt) > Date.parse(slot.startAt)
        )
          return false;
      }
      for (const record of await store.list<NetworkEvent>(owner, 'event')) {
        if (seen.has(record.id) || record.id === excludingEventId) continue;
        seen.add(record.id);
        const event = NetworkEventSchema.parse(record.value);
        if (event.status !== 'confirmed' || !event.terms.participants.includes(owner)) continue;
        if (
          Date.parse(event.terms.slot.startAt) < Date.parse(slot.endAt) &&
          Date.parse(event.terms.slot.endAt) > Date.parse(slot.startAt)
        )
          return false;
      }
    }
    return true;
  }

  /** Caller owns the transaction and persists proposal/acceptances before calling this method. */
  async commit(
    sql: SQL,
    input: NetworkConversation,
    proposed: NetworkProposal,
    accepted: NetworkAcceptance[],
    snapshots: NetworkPolicy[],
    connectionSnapshot: NetworkConnection,
  ): Promise<NetworkEvent> {
    const conversation = NetworkConversationSchema.parse(input),
      proposal = NetworkProposalSchema.parse(proposed);
    const acceptances = accepted.map((value) => NetworkAcceptanceSchema.parse(value)),
      owners = ownersOf(conversation);
    if (!sameOwners(owners, proposal.terms.participants))
      conflict(
        'network_participants_changed',
        'The proposal must have exactly the request participants.',
      );
    // Reentrant when the coordinator already holds them; database row locks serialize overlapping meetings across workers.
    await lockNetworkOwners(sql, owners);
    const store = new NetworkStore(this.db, sql),
      currentRecord = await store.get<NetworkConversation>('conversation', conversation.id);
    if (!currentRecord || !hasOwners(currentRecord, owners)) notFound();
    const current = NetworkConversationSchema.parse(currentRecord.value);
    if (
      current.version !== conversation.version ||
      !sameOwners(ownersOf(current), owners) ||
      JSON.stringify(current.request) !== JSON.stringify(conversation.request)
    )
      conflict('network_conversation_changed', 'The request changed. Refresh before continuing.');
    const eventId = stableId(`event:${current.id}`),
      existing = await store.get<NetworkEvent>('event', eventId);
    // A duplicate delivery can return only the exact previously committed agreement, even after its request expires.
    if (existing) {
      const event = NetworkEventSchema.parse(existing.value);
      if (
        !hasOwners(existing, owners) ||
        event.conversationId !== current.id ||
        event.proposalHash !== proposal.hash ||
        event.proposalVersion !== proposal.version ||
        canonicalProposalHash(proposal.terms) !== event.proposalHash ||
        !sameAcceptances(event.acceptances, acceptances)
      )
        conflict(
          'network_agreement_changed',
          'This conversation already has a different calendar agreement.',
        );
      return event;
    }
    if (
      !['processing', 'awaiting_approval', 'agreed'].includes(current.state) ||
      current.request.kind !== 'meeting'
    )
      conflict('network_not_committable', 'This request cannot create an agreement.');
    if (
      !current.proposal ||
      JSON.stringify(NetworkProposalSchema.parse(current.proposal)) !== JSON.stringify(proposal) ||
      !sameAcceptances(current.acceptances, acceptances)
    )
      conflict(
        'network_acceptance_changed',
        'Only the current persisted proposal and acceptances can create an event.',
      );
    const now = Date.now();
    if (Date.parse(proposal.terms.slot.startAt) <= now)
      conflict(
        'network_slot_started',
        'This meeting would start in the past. Submit a future time.',
      );
    if (
      Date.parse(proposal.expiresAt) <= now ||
      canonicalProposalHash(proposal.terms) !== proposal.hash
    )
      conflict('network_proposal_invalid', 'The proposal has expired or its terms changed.');
    const connectionRecord = await store.get<NetworkConnection>('connection', current.connectionId);
    if (!connectionRecord || !hasOwners(connectionRecord, owners))
      conflict('network_connection_changed', 'The accepted connection is unavailable.');
    const connection = NetworkConnectionSchema.parse(connectionRecord.value),
      policies: NetworkPolicy[] = [];
    for (const owner of owners) {
      const records = (await store.list<NetworkPolicy>(owner, 'policy')).filter(
        (record) => record.ownerA === owner && !record.ownerB,
      );
      if (records.length !== 1)
        conflict('network_policy_changed', 'Current calendar authority is unavailable.');
      const record = records[0]!;
      const policy = NetworkPolicySchema.parse(record.value);
      if (
        policy.ownerId !== owner ||
        snapshots.find((value) => value.ownerId === owner)?.version !== policy.version
      )
        conflict('network_policy_changed', 'Calendar authority changed before commit.');
      policies.push(policy);
    }
    if (
      connectionSnapshot.id !== connection.id ||
      connectionSnapshot.version !== connection.version
    )
      conflict('network_connection_changed', 'The connection changed before commit.');
    assertNetworkAuthority(current, policies, connection, now);
    if (
      proposal.terms.purpose !== current.request.purpose ||
      proposal.terms.topic !== current.request.topic ||
      proposal.terms.location !== current.request.location ||
      (!current.request.candidateSlots.some((slot) => sameSlot(slot, proposal.terms.slot)) &&
        !acceptances.every((acceptance) => acceptance.source === 'owner_approval'))
    )
      conflict(
        'network_terms_out_of_scope',
        'The proposal is outside the exact delegated meeting terms.',
      );
    if (acceptances.length !== 2 || new Set(acceptances.map((value) => value.ownerId)).size !== 2)
      conflict('network_acceptance_missing', 'Both participants must accept the same proposal.');
    for (const owner of owners) {
      const acceptance = acceptances.find((value) => value.ownerId === owner),
        policy = policies.find((value) => value.ownerId === owner)!;
      if (
        !acceptance ||
        acceptance.proposalHash !== proposal.hash ||
        acceptance.proposalVersion !== proposal.version ||
        (acceptance.authorityVersion !== undefined
          ? acceptance.authorityVersion !== policyAuthorityVersion(policy, 'meeting')
          : acceptance.policyVersion !== policy.version) ||
        Date.parse(acceptance.at) > now ||
        Date.parse(acceptance.at) < Date.parse(current.createdAt) ||
        Date.parse(acceptance.at) >= Date.parse(proposal.expiresAt)
      )
        conflict(
          'network_acceptance_invalid',
          'Acceptance must match the current terms, authority and deadline.',
        );
      const peer = owners.find((value) => value !== owner)!;
      if (acceptance.source === 'owner_request' && owner !== current.initiatorId)
        conflict(
          'network_acceptance_invalid',
          'Only the initiating owner submitted these meeting terms.',
        );
      // Routine windows constrain delegated acceptance. The original exact request or an exact owner receipt is separate consent.
      if (
        acceptance.source === 'delegation_rule' &&
        (!meetingRuleAllows(policy, peer, proposal.terms.topic, proposal.terms.slot, now) ||
          !(await this.hasAvailability(sql, owner, proposal.terms.slot)))
      )
        conflict(
          'network_schedule_denied',
          'The meeting is outside a participant’s current scheduling authority.',
        );
      if (acceptance.source === 'owner_approval') {
        const receipt = await store.get<{
          kind: string;
          ownerId: string;
          conversationId: string;
          proposalHash: string;
          proposalVersion: number;
          policyVersion: number;
          authorityVersion?: number;
          at: string;
        }>('receipt', networkReceiptId(current.id, owner, proposal.hash));
        const expected = {
          kind: 'network_approval',
          ownerId: owner,
          conversationId: current.id,
          proposalHash: proposal.hash,
          proposalVersion: proposal.version,
          policyVersion: acceptance.policyVersion,
          ...(acceptance.authorityVersion === undefined
            ? {}
            : { authorityVersion: acceptance.authorityVersion }),
          at: acceptance.at,
        };
        if (
          !receipt ||
          receipt.ownerA !== owner ||
          receipt.ownerB ||
          receipt.status !== 'approved' ||
          JSON.stringify(receipt.value) !== JSON.stringify(expected)
        )
          conflict('network_approval_missing', 'An exact owner approval receipt is required.');
      }
    }
    if (!(await this.available(sql, owners, proposal.terms.slot)))
      conflict(
        'network_calendar_conflict',
        'A participant already has a meeting during this interval.',
      );
    const at = new Date(now).toISOString();
    const event: NetworkEvent = {
      id: eventId,
      conversationId: current.id,
      proposalHash: proposal.hash,
      proposalVersion: proposal.version,
      terms: proposal.terms,
      acceptances,
      status: 'confirmed',
      revision: 1,
      createdAt: at,
    };
    await store.put({
      id: event.id,
      kind: 'event',
      ownerA: owners[0]!,
      ownerB: owners[1]!,
      status: event.status,
      version: event.revision,
      value: event,
    });
    for (const policy of policies) {
      for (const minutes of new Set(policy.reminderMinutes)) {
        const reminder: NetworkReminder = {
          id: stableId(`reminder:${event.id}:${policy.ownerId}:${minutes}`),
          ownerId: policy.ownerId,
          eventId: event.id,
          text: proposal.terms.purpose,
          dueAt: new Date(Date.parse(proposal.terms.slot.startAt) - minutes * 60000).toISOString(),
          timezone: policy.timezone,
          status: 'scheduled',
          createdAt: at,
        };
        await store.put({
          id: reminder.id,
          kind: 'reminder',
          ownerA: policy.ownerId,
          status: reminder.status,
          version: 1,
          value: reminder,
        });
      }
      await this.outbox(store, event, policy.ownerId, 'calendar_confirmed', at);
    }
    return event;
  }

  async list(owner: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = new NetworkStore(this.db, sql),
        now = Date.now();
      const events = (await store.list<NetworkEvent>(owner, 'event'))
        .map((record) => record.value)
        .filter((event) => event.terms.participants.includes(owner))
        .map((event) => this.projectEvent(event, owner))
        .sort((a, b) => Date.parse(a.terms.slot.startAt) - Date.parse(b.terms.slot.startAt));
      const eventIds = new Set(events.map((event) => event.id));
      const reminders = (await store.list<NetworkReminder>(owner, 'reminder'))
        .filter(
          (record) =>
            record.ownerA === owner &&
            !record.ownerB &&
            record.value.ownerId === owner &&
            eventIds.has(record.value.eventId),
        )
        .map(({ value }) => ({
          ...value,
          status:
            value.status === 'scheduled' && Date.parse(value.dueAt) <= now
              ? ('due' as const)
              : value.status,
        }))
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
      const busyBlocks = (await store.list<NetworkBusy>(owner, 'busy'))
        .filter(
          (record) => record.ownerA === owner && !record.ownerB && record.value.ownerId === owner,
        )
        .map((record) => NetworkBusySchema.parse(record.value));
      const source = await store.get<NetworkAvailability>(
        'availability',
        stableId(`availability:${owner}`),
      );
      const availability =
        source?.ownerA === owner && !source.ownerB
          ? NetworkAvailabilitySchema.parse(source.value)
          : null;
      return { events, reminders, busyBlocks, availability, scope: 'klnk_only' as const };
    });
  }

  async cancel(owner: string, eventId: string, revision: number): Promise<NetworkEvent> {
    const initial = await new NetworkStore(this.db).get<NetworkEvent>('event', eventId);
    if (
      !initial ||
      ![initial.ownerA, initial.ownerB].includes(owner) ||
      !initial.value.terms.participants.includes(owner)
    )
      notFound();
    return this.db.transaction(async (sql) => {
      const owners = [initial.ownerA, initial.ownerB!].sort();
      await lockNetworkOwners(sql, owners);
      const store = new NetworkStore(this.db, sql),
        record = await store.get<NetworkEvent>('event', eventId);
      if (!record || !hasOwners(record, owners) || !record.value.terms.participants.includes(owner))
        notFound();
      const event = NetworkEventSchema.parse(record.value);
      if (!Number.isInteger(revision) || revision !== event.revision)
        conflict('network_event_changed', 'The meeting changed. Refresh before cancelling.');
      if (event.status === 'cancelled') return this.projectEvent(event, owner);
      const at = new Date().toISOString(),
        cancelled: NetworkEvent = {
          ...event,
          status: 'cancelled',
          revision: event.revision + 1,
          cancelledAt: at,
          cancelledBy: owner,
        };
      await store.put({
        ...record,
        status: 'cancelled',
        version: cancelled.revision,
        value: cancelled,
      });
      for (const participant of owners) {
        for (const reminder of await store.list<NetworkReminder>(participant, 'reminder')) {
          if (
            reminder.ownerA === participant &&
            !reminder.ownerB &&
            reminder.value.ownerId === participant &&
            reminder.value.eventId === eventId
          )
            await store.put({
              ...reminder,
              status: 'cancelled',
              version: reminder.version + 1,
              value: { ...reminder.value, status: 'cancelled' },
            });
        }
        await this.outbox(store, cancelled, participant, 'calendar_cancelled', at);
      }
      const conversation = await store.get<NetworkConversation>(
        'conversation',
        event.conversationId,
      );
      if (!conversation || !hasOwners(conversation, owners))
        conflict('network_conversation_missing', 'The agreement conversation is unavailable.');
      const value: NetworkConversation = {
        ...conversation.value,
        state: 'cancelled',
        version: conversation.value.version + 1,
        updatedAt: at,
        decisionOwnerIds: [],
        readBy: [owner],
        summary: `Meeting cancelled: ${event.terms.purpose}`,
        nextAction:
          'This internal meeting and its reminders are cancelled. A different time requires a new request and matching acceptances.',
        messages: [
          ...conversation.value.messages.slice(-29),
          {
            id: stableId(`cancel-message:${event.id}:${cancelled.revision}`),
            sequence: (conversation.value.messages.at(-1)?.sequence ?? 0) + 1,
            actorId: owner,
            role: 'server',
            kind: 'close',
            text: 'A participant cancelled the internal meeting. Its in-app reminders are cancelled.',
            at,
            proposalHash: event.proposalHash,
          },
        ],
      };
      await store.put({ ...conversation, status: value.state, version: value.version, value });
      return this.projectEvent(cancelled, owner);
    });
  }

  async dismissReminder(owner: string, id: string): Promise<NetworkReminder> {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = new NetworkStore(this.db, sql),
        record = await store.get<NetworkReminder>('reminder', id);
      if (!record || record.ownerA !== owner || record.ownerB || record.value.ownerId !== owner)
        notFound();
      if (['dismissed', 'cancelled'].includes(record.value.status)) return record.value;
      const value: NetworkReminder = { ...record.value, status: 'dismissed' };
      await store.put({ ...record, status: value.status, version: record.version + 1, value });
      return value;
    });
  }

  private async outbox(
    store: NetworkStore,
    event: NetworkEvent,
    ownerId: string,
    kind: 'calendar_confirmed' | 'calendar_cancelled',
    at: string,
  ) {
    const id = stableId(`outbox:${event.id}:${ownerId}:${kind}:${event.revision}`);
    const preferences = await networkPreferences(store, ownerId);
    const conversation = await store.get<NetworkConversation>('conversation', event.conversationId);
    const connection = conversation
      ? await store.get<NetworkConnection>('connection', conversation.value.connectionId)
      : undefined;
    await store.put({
      id,
      kind: 'outbox',
      ownerA: ownerId,
      status:
        preferences.notificationMode === 'decisions_results' &&
        !connection?.value.mutedBy.includes(ownerId)
          ? 'pending'
          : 'silent',
      version: 1,
      value: {
        id,
        ownerId,
        conversationId: event.conversationId,
        eventId: event.id,
        kind,
        revision: event.revision,
        at,
      },
    });
  }

  private projectEvent(event: NetworkEvent, owner: string): NetworkEvent {
    return {
      ...event,
      acceptances: event.acceptances.map((acceptance) => {
        if (acceptance.ownerId === owner) return acceptance;
        const { authorityVersion, ...sharedProof } = acceptance;
        return sharedProof;
      }),
    };
  }
}
