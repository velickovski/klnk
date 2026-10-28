import type {
  Attempt,
  Contact,
  FollowUpAction,
  Memory,
  Mission,
  MissionTemplate,
  Outcome,
  Profile,
  TranscriptEntry,
} from '@personal-agent/domain';
import type { LiveReadiness } from './api';

export type Capabilities = Record<string, boolean | string | Record<string, unknown>>;
export type Bootstrap = {
  profile: Profile;
  contacts: Contact[];
  memories: Memory[];
  missions: ReviewedMission[];
  templates: MissionTemplate[];
  capabilities: Capabilities;
  mode: string;
  liveCallsEnabled?: boolean;
  liveReadiness?: LiveReadiness;
  limits: { dailyAttempts: number; maxDurationSeconds: number; maxRetries: number };
  integrations: { id: string; name: string; status: string; detail: string }[];
};
export type ReviewedMission = Mission & { reviewVersion?: number };
export type MissionDetail = Mission & {
  attempts: Attempt[];
  actions: FollowUpAction[];
  outcome?: Outcome;
  transcript: TranscriptEntry[];
  context?: Memory[];
  executionNotice?: string;
  demo?: boolean;
  executionProvider?: string;
  capabilities?: Capabilities;
};
export const ACTIVE = ['queued', 'authorized', 'calling', 'awaiting_owner'];
export const LANGUAGES = [
  { label: 'English', value: 'en' },
  { label: 'Spanish', value: 'es' },
  { label: 'French', value: 'fr' },
  { label: 'Macedonian', value: 'mk' },
];

export function hasCapability(capabilities: Capabilities, name: string) {
  if (typeof capabilities[name] === 'boolean') return capabilities[name] as boolean;
  const nested = capabilities.simulator ?? capabilities.elevenlabs ?? capabilities.telephony;
  return !!(nested && typeof nested === 'object' && nested[name] === true);
}

export function localDate(value: string, timezone?: string) {
  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return value;
  }
}
