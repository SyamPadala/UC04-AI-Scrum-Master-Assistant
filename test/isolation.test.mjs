import test from 'node:test'
import assert from 'node:assert/strict'
import { streaksToFlag, withToday } from '../dist/jobs/participation.js'

/**
 * A manual participation count is never saved, so the flagging logic is handed
 * today's count directly. These tests pin down that it reads the same as a
 * saved one would, and that a stale stored count for today never wins.
 */

const TEAM = {
  teamId: 'team-1',
  habitualThreshold: 2,
  members: [
    { memberId: 'm1', displayName: 'Madhavi Andoju' },
    { memberId: 'm2', displayName: 'Syam Padala' }
  ]
}

function day (localDate, statuses) {
  return {
    teamId: 'team-1',
    localDate,
    rate: 0,
    entries: Object.entries(statuses).map(([memberId, status]) => ({ memberId, memberName: memberId, status }))
  }
}

test('today\'s count replaces whatever is stored for today', () => {
  const stored = [day('2026-09-23', { m1: 'missed' }), day('2026-09-22', { m1: 'missed' })]
  const merged = withToday(stored, day('2026-09-23', { m1: 'responded' }))
  assert.equal(merged.length, 2)
  assert.equal(merged.find((r) => r.localDate === '2026-09-23').entries[0].status, 'responded')
})

test('with no count for today, the stored history is used as is', () => {
  const stored = [day('2026-09-22', { m1: 'missed' })]
  assert.deepEqual(withToday(stored, undefined), stored)
})

test('a streak reaching the threshold is flagged', () => {
  const history = [
    day('2026-09-23', { m1: 'missed', m2: 'responded' }),
    day('2026-09-22', { m1: 'missed', m2: 'missed' })
  ]
  const flags = streaksToFlag(TEAM, history, '2026-09-23')
  assert.deepEqual(flags.map((f) => f.memberId), ['m1'])
  assert.deepEqual(flags[0].missedDates, ['2026-09-22', '2026-09-23'])
})

test('a member who replied today ends their streak', () => {
  const stored = [day('2026-09-22', { m1: 'missed' }), day('2026-09-21', { m1: 'missed' })]
  const history = withToday(stored, day('2026-09-23', { m1: 'responded' }))
  assert.deepEqual(streaksToFlag(TEAM, history, '2026-09-23'), [])
})
