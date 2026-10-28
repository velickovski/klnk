import { randomUUID } from 'node:crypto';
import {
  DEMO_PROFILE,
  DEMO_CONTACTS,
  DEMO_MEMORIES,
  MISSION_TEMPLATES,
} from '../../../packages/domain/src/index.js';
import type { Repository } from './db.js';
/** Produce explicit dates in the demo market, including the offset at that date. */
export function demoDate(daysAhead: number, hour = 13, now = new Date()) {
  const day = new Date(now.getTime() + daysAhead * 86400000);
  const fields = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(day);
  const get = (type: string) => fields.find((f) => f.type === type)!.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  // Sample at midday on the target day so the offset reflects any DST transition.
  const offset =
    new Intl.DateTimeFormat('en', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${date}T18:00:00Z`))
      .find((f) => f.type === 'timeZoneName')!
      .value.replace('GMT', '') || '+00:00';
  return `${date}T${String(hour).padStart(2, '0')}:00:00${offset}`;
}
export async function seedOwner(repo: Repository, owner: string, name: string, demo: boolean) {
  await repo.put(owner, 'profile', { ...DEMO_PROFILE, id: owner, name, onboardingComplete: false });
  await repo.put(owner, 'voice', {
    id: `${owner}:standard`,
    name: 'Standard assistant',
    kind: 'standard',
    status: 'available',
    consent: false,
  });
  if (!demo) return;
  const map = new Map<string, string>();
  for (const c of DEMO_CONTACTS) {
    const id = randomUUID();
    map.set(c.id, id);
    await repo.put(owner, 'contact', { ...c, id, ownerId: owner, demo: true });
  }
  for (const m of DEMO_MEMORIES)
    await repo.put(owner, 'memory', {
      ...m,
      id: randomUUID(),
      ownerId: owner,
      contactId: m.contactId ? map.get(m.contactId) : undefined,
    });
  await repo.put(owner, 'calendar', {
    id: `${owner}:demo-event-sink`,
    title: 'Sink repair',
    startAt: demoDate(2, 10),
    durationMinutes: 60,
    timezone: 'America/New_York',
    revision: 1,
    demo: true,
  });
}
export function ownerTemplates(owner: string, contacts: any[]) {
  const target = demoDate(1),
    dateLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(target));
  return MISSION_TEMPLATES.map((t) => ({
    ...t,
    input: {
      ...t.input,
      ...(t.id === 'appointment'
        ? {
            goal: `Move our sink-repair appointment to ${dateLabel} at 13:00 America/New_York. Keep the original booking unless the replacement is confirmed. Ask about any extra fee.`,
            requiredTalkingPoints: [
              `Could we move the sink repair to ${dateLabel} at 1 PM Eastern? Please keep the original unless you confirm the replacement. Is there an additional fee?`,
            ],
            schedule: { ...t.input.schedule, explicitTargetAt: target },
          }
        : {}),
      contactId:
        contacts.find(
          (c) =>
            c.relationship === DEMO_CONTACTS.find((s) => s.id === t.input.contactId)?.relationship,
        )?.id ??
        contacts[0]?.id ??
        '',
      followUpActions: t.input.followUpActions.map((a) => ({
        ...a,
        payload: {
          ...a.payload,
          ...(a.payload.eventId
            ? { eventId: `${owner}:${a.payload.eventId}`, startAt: target }
            : {}),
          ...(a.kind === 'reminder' ? { dueAt: demoDate(4, 17) } : {}),
        },
      })),
    },
  }));
}
