import { describe, expect, it } from 'vitest';
import { presentAction, presentMission, presentOutcome } from '../src/features/voice/presentation';
describe('evidence-backed request presentation', () => {
  it('only places awaiting_owner in the decision group', () => {
    expect(presentMission('awaiting_owner').group).toBe('decision');
    for (const status of ['queued', 'authorized', 'calling', 'partial', 'unresolved', 'future'])
      expect(presentMission(status).group).not.toBe('decision');
  });
  it('keeps unknown status neutral without marking destructive request controls supported', () => {
    expect(presentMission('future')).toMatchObject({
      known: false,
      label: 'Status unavailable',
      tone: 'neutral',
    });
    expect(presentMission('completed').known).toBe(true);
    expect(presentAction({ status: 'future' as never })).toMatchObject({
      label: 'Status unavailable',
      tone: 'neutral',
    });
  });
  it('does not equate a cancelled request with provider closure', () => {
    expect(presentMission('cancelled', [{ status: 'connected' }])).toMatchObject({
      label: 'End requested',
      pendingEnd: true,
    });
    expect(
      presentMission('cancelled', [{ status: 'ended', endedAt: '2026-10-27T00:00:00Z' }])
        .pendingEnd,
    ).toBe(false);
  });
  it('never presents a simulated or provider account as independently verified', () => {
    expect(presentOutcome({ status: 'achieved' }, true)).toMatchObject({
      verified: false,
      label: 'Simulated result · No one was contacted',
    });
    expect(presentOutcome({ status: 'achieved' }).verified).toBe(false);
  });
});
