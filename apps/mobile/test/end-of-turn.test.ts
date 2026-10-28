import { describe, expect, it } from 'vitest';
import { advanceTurnMeter, TURN_LIMITS, type TurnMeter } from '../src/end-of-turn';

describe('foreground level-based voice turn completion', () => {
  it('submits after measured speech followed by two seconds of quiet, without another tap', () => {
    let state: TurnMeter = { startedAtMs: 0 };
    state = advanceTurnMeter(state, 1000, -25).state;
    expect(advanceTurnMeter(state, 2999, -65).action).toBe('listen');
    expect(advanceTurnMeter(state, 3000, -65).action).toBe('submit');
  });

  it('allows a shorter pause and resets the quiet window when speech resumes', () => {
    let state = advanceTurnMeter({ startedAtMs: 0 }, 1000, -30).state;
    state = advanceTurnMeter(state, 2900, -70).state;
    state = advanceTurnMeter(state, 2950, -35).state;
    expect(advanceTurnMeter(state, 4900, -70).action).toBe('listen');
    expect(advanceTurnMeter(state, 4950, -70).action).toBe('submit');
  });

  it('cancels a measured initially silent recording after eight seconds instead of uploading it', () => {
    const state: TurnMeter = { startedAtMs: 0 };
    expect(advanceTurnMeter(state, 7999, -90).action).toBe('listen');
    expect(advanceTurnMeter(state, 8000, -90).action).toBe('cancel_silence');
  });

  it('keeps manual completion available when metering is absent or invalid, with a hard thirty-second bound', () => {
    const state: TurnMeter = { startedAtMs: 0 };
    expect(advanceTurnMeter(state, 10000).action).toBe('listen');
    expect(advanceTurnMeter(state, 15000, Number.NaN).action).toBe('listen');
    expect(advanceTurnMeter(state, TURN_LIMITS.maximumMs).action).toBe('hold');
  });

  it('ignores stale meter timestamps instead of ending a different turn', () => {
    const state = advanceTurnMeter({ startedAtMs: 0 }, 4000, -25).state;
    expect(advanceTurnMeter(state, 1000, -90)).toEqual({ state, action: 'listen' });
    expect(advanceTurnMeter(state, Number.NaN, -90)).toEqual({ state, action: 'listen' });
  });

  it('manual send disables both silence deadlines but keeps the thirty-second capture bound', () => {
    const speech=advanceTurnMeter({startedAtMs:0},1000,-25,true).state;
    expect(advanceTurnMeter(speech,4000,-90,true).action).toBe('listen');
    expect(advanceTurnMeter({startedAtMs:0},9000,-90,true).action).toBe('listen');
    expect(advanceTurnMeter(speech,TURN_LIMITS.maximumMs,-25,true).action).toBe('hold');
    expect(advanceTurnMeter(speech,TURN_LIMITS.maximumMs,-25).action).toBe('hold');
  });
});
