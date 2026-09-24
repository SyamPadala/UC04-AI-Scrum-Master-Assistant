import test from 'node:test'
import assert from 'node:assert/strict'
import { checkSchedule, mayManage, normaliseEmail } from '../dist/admin/validate.js'
import { seal, unseal, readCookie } from '../dist/admin/session.js'

/** The admin page's server-side checks (SPEC-008). */

const good = {
  standupTime: '09:30', summaryTime: '18:00', timezone: 'Asia/Kolkata',
  gracePeriodMinutes: 120, habitualThreshold: 2, active: true
}

test('a valid schedule is accepted as typed values', () => {
  const result = checkSchedule({ ...good, gracePeriodMinutes: '120', active: 'false' }, 5)
  assert.equal(result.ok, true)
  assert.equal(result.value.gracePeriodMinutes, 120)
  assert.equal(result.value.active, false)
})

test('a malformed time is refused with the field named', () => {
  const result = checkSchedule({ ...good, standupTime: '9.30' }, 5)
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /Stand-up time/)
})

test('an unknown timezone is refused', () => {
  const result = checkSchedule({ ...good, timezone: 'Mars/Olympus' }, 5)
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /timezone/)
})

test('a follow-up that would land after the summary is refused', () => {
  const result = checkSchedule({ ...good, standupTime: '17:00', gracePeriodMinutes: 120 }, 5)
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /after the summary/)
})

test('a threshold above the rolling window is refused', () => {
  const result = checkSchedule({ ...good, habitualThreshold: 6 }, 5)
  assert.equal(result.ok, false)
})

test('email addresses are normalised and typos refused', () => {
  assert.equal(normaliseEmail('  Madhavi.Andoju@SyamPadala.onmicrosoft.com '), 'madhavi.andoju@syampadala.onmicrosoft.com')
  assert.equal(normaliseEmail('madhavi'), undefined)
  assert.equal(normaliseEmail('a b@c.com'), undefined)
})

test('only the Scrum Master or an admin may manage a team', () => {
  const team = { scrumMasterId: 'sm-1' }
  assert.equal(mayManage(team, 'sm-1', []), true)
  assert.equal(mayManage(team, 'member-2', []), false)
  assert.equal(mayManage(team, 'admin-9', ['admin-9']), true)
  assert.equal(mayManage(team, '', ['']), false, 'no identity is never a match')
})

test('a sealed session round-trips and a tampered one is rejected', () => {
  const sealed = seal({ oid: 'sm-1', name: 'Syam', exp: Date.now() + 60_000 }, 'secret')
  assert.equal(unseal(sealed, 'secret').oid, 'sm-1')
  assert.equal(unseal(sealed, 'other-secret'), undefined)

  const [body, sig] = sealed.split('.')
  const forged = Buffer.from(JSON.stringify({ oid: 'admin', name: 'x', exp: Date.now() + 60_000 })).toString('base64url')
  assert.equal(unseal(`${forged}.${sig}`, 'secret'), undefined)
  assert.equal(unseal(`${body}.`, 'secret'), undefined)
})

test('an expired session is rejected', () => {
  assert.equal(unseal(seal({ oid: 'sm-1', exp: Date.now() - 1 }, 'secret'), 'secret'), undefined)
})

test('cookies are read by exact name', () => {
  assert.equal(readCookie('a=1; sa_session=abc.def; b=2', 'sa_session'), 'abc.def')
  assert.equal(readCookie('xsa_session=1', 'sa_session'), undefined)
})
