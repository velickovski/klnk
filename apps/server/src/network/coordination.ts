import { createHash, randomBytes } from 'node:crypto';
import {
  NetworkDecisionSchema,
  NetworkMemoryInputSchema,
  NetworkPolicyInputSchema,
  NetworkRequestInputSchema,
  type NetworkAcceptance,
  type NetworkConnection,
  type NetworkConversation,
  type NetworkMember,
  type NetworkMemory,
  type NetworkPolicy,
  type NetworkPolicyInput,
  type NetworkRequestInput,
  type NetworkTerms,
} from '../../../../packages/domain/src/network.js';
import { Database, type SQL } from '../db.js';
import { HttpError } from '../errors.js';
import { InternalCalendar } from './calendar.js';
import { NetworkStore, lockNetworkOwners, networkId } from './store.js';
import {
  assertNetworkAuthority,
  canonicalProposalHash,
  defaultNetworkPolicy,
  meetingRuleAllows,
  networkReceiptId,
} from './policy.js';
import { publishNetworkNotification, sweepNetworkRetention } from './preferences.js';
import { workerLogger, type WorkerLogger } from '../worker-logging.js';

type Task = {
  id: string;
  conversationId: string;
  actorId: string;
  createdAt: string;
  stopReason?: string;
};
type ConnectionChange = {
  action:
    | 'accept'
    | 'decline'
    | 'block'
    | 'mute'
    | 'unmute'
    | 'allow_inbound'
    | 'deny_inbound'
    | 'inbound';
  version?: number;
  expectedVersion?: number;
  enabled?: boolean;
};
const terminal = new Set<NetworkConversation['state']>([
  'agreed',
  'delivered',
  'answered',
  'declined',
  'unresolved',
  'expired',
  'cancelled',
]);
const nowIso = () => new Date().toISOString();
const conflict = (code: string, message: string): never => {
  throw new HttpError(409, code, message);
};
function privateId(owner: string, kind: string) {
  const h = createHash('sha256').update(`network-${kind}:${owner}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function sameInput(a: NetworkRequestInput, b: NetworkRequestInput) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Background actors have no login session and no provider tools. All effects are local, owner-locked steps. */
export class NetworkCoordinator {
  private store: NetworkStore;
  private timer?: ReturnType<typeof setInterval>;
  private activeTicks = new Set<Promise<void>>();
  private stopping = false;
  private running = false;
  private lastSweep = 0;
  private readonly logger: WorkerLogger;
  constructor(
    private db: Database,
    private calendar: InternalCalendar,
    runtime: { logger?: WorkerLogger } = {},
  ) {
    this.store = new NetworkStore(db);
    this.logger = runtime.logger ?? workerLogger;
  }
  async identity(owner: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = this.store.in(sql);
      return {
        member: await this.member(store, owner),
        delivery: 'internal' as const,
        externalEffectsEnabled: false as const,
        cloudProcessor: 'OpenAI owner conversation; optional reasoning' as const,
      };
    });
  }
  private async member(store: NetworkStore, owner: string): Promise<NetworkMember> {
    const id = privateId(owner, 'identity'),
      old = await store.get<NetworkMember>('identity', id);
    const [profile] = await store.sql.query(
      "SELECT payload FROM resources WHERE owner_id=$1 AND kind='profile' AND id=$1",
      [owner],
    );
    const name = profile
      ? (this.db.decrypt<{ name?: string }>(profile.payload).name ?? 'klnk member')
      : 'klnk member';
    const member = {
      id: owner,
      name,
      memberCode: old?.value.memberCode ?? `klnk_${randomBytes(18).toString('base64url')}`,
    };
    if (!old || old.value.name !== name)
      await store.put({
        id,
        kind: 'identity',
        ownerA: owner,
        status: 'active',
        version: old ? old.version + 1 : 1,
        value: member,
      });
    return member;
  }
  async invite(owner: string, memberCode: string) {
    const rows = await this.db.query("SELECT * FROM network_records WHERE kind='identity'");
    const target = rows
      .map((r) => this.db.decrypt<NetworkMember>(r.payload))
      .find((m) => m.memberCode === memberCode);
    if (!target || target.id === owner)
      throw new HttpError(404, 'member_not_found', 'That member code is unavailable.');
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner, target.id]);
      const store = this.store.in(sql),
        existing = (await store.list<NetworkConnection>(owner, 'connection')).find(
          (r) => r.ownerA === target.id || r.ownerB === target.id,
        );
      if (existing) return { ...existing.value, peer: await this.member(store, target.id) };
      await this.member(store, owner);
      const at = nowIso(),
        connection: NetworkConnection = {
          id: networkId(),
          fromId: owner,
          toId: target.id,
          status: 'pending',
          version: 1,
          inbound: { [owner]: true, [target.id]: false },
          mutedBy: [],
          createdAt: at,
          updatedAt: at,
        };
      await store.put({
        id: connection.id,
        kind: 'connection',
        ownerA: owner,
        ownerB: target.id,
        status: 'pending',
        version: 1,
        value: connection,
      });
      return { ...connection, peer: await this.member(store, target.id) };
    });
  }
  async connections(owner: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = this.store.in(sql),
        records = await store.list<NetworkConnection>(owner, 'connection');
      return Promise.all(
        records.map(async (r) => ({
          ...r.value,
          peer: (
            await store.get<NetworkMember>(
              'identity',
              privateId(r.ownerA === owner ? r.ownerB! : r.ownerA, 'identity'),
            )
          )?.value,
        })),
      );
    });
  }
  async updateConnection(owner: string, id: string, input: ConnectionChange) {
    const old = await this.connection(this.store, owner, id);
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [old.fromId, old.toId]);
      const store = this.store.in(sql),
        c = await this.connection(store, owner, id);
      if (c.version !== (input.version ?? input.expectedVersion))
        conflict('network_version_conflict', 'The connection changed. Reload before editing.');
      if (input.action === 'block') {
        c.status = 'blocked';
        c.inbound[owner] = false;
      } else if (input.action === 'accept' || input.action === 'decline') {
        if (owner !== c.toId || c.status !== 'pending')
          conflict(
            'network_connection_state',
            'Only the invited owner may answer a pending invitation.',
          );
        c.status = input.action === 'accept' ? 'accepted' : 'declined';
        c.inbound[owner] = input.action === 'accept';
      } else {
        if (c.status !== 'accepted')
          conflict('network_connection_state', 'This connection is not accepted.');
        if (input.action === 'mute') c.mutedBy = [...new Set([...c.mutedBy, owner])];
        else if (input.action === 'unmute') c.mutedBy = c.mutedBy.filter((id) => id !== owner);
        else if (['inbound', 'allow_inbound', 'deny_inbound'].includes(input.action))
          c.inbound[owner] =
            input.action === 'inbound' ? input.enabled === true : input.action === 'allow_inbound';
        else throw new HttpError(400, 'network_connection_action', 'Unknown connection action.');
      }
      c.version++;
      c.updatedAt = nowIso();
      await store.put({
        id,
        kind: 'connection',
        ownerA: c.fromId,
        ownerB: c.toId,
        status: c.status,
        version: c.version,
        value: c,
      });
      return c;
    });
  }
  private async connection(store: NetworkStore, owner: string, id: string) {
    const r = await store.get<NetworkConnection>('connection', id);
    if (!r || ![r.ownerA, r.ownerB].includes(owner))
      throw new HttpError(404, 'not_found', 'Connection not found.');
    return r.value;
  }
  private async getPolicy(store: NetworkStore, owner: string) {
    return (
      (await store.get<NetworkPolicy>('policy', privateId(owner, 'policy')))?.value ??
      defaultNetworkPolicy(owner)
    );
  }
  async policy(owner: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = this.store.in(sql),
        policy = await this.getPolicy(store, owner);
      if (!(await store.get('policy', privateId(owner, 'policy'))))
        await this.putPolicy(store, policy);
      return policy;
    });
  }
  private putPolicy(store: NetworkStore, value: NetworkPolicy) {
    return store.put({
      id: privateId(value.ownerId, 'policy'),
      kind: 'policy',
      ownerA: value.ownerId,
      status: value.enabled ? 'enabled' : 'disabled',
      version: value.version,
      value,
    });
  }
  async savePolicy(owner: string, input: NetworkPolicyInput, expectedVersion: number) {
    const parsed = NetworkPolicyInputSchema.parse(input);
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = this.store.in(sql),
        previous = await this.getPolicy(store, owner);
      if (previous.version !== expectedVersion)
        conflict('network_version_conflict', 'The policy changed. Reload before saving.');
      const policy = {
        ...parsed,
        ownerId: owner,
        version: previous.version + 1,
        updatedAt: nowIso(),
      };
      await this.putPolicy(store, policy);
      return policy;
    });
  }
  async memories(owner: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      return (await this.store.in(sql).list<NetworkMemory>(owner, 'memory')).map((r) => r.value);
    });
  }
  async saveMemory(owner: string, input: unknown, id: string = networkId(), version?: number) {
    const parsed = NetworkMemoryInputSchema.parse(input);
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = this.store.in(sql),
        old = await store.get<NetworkMemory>('memory', id);
      if (old && old.ownerA !== owner) throw new HttpError(404, 'not_found', 'Memory not found.');
      if (old && old.version !== version)
        conflict('network_version_conflict', 'The memory changed. Reload before saving.');
      if (!old && version !== undefined) throw new HttpError(404, 'not_found', 'Memory not found.');
      const at = nowIso(),
        memory: NetworkMemory = {
          ...parsed,
          id,
          ownerId: owner,
          source: 'owner',
          version: (old?.version ?? 0) + 1,
          createdAt: old?.value.createdAt ?? at,
          updatedAt: at,
        };
      await store.put({
        id,
        kind: 'memory',
        ownerA: owner,
        status: memory.confirmed ? 'confirmed' : 'unconfirmed',
        version: memory.version,
        value: memory,
      });
      return memory;
    });
  }
  async deleteMemory(owner: string, id: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const store = this.store.in(sql),
        old = await store.get('memory', id);
      if (!old || old.ownerA !== owner) throw new HttpError(404, 'not_found', 'Memory not found.');
      await store.remove('memory', id);
      return { ok: true };
    });
  }
  async submit(
    owner: string,
    input: NetworkRequestInput,
    expectedAuthority?: {
      policyVersion: number;
      connectionVersion: number;
      requireAutonomy?: boolean;
    },
  ) {
    const parsed = NetworkRequestInputSchema.parse(input),
      connection = await this.connection(this.store, owner, parsed.connectionId),
      recipient = connection.fromId === owner ? connection.toId : connection.fromId;
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner, recipient]);
      const store = this.store.in(sql),
        id = privateId(owner, `request:${parsed.requestId}`),
        old = await store.get<NetworkConversation>('conversation', id);
      if (old) {
        if (!sameInput(old.value.request, parsed))
          conflict(
            'network_request_conflict',
            'That request ID already identifies different instructions.',
          );
        return this.project(old.value, owner);
      }
      if (await store.get('receipt', id))
        throw new HttpError(
          410,
          'network_request_removed',
          'This internal request expired under retention and cannot be recreated by retrying its identifier.',
        );
      const recent = (await store.list<NetworkConversation>(recipient, 'conversation')).map(
        (r) => r.value,
      );
      if (
        recent.filter(
          (c) =>
            c.initiatorId === owner &&
            c.recipientId === recipient &&
            Date.parse(c.createdAt) > Date.now() - 3600000,
        ).length >= 20 ||
        recent.filter((c) => c.recipientId === recipient && !terminal.has(c.state)).length >= 100
      )
        throw new HttpError(
          429,
          'network_rate_limited',
          'The recipient’s internal request limit has been reached. Retry later.',
        );
      if (parsed.kind !== 'meeting' && !parsed.message)
        throw new HttpError(
          400,
          'network_message_required',
          'Include the exact information or question to deliver.',
        );
      if (
        parsed.kind === 'meeting' &&
        parsed.candidateSlots.some((slot) => Date.parse(slot.startAt) <= Date.now())
      )
        throw new HttpError(
          400,
          'network_slot_expired',
          'Submit explicit candidate slots that have not started.',
        );
      const [initiatorPolicy, recipientPolicy] = await Promise.all([
          this.getPolicy(store, owner),
          this.getPolicy(store, recipient),
        ]),
        current = await this.connection(store, owner, parsed.connectionId),
        at = nowIso();
      if (
        expectedAuthority &&
        (initiatorPolicy.version !== expectedAuthority.policyVersion ||
          current.version !== expectedAuthority.connectionVersion)
      )
        conflict(
          'network_authority_changed',
          'Authority changed while your request was prepared. Review the current rules and submit new instructions.',
        );
      if (
        expectedAuthority?.requireAutonomy &&
        parsed.kind === 'meeting' &&
        (!initiatorPolicy.autoAcceptMeetings ||
          !parsed.candidateSlots.every((slot) =>
            meetingRuleAllows(initiatorPolicy, recipient, parsed.topic, slot),
          ))
      )
        conflict('network_autonomy_required', 'These proposed times require your explicit review.');
      if (Date.parse(parsed.expiresAt) > Date.now() + 30 * 86400000)
        throw new HttpError(400, 'network_deadline', 'Requests must expire within thirty days.');
      const conversation: NetworkConversation = {
        id,
        protocolVersion: 1,
        initiatorId: owner,
        recipientId: recipient,
        connectionId: parsed.connectionId,
        request: parsed,
        state: 'queued',
        version: 1,
        connectionVersion: current.version,
        policyVersions: { [owner]: initiatorPolicy.version, [recipient]: recipientPolicy.version },
        messages: [],
        acceptances: [],
        decisionOwnerIds: [],
        summary: 'Request queued for the recipient’s separately authorized agent.',
        nextAction: 'The internal worker will check current authority.',
        turns: 0,
        createdAt: at,
        updatedAt: at,
        readBy: [owner],
      };
      assertNetworkAuthority(conversation, [initiatorPolicy, recipientPolicy], current);
      await this.persist(store, conversation);
      await this.queue(store, conversation);
      return this.project(conversation, owner);
    });
  }
  private project(c: NetworkConversation, owner: string): NetworkConversation {
    return { ...c, policyVersions: { [owner]: c.policyVersions[owner] } };
  }
  async inbox(owner: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const conversations = (
        await this.store.in(sql).list<NetworkConversation>(owner, 'conversation')
      )
        .map((r) => this.project(r.value, owner))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return {
        conversations,
        unread: conversations.filter((c) => !c.readBy.includes(owner)).length,
      };
    });
  }
  async detail(owner: string, id: string) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      return this.project(await this.conversation(this.store.in(sql), owner, id), owner);
    });
  }
  async findRequest(owner: string, requestId: string) {
    return (await this.inbox(owner)).conversations.find(
      (c) => c.initiatorId === owner && c.request.requestId === requestId,
    );
  }
  private async conversation(store: NetworkStore, owner: string, id: string) {
    const r = await store.get<NetworkConversation>('conversation', id);
    if (!r || ![r.ownerA, r.ownerB].includes(owner))
      throw new HttpError(404, 'not_found', 'Request not found.');
    return r.value;
  }
  private async persist(store: NetworkStore, c: NetworkConversation) {
    const old = await store.get<NetworkConversation>('conversation', c.id);
    await store.put({
      id: c.id,
      kind: 'conversation',
      ownerA: c.initiatorId,
      ownerB: c.recipientId,
      status: c.state,
      version: c.version,
      value: c,
    });
    if (old?.value.state !== c.state && c.state !== 'agreed') {
      if (c.state === 'awaiting_approval')
        for (const owner of c.decisionOwnerIds)
          await publishNetworkNotification(store, owner, c, 'decision');
      else if (terminal.has(c.state) || c.state === 'paused')
        for (const owner of [c.initiatorId, c.recipientId])
          await publishNetworkNotification(store, owner, c, 'result');
    }
    return c;
  }
  private async queue(store: NetworkStore, c: NetworkConversation) {
    const id = privateId(c.id, 'task'),
      value: Task = { id, conversationId: c.id, actorId: c.recipientId, createdAt: nowIso() };
    await store.put({
      id,
      kind: 'task',
      ownerA: c.initiatorId,
      ownerB: c.recipientId,
      status: 'queued',
      version: c.version,
      value,
    });
  }
  private async taskStatus(store: NetworkStore, c: NetworkConversation, status: string) {
    const old = await store.get<Task>('task', privateId(c.id, 'task'));
    if (old) await store.put({ ...old, status, version: c.version });
  }
  private message(
    c: NetworkConversation,
    actorId: string,
    kind: NetworkConversation['messages'][number]['kind'],
    text: string,
    role: NetworkConversation['messages'][number]['role'] = 'agent',
  ) {
    if (c.messages.length >= 30)
      conflict('network_exchange_limit', 'The internal exchange reached its limit.');
    c.messages.push({
      id: networkId(),
      sequence: c.messages.length + 1,
      actorId,
      role,
      kind,
      text: text.slice(0, 2000),
      at: nowIso(),
      ...(c.proposal ? { proposalHash: c.proposal.hash } : {}),
    });
  }
  private finish(
    c: NetworkConversation,
    state: NetworkConversation['state'],
    summary: string,
    nextAction = 'No further action is scheduled.',
  ) {
    c.state = state;
    if (state !== 'awaiting_approval') c.decisionOwnerIds = [];
    c.summary = summary;
    c.nextAction = nextAction;
    c.updatedAt = nowIso();
    c.processedAt = c.updatedAt;
    c.version++;
    c.readBy = [];
  }
  private async authority(store: NetworkStore, c: NetworkConversation) {
    const connection = await this.connection(store, c.initiatorId, c.connectionId),
      policies = await Promise.all([
        this.getPolicy(store, c.initiatorId),
        this.getPolicy(store, c.recipientId),
      ]);
    assertNetworkAuthority(c, policies, connection);
    return { connection, policies };
  }
  async decision(owner: string, id: string, input: unknown) {
    const decision = NetworkDecisionSchema.parse(input),
      initial = await this.conversation(this.store, owner, id);
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [initial.initiatorId, initial.recipientId]);
      const store = this.store.in(sql),
        c = await this.conversation(store, owner, id);
      await this.authority(store, c);
      if (
        c.state !== 'awaiting_approval' ||
        !c.decisionOwnerIds.includes(owner) ||
        !c.proposal ||
        c.proposal.hash !== decision.proposalHash ||
        c.proposal.version !== decision.proposalVersion ||
        Date.parse(c.proposal.expiresAt) <= Date.now()
      )
        conflict(
          'network_stale_decision',
          'This exact proposal is no longer awaiting your decision.',
        );
      if (decision.decision === 'decline') {
        this.message(c, owner, 'decline', 'The owner declined this proposal.', 'owner');
        this.finish(c, 'declined', 'The proposal was declined by its recipient.');
        await this.taskStatus(store, c, 'done');
      } else {
        const at = nowIso(),
          acceptance: NetworkAcceptance = {
            ownerId: owner,
            proposalHash: c.proposal!.hash,
            proposalVersion: c.proposal!.version,
            source: 'owner_approval',
            policyVersion: c.policyVersions[owner],
            at,
          };
        c.acceptances = c.acceptances.filter((a) => a.ownerId !== owner);
        c.acceptances.push(acceptance);
        c.decisionOwnerIds = [];
        c.state = 'queued';
        c.version++;
        c.updatedAt = at;
        c.readBy = [owner];
        await store.put({
          id: networkReceiptId(c.id, owner, c.proposal!.hash),
          kind: 'receipt',
          ownerA: owner,
          status: 'approved',
          version: 1,
          value: {
            kind: 'network_approval',
            ownerId: owner,
            conversationId: c.id,
            proposalHash: c.proposal!.hash,
            proposalVersion: c.proposal!.version,
            policyVersion: c.policyVersions[owner],
            at,
          },
        });
        this.message(c, owner, 'accept', 'The owner approved these exact proposal terms.', 'owner');
        await this.queue(store, c);
      }
      await this.persist(store, c);
      return this.project(c, owner);
    });
  }
  async control(owner: string, id: string, action: 'cancel' | 'pause' | 'resume') {
    const initial = await this.conversation(this.store, owner, id);
    const outcome = await this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [initial.initiatorId, initial.recipientId]);
      const store = this.store.in(sql),
        c = await this.conversation(store, owner, id);
      // If a worker committed while this owner was waiting for locks, cancel the recorded agreement next.
      if (c.eventId && action === 'cancel') return { eventIdToCancel: c.eventId };
      if (terminal.has(c.state)) conflict('network_terminal', 'This request has already finished.');
      if (action === 'resume') {
        if (c.state !== 'paused') conflict('network_not_paused', 'This request is not paused.');
        await this.authority(store, c);
        c.state = 'queued';
        c.version++;
        c.updatedAt = nowIso();
        await this.queue(store, c);
      } else if (action === 'pause') {
        this.finish(
          c,
          'paused',
          'An owner paused this request.',
          'Resume while the original authority is current, or submit a new request.',
        );
        await this.taskStatus(store, c, 'paused');
      } else if (action === 'cancel') {
        this.finish(c, 'cancelled', 'An owner cancelled this request before agreement.');
        await this.taskStatus(store, c, 'done');
      } else throw new HttpError(400, 'network_control', 'Unknown request control.');
      await this.persist(store, c);
      return { conversation: this.project(c, owner) };
    });
    if (outcome.eventIdToCancel) {
      const event = (await this.calendar.list(owner)).events.find(
        (e) => e.id === outcome.eventIdToCancel,
      );
      if (!event) throw new HttpError(404, 'not_found', 'Calendar event not found.');
      await this.calendar.cancel(owner, event.id, event.revision);
      return this.detail(owner, id);
    }
    return outcome.conversation!;
  }
  async markRead(owner: string, id: string) {
    const initial = await this.conversation(this.store, owner, id);
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [initial.initiatorId, initial.recipientId]);
      const store = this.store.in(sql),
        c = await this.conversation(store, owner, id);
      c.readBy = [...new Set([...c.readBy, owner])];
      await this.persist(store, c);
      return this.project(c, owner);
    });
  }
  async tick() {
    if (this.stopping || this.running) return;
    this.running = true;
    const run = this.runTick();
    this.activeTicks.add(run);
    try {
      await run;
    } finally {
      this.activeTicks.delete(run);
      this.running = false;
    }
  }
  private async runTick() {
    if (Date.now() - this.lastSweep > 3600000) {
      this.lastSweep = Date.now();
      try {
        await sweepNetworkRetention(this.db);
      } catch {
        this.logger.error({
          event: 'network_retention_sweep_failed',
          reasonCode: 'operation_failed',
        });
      }
    }
    const tasks = await this.db.query(
      "SELECT id,owner_a,owner_b,failure_attempts FROM network_records WHERE kind='task' AND status IN ('queued','waiting') AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()) ORDER BY CASE WHEN status='queued' THEN 0 ELSE 1 END,updated_at,id LIMIT 20",
    );
    for (const task of tasks) {
      try {
        await this.db.transaction(async (sql) => {
          await lockNetworkOwners(sql, [task.owner_a, task.owner_b]);
          const [ready] = await sql.query(
            "SELECT id FROM network_records WHERE id=$1 AND kind='task' AND status IN ('queued','waiting') AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp())",
            [task.id],
          );
          if (!ready) return;
          const store = this.store.in(sql),
            current = await store.get<Task>('task', task.id);
          if (!current || !['queued', 'waiting'].includes(current.status)) return;
          const c = await this.conversation(store, current.ownerA, current.value.conversationId);
          if (c.state === 'awaiting_approval') {
            try {
              await this.authority(store, c);
              if (c.proposal && Date.parse(c.proposal.expiresAt) <= Date.now())
                conflict('network_expired', 'This proposal has expired.');
              // Waiting for an owner is not new work. Preserve the row and its
              // timestamp until authority, expiry, or an owner decision changes.
              if (current.status !== 'waiting') await store.put({ ...current, status: 'waiting' });
            } catch (error) {
              if (!(error instanceof HttpError)) throw error;
              this.finish(
                c,
                error.code === 'network_expired' ? 'expired' : 'paused',
                error.code === 'network_expired'
                  ? 'The proposal expired without an owner decision.'
                  : 'The proposal stopped because current authority changed.',
                'Submit a new request after reviewing current authority.',
              );
              await this.persist(store, c);
              await this.taskStatus(store, c, error.code === 'network_expired' ? 'done' : 'paused');
            }
            return;
          }
          if (c.state !== 'queued') {
            await this.taskStatus(store, c, 'done');
            return;
          }
          await store.put({ ...current, status: 'running' });
          try {
            await this.process(sql, store, c);
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            await store.put({
              ...current,
              status: 'running',
              value: { ...current.value, stopReason: error.code },
            });
            this.finish(
              c,
              error.code === 'network_expired' ? 'expired' : 'paused',
              error.code === 'network_expired'
                ? 'This request expired before completion.'
                : 'The request stopped because current authority is unavailable.',
              'Review the connection and authority; submit a new request if they changed.',
            );
          }
          await this.persist(store, c);
          const status: NetworkConversation['state'] = c.state as NetworkConversation['state'];
          await this.taskStatus(
            store,
            c,
            status === 'paused' ? 'paused' : status === 'awaiting_approval' ? 'waiting' : 'done',
          );
        });
      } catch (error) {
        // This update needs no payload decoding, so a corrupt encrypted task can
        // be retried and quarantined without blocking later owners' requests.
        const unavailable = error instanceof HttpError && error.code === 'member_unavailable';
        const [failure] = await this.db.query(
          `UPDATE network_records SET
            failure_attempts=failure_attempts+1,
            status=CASE WHEN $3::boolean THEN 'done' WHEN failure_attempts+1>=5 THEN 'dead_letter' ELSE status END,
            next_attempt_at=CASE WHEN $3::boolean OR failure_attempts+1>=5 THEN NULL ELSE clock_timestamp()+LEAST(60000,1000*power(2,failure_attempts))::int*interval '1 millisecond' END,
            dead_lettered_at=CASE WHEN NOT $3::boolean AND failure_attempts+1>=5 THEN clock_timestamp() ELSE dead_lettered_at END,
            updated_at=clock_timestamp()
          WHERE id=$1 AND kind='task' AND status IN ('queued','waiting') AND failure_attempts=$2 RETURNING status`,
          [task.id, task.failure_attempts, unavailable],
        );
        if (failure)
          this.logger.error({
            event:
              failure.status === 'dead_letter'
                ? 'network_task_dead_lettered'
                : 'network_task_retry_scheduled',
            reasonCode: unavailable ? 'member_unavailable' : 'operation_failed',
          });
      }
    }
  }
  private async process(sql: SQL, store: NetworkStore, c: NetworkConversation) {
    const { connection, policies } = await this.authority(store, c),
      recipientPolicy = policies.find((p) => p.ownerId === c.recipientId)!;
    if (c.turns >= 6) {
      this.finish(
        c,
        'unresolved',
        'The agents reached six exchanges without a confirmed result.',
        'Submit new instructions with different candidate slots.',
      );
      return;
    }
    if (c.request.kind === 'inform') {
      this.message(c, c.initiatorId, 'inform', c.request.message, 'owner');
      this.finish(
        c,
        'delivered',
        'The approved information was delivered to the recipient’s internal inbox. A read receipt is separate.',
      );
      return;
    }
    if (c.request.kind === 'ask') {
      this.message(c, c.initiatorId, 'ask', c.request.message, 'owner');
      // Private context remains in this owner actor. Only the explicitly selected projection is shared.
      const memories = (await store.list<NetworkMemory>(c.recipientId, 'memory'))
        .map((r) => r.value)
        .filter(
          (m) =>
            recipientPolicy.sharedMemoryIds.includes(m.id) &&
            m.confirmed &&
            m.source === 'owner' &&
            m.sharing === 'connections' &&
            m.memberIds.includes(c.initiatorId) &&
            m.topic === c.request.topic &&
            Date.parse(m.expiresAt) > Date.now(),
        );
      await this.authority(store, c);
      if (!memories.length) {
        this.message(
          c,
          c.recipientId,
          'needs_owner',
          'No currently permitted confirmed answer is available.',
        );
        this.finish(
          c,
          'unresolved',
          'The recipient’s agent has no permitted confirmed answer.',
          'The recipient may share appropriate context, then the initiator can submit a new question.',
        );
      } else {
        this.message(
          c,
          c.recipientId,
          'inform',
          memories
            .map((m) => m.text)
            .join('\n')
            .slice(0, 1500),
        );
        this.finish(
          c,
          'answered',
          'The recipient’s agent answered from explicitly shared, confirmed, unexpired owner context.',
        );
      }
      return;
    }
    if (!c.proposal) {
      const initiatorPolicy = policies.find((p) => p.ownerId === c.initiatorId)!;
      let firstAvailable: NetworkTerms['slot'] | undefined,
        selected: NetworkTerms['slot'] | undefined;
      for (const slot of c.request.candidateSlots) {
        c.turns++;
        // Exact owner requests authorize their submitted slots; only automatic recipient acceptance uses routine windows.
        if (Date.parse(slot.startAt) <= Date.now()) continue;
        if (!(await this.calendar.available(sql, [c.initiatorId, c.recipientId], slot))) continue;
        firstAvailable ??= slot;
        if (meetingRuleAllows(recipientPolicy, c.initiatorId, c.request.topic, slot)) {
          selected = slot;
          break;
        }
      }
      selected ??= firstAvailable;
      if (selected) {
        const terms: NetworkTerms = {
          version: 1,
          participants: [c.initiatorId, c.recipientId].sort(),
          purpose: c.request.purpose,
          topic: c.request.topic,
          slot: selected,
          location: c.request.location,
          obligations: [],
        };
        c.proposal = {
          id: networkId(),
          version: 1,
          hash: canonicalProposalHash(terms),
          terms,
          expiresAt: c.request.expiresAt,
        };
        c.acceptances = [
          {
            ownerId: c.initiatorId,
            proposalHash: c.proposal.hash,
            proposalVersion: c.proposal.version,
            source: 'owner_request',
            policyVersion: initiatorPolicy.version,
            at: nowIso(),
          },
        ];
        this.message(
          c,
          c.initiatorId,
          'propose',
          'A submitted candidate slot is available in the internal calendar.',
        );
        if (meetingRuleAllows(recipientPolicy, c.initiatorId, c.request.topic, selected))
          c.acceptances.push({
            ownerId: c.recipientId,
            proposalHash: c.proposal.hash,
            proposalVersion: c.proposal.version,
            source: 'delegation_rule',
            policyVersion: recipientPolicy.version,
            at: nowIso(),
          });
      }
    }
    if (!c.proposal) {
      this.finish(
        c,
        'unresolved',
        'No mutually permitted free slot was found among the submitted candidates. Only the klnk calendar was checked.',
        'Submit up to three different explicit candidate slots.',
      );
      return;
    }
    if (c.acceptances.length !== 2) {
      c.decisionOwnerIds = [c.recipientId];
      this.message(
        c,
        c.recipientId,
        'needs_owner',
        'This exact proposal requires the recipient’s approval.',
      );
      this.finish(
        c,
        'awaiting_approval',
        'An available proposal needs the recipient’s decision.',
        'Approve or decline the exact proposal before it expires.',
      );
      return;
    }
    await this.authority(store, c);
    c.state = 'processing';
    c.version++;
    c.updatedAt = nowIso();
    await this.persist(store, c);
    try {
      const event = await this.calendar.commit(
        sql,
        c,
        c.proposal,
        c.acceptances,
        policies,
        connection,
      );
      c.eventId = event.id;
      this.message(
        c,
        c.recipientId,
        'accept',
        c.acceptances.find((a) => a.ownerId === c.recipientId)!.source === 'owner_approval'
          ? 'The recipient personally approved these exact terms.'
          : 'The recipient’s agent accepted under its owner’s scheduling rules.',
      );
      this.finish(
        c,
        'agreed',
        `Matching terms were accepted under each owner’s current authority. One internal klnk calendar event is confirmed. ${policies.some((p) => p.reminderMinutes.length) ? 'Configured reminders are scheduled in-app.' : 'No in-app reminders were requested.'}`,
      );
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      if (
        ['network_calendar_conflict', 'calendar_conflict', 'network_slot_unavailable'].includes(
          error.code,
        )
      )
        this.finish(
          c,
          'unresolved',
          'The proposed slot is no longer free in the internal calendar.',
          'Submit a new request with different candidate slots.',
        );
      else throw error;
    }
  }
  start() {
    this.stopping = false;
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tick().catch(() => {
          this.logger.error({
            event: 'network_worker_tick_failed',
            reasonCode: 'operation_failed',
          });
        });
      }, 1000);
      this.timer.unref();
    }
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled([...this.activeTicks]);
  }
}
