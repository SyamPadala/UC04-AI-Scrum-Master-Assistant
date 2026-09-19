/**
 * The stand-up date in the team's timezone.
 *
 * Taking the date from UTC puts an evening update in India on the previous
 * day, which silently files it under the wrong stand-up. Per-team timezones
 * arrive with SPEC-001; until then every team uses DEFAULT_TIMEZONE.
 */
export function localDate (at: Date, timeZone: string): string {
  // 'en-CA' formats as YYYY-MM-DD, which is the shape the tracker expects.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at)
}
