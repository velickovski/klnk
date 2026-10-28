import type { Contact, Mission, MissionInput, Memory } from '@personal-agent/domain';
import type { Bootstrap } from '../../models';

type Limits = Bootstrap['limits'];
const durationLabel = (seconds: number) =>
  seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds} seconds`;

/** Intersect the live server limits with the existing domain's supported bounds. */
export function requestChoices(limits: Limits, selectedDuration?: number) {
  const duration = Number.isInteger(limits.maxDurationSeconds)
    ? Math.min(600, limits.maxDurationSeconds)
    : 0;
  const retries = Number.isInteger(limits.maxRetries) ? Math.min(2, limits.maxRetries) : -1;
  const durations =
    duration >= 30
      ? [
          ...new Set([
            30,
            60,
            120,
            180,
            300,
            600,
            duration,
            ...(Number.isInteger(selectedDuration) && selectedDuration! >= 30
              ? [selectedDuration!]
              : []),
          ]),
        ]
          .filter((value) => value <= duration)
          .sort((a, b) => a - b)
      : [];
  return {
    durations: durations.map((value) => ({ label: durationLabel(value), value: String(value) })),
    retries:
      retries >= 0
        ? Array.from({ length: retries + 1 }, (_, value) => ({
            label: value === 0 ? 'No retry' : value === 1 ? 'Once' : 'Twice',
            value: String(value),
          }))
        : [],
    defaultDuration: durations.at(-1) ?? 30,
  };
}

export function requestLimitError(schedule: MissionInput['schedule'], limits: Limits) {
  if (
    !Number.isInteger(limits.dailyAttempts) ||
    limits.dailyAttempts < 1 ||
    !requestChoices(limits).durations.length ||
    !requestChoices(limits).retries.length
  )
    return 'Calling limits are unavailable. Reconnect before saving or authorizing this request. Your draft is still here.';
  if (
    !Number.isInteger(schedule.maxDurationSeconds) ||
    schedule.maxDurationSeconds < 30 ||
    schedule.maxDurationSeconds > Math.min(600, limits.maxDurationSeconds)
  )
    return `Choose a supported duration of at most ${durationLabel(limits.maxDurationSeconds)}. Your instructions have been kept.`;
  if (
    !Number.isInteger(schedule.retryLimit) ||
    schedule.retryLimit < 0 ||
    schedule.retryLimit > Math.min(2, limits.maxRetries)
  )
    return `This server allows ${limits.maxRetries} retries. Choose a supported retry limit before continuing.`;
  return '';
}

/** Confirmation belongs to this complete review, including mutable recipient/context. */
export function reviewIdentity(
  mission: Mission & { reviewVersion?: number },
  recipient: Contact | undefined,
  limits: Limits,
  context: Memory[] = [],
) {
  return JSON.stringify({
    mission,
    recipient: recipient
      ? {
          id: recipient.id,
          name: recipient.name,
          phone: recipient.phone,
          verified: recipient.verified,
          optedOut: recipient.optedOut,
          language: recipient.language,
        }
      : null,
    limits,
    context,
  });
}

export function guidanceAfterSave(current: string, submitted: string, succeeded: boolean) {
  return succeeded && current === submitted ? '' : current;
}
