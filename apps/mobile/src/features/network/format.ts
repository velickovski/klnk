/** All visible timestamps use one locale-aware formatter, including safe failure copy. */
export function formatDateTime(value: string, timezone?: string, locale?: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return 'Time unavailable';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(instant);
  } catch {
    return 'Time unavailable';
  }
}
export function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
