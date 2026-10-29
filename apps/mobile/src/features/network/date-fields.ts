export type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  timezone?: string;
  disabled?: boolean;
  mode?: 'datetime' | 'time';
  endOfDay?: boolean;
};
export function localDateTime(value: string, timezone: string): string {
  if (!Number.isFinite(Date.parse(value))) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
/** Enumerate actual offsets around the selected day. Never silently normalize
 * a missing spring time or select the first of two autumn occurrences. */
export function possibleInstants(value: string, timezone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const naive = Date.parse(value + ':00Z');
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value) return [];
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const at = naive + hours * 3600000;
    const wall = localDateTime(new Date(at).toISOString(), timezone);
    offsets.add(Date.parse(wall + ':00Z') - at);
  }
  return [
    ...new Set(
      [...offsets]
        .map((offset) => new Date(naive - offset).toISOString())
        .filter((candidate) => localDateTime(candidate, timezone) === value),
    ),
  ].sort();
}
export function timezoneLabel(timezone: string) {
  const parts = timezone.split('/');
  return parts.length < 2
    ? timezone
    : `${parts[parts.length - 1].replaceAll('_', ' ')} · ${parts[0]}`;
}
