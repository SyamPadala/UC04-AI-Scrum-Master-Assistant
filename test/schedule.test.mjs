import test from 'node:test'
import assert from 'node:assert/strict'
import { isDue, localTime, scheduledMinutes } from '../dist/jobs/schedule.js'
import { localDate } from '../dist/config/time.js'

/**
 * Schedule evaluation (SPEC-001 verification 1 and 3).
 *
 * Fixed clocks, no wall-clock dependency: a test that passes only in the
 * afternoon is worse than no test.
 */

const team = {
  teamId: 't1',
  timezone: 'Asia/Kolkata',
  standupTime: '09:00',
  gracePeriodMinutes: 120,
  summaryTime: '18:00'
}

// 03:30 UTC is 09:00 in Asia/Kolkata.
const at = (utcIso) => new Date(utcIso)

test('job times are derived from the team schedule', () => {
  assert.equal(scheduledMinutes(team, 'reminder'), 540)
  assert.equal(scheduledMinutes(team, 'followup'), 660, 'stand-up plus the grace period (A2)')
  assert.equal(scheduledMinutes(team, 'summary'), 1080)
  assert.equal(scheduledMinutes(team, 'participation'), 1085, 'counted after the summary has gone')
})

test('the reminder is not due before the stand-up time', () => {
  assert.equal(isDue(team, 'reminder', at('2026-09-21T03:25:00Z')), false)
})

test('the reminder is due at the stand-up time', () => {
  assert.equal(isDue(team, 'reminder', at('2026-09-21T03:30:00Z')), true)
})

test('a missed tick still finds the job due later the same day', () => {
  // Service down at 09:00; the 11:00 tick must still send, not skip the day.
  assert.equal(isDue(team, 'reminder', at('2026-09-21T05:30:00Z')), true)
})

test('the follow-up waits for the full grace period', () => {
  assert.equal(isDue(team, 'followup', at('2026-09-21T05:25:00Z')), false, '10:55 local')
  assert.equal(isDue(team, 'followup', at('2026-09-21T05:30:00Z')), true, '11:00 local')
})

test('the same instant is a different local time in a different zone', () => {
  const london = { ...team, timezone: 'Europe/London' }
  assert.equal(localTime(at('2026-09-21T03:30:00Z'), 'Asia/Kolkata'), '09:00')
  assert.equal(localTime(at('2026-09-21T03:30:00Z'), 'Europe/London'), '04:30')
  assert.equal(isDue(team, 'reminder', at('2026-09-21T03:30:00Z')), true)
  assert.equal(isDue(london, 'reminder', at('2026-09-21T03:30:00Z')), false, 'FR-10: teams run on their own clocks')
})

test('an evening update in India is filed under that day, not the previous one', () => {
  // 19:00 UTC is 00:30 the next day in Kolkata; taking the date from UTC would
  // file it a day early.
  assert.equal(localDate(at('2026-09-21T19:00:00Z'), 'Asia/Kolkata'), '2026-09-22')
  assert.equal(localDate(at('2026-09-21T12:00:00Z'), 'Asia/Kolkata'), '2026-09-21')
})

test('a daylight-saving shift moves the job with the local clock', () => {
  const london = { ...team, timezone: 'Europe/London' }
  // 08:00 UTC is 09:00 local in BST and 08:00 local in GMT.
  assert.equal(isDue(london, 'reminder', at('2026-07-01T08:00:00Z')), true, 'summer time')
  assert.equal(isDue(london, 'reminder', at('2026-12-01T08:00:00Z')), false, 'winter time')
})
