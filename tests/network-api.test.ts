import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';
import { networkRequestActor, lockNetworkOwners } from '../apps/server/src/network/store.js';
import { hashToken } from '../apps/server/src/auth.js';

describe('internal network authenticated vertical slice and lifecycle', () => {
  let s: Awaited<ReturnType<typeof createApp>>,
    alice: any,
    jordan: any,
    outsider: any,
    connection: any,
    conversation: any,
    event: any;
  const key = 'b'.repeat(64);
  const request = async (
    who: any,
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    payload?: any,
  ) =>
    s.app.inject({
      url,
      method,
      headers: { authorization: `Bearer ${who.token}` },
      ...(payload ? { payload } : {}),
    });
  beforeAll(async () => {
    const db = await new Database({ dataDir: 'memory://', key }).open();
    s = await createApp({
      db,
      worker: false,
      config: {
        ...getConfig(),
        production: false,
        demoEnabled: true,
        provider: 'simulator',
        liveEnabled: false,
        openaiKey: undefined,
        elevenKey: undefined,
        twilioToken: undefined,
        googleClientSecret: undefined,
      },
    });
    const register = async (name: string) =>
      (
        await s.app.inject({
          url: '/auth/register',
          method: 'POST',
          payload: {
            name,
            email: `${randomUUID()}@example.invalid`,
            password: 'fictional-password-42',
          },
        })
      ).json();
    alice = await register('Alice');
    jordan = await register('Jordan Lee');
    outsider = await register('Mallory');
  });
  afterAll(async () => {
    await s.app.close();
    await s.db.close();
  });
  it('accepts only explicit immutable member linkage, with default autonomy off', async () => {
    expect((await s.app.inject({ url: '/network/identity' })).statusCode).toBe(401);
    const identity = (await request(jordan, '/network/identity')).json();
    expect(identity.member.name).toBe('Jordan Lee');
    expect(identity.externalEffectsEnabled).toBe(false);
    expect(
      (
        await request(alice, '/network/connections', 'POST', {
          memberCode: 'jordan@example.invalid',
        })
      ).statusCode,
    ).toBe(404);
    connection = (
      await request(alice, '/network/connections', 'POST', {
        memberCode: identity.member.memberCode,
      })
    ).json();
    expect(connection.status).toBe('pending');
    expect(
      (
        await request(outsider, `/network/connections/${connection.id}`, 'PATCH', {
          action: 'accept',
          version: 1,
        })
      ).statusCode,
    ).toBe(404);
    connection = (
      await request(jordan, `/network/connections/${connection.id}`, 'PATCH', {
        action: 'accept',
        version: connection.version,
      })
    ).json();
    expect(connection.status).toBe('accepted');
    expect((await request(jordan, '/network/policy')).json().enabled).toBe(false);
    for (const [user, peer] of [
      [alice, jordan],
      [jordan, alice],
    ]) {
      const old = (await request(user, '/network/policy')).json(),
        { ownerId, version, updatedAt, ...input } = old;
      const saved = await request(user, '/network/policy', 'PUT', {
        expectedVersion: version,
        policy: {
          ...input,
          enabled: true,
          trustedMemberIds: [peer.user.id],
          topics: ['launch'],
          allowMessages: true,
          allowQuestions: true,
          allowMeetings: true,
          autoAcceptMeetings: true,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          workStartMinute: 0,
          workEndMinute: 1440,
          minNoticeMinutes: 0,
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
    }
  });
  it('commits one meeting while recipient is offline, with separate read/agent acceptance states', async () => {
    const start = new Date(Date.now() + 86400000);
    start.setUTCHours(15, 0, 0, 0);
    const body = {
      requestId: randomUUID(),
      connectionId: connection.id,
      kind: 'meeting',
      purpose: 'Discuss the launch',
      topic: 'launch',
      message: 'Find a permitted half hour.',
      candidateSlots: [
        {
          startAt: start.toISOString(),
          endAt: new Date(+start + 30 * 60000).toISOString(),
          timezone: 'UTC',
        },
      ],
      location: 'klnk',
      expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    };
    const created = await request(alice, '/network/conversations', 'POST', body);
    expect(created.statusCode, created.body).toBe(200);
    conversation = created.json();
    await Promise.all([s.network.tick(), s.network.tick()]);
    const result = (await request(alice, `/network/conversations/${conversation.id}`)).json();
    expect(result.state).toBe('agreed');
    expect(result.readBy).not.toContain(jordan.user.id);
    expect(result.acceptances.find((a: any) => a.ownerId === jordan.user.id).source).toBe(
      'delegation_rule',
    );
    const calendar = (await request(jordan, '/network/calendar')).json();
    expect(calendar.scope).toBe('klnk_only');
    expect(calendar.events).toHaveLength(1);
    expect(calendar.reminders).toHaveLength(1);
    event = calendar.events[0];
    expect((await request(alice, '/network/conversations', 'POST', body)).json().id).toBe(
      conversation.id,
    );
    expect(
      (await request(alice, `/network/conversations/requests/${body.requestId}`)).json().id,
    ).toBe(conversation.id);
    expect((await request(outsider, `/network/conversations/${conversation.id}`)).statusCode).toBe(
      404,
    );
    expect((await request(outsider, '/network/calendar')).json().events).toEqual([]);
    expect(
      (await request(jordan, `/network/conversations/${conversation.id}/read`, 'POST', {})).json()
        .readBy,
    ).toContain(jordan.user.id);
    expect((await s.db.query('SELECT count(*)::int AS n FROM jobs'))[0].n).toBe(0);
  });
  it('includes own network state in export without the other private policy or memory', async () => {
    const data = (await request(alice, '/export')).json().agentNetwork;
    expect(data.event).toHaveLength(1);
    expect(data.policy.every((p: any) => p.ownerId === alice.user.id)).toBe(true);
    expect(data.memory).toEqual([]);
    expect((await request(alice, '/ready')).json().agentNetwork.externalEffectsEnabled).toBe(false);
  });
  it('rechecks a trusted HTTP credential after the owner lock, without treating background tasks as browser sessions', async () => {
    await s.db.query('DELETE FROM sessions WHERE owner_id=$1', [outsider.user.id]);
    await expect(
      networkRequestActor.run(
        { ownerId: outsider.user.id, sessionHash: hashToken(outsider.token) },
        () => s.db.transaction((sql) => lockNetworkOwners(sql, [outsider.user.id])),
      ),
    ).rejects.toMatchObject({ code: 'session_expired' });
    await expect(
      s.db.transaction((sql) => lockNetworkOwners(sql, [outsider.user.id])),
    ).resolves.toBeUndefined();
  });
  it('deletion removes shared records/reminders for both; backup restore with deletion journal does not resurrect them', async () => {
    const backup = await s.db.createBackup();
    const deleted = await request(alice, '/account', 'DELETE');
    expect(deleted.statusCode, deleted.body).toBe(200);
    const remaining = (await request(jordan, '/network/calendar')).json();
    expect(remaining.events).toEqual([]);
    expect(remaining.reminders).toEqual([]);
    const restore = await new Database({ dataDir: 'memory://', key }).open();
    try {
      await restore.restoreBackup(backup, { deletedOwnerIds: [alice.user.id] });
      expect(
        (
          await restore.query(
            "SELECT count(*)::int AS n FROM network_records WHERE kind IN ('conversation','event','reminder','outbox','task')",
          )
        )[0].n,
      ).toBe(0);
      expect((await restore.query('SELECT count(*)::int AS n FROM sessions'))[0].n).toBe(0);
    } finally {
      await restore.close();
    }
    expect((await request(jordan, `/network/conversations/${conversation.id}`)).statusCode).toBe(
      404,
    );
  });
});
