import test from 'node:test'
import assert from 'node:assert/strict'
import { ExcelTracker, prepareWorkbook } from '../dist/trackers/excel.js'
import { trackerWorkbook } from '../dist/trackers/xlsx.js'
import { graphRetry } from '../dist/graph/client.js'

/**
 * SPEC-002 item 7: the Excel tracker keeps the SharePoint list's rules (7b),
 * writes every cell as text (7c), never deletes (7d), and the workbook is
 * created from the admin page when the site has none (7e). Graph is faked
 * by an in-memory table that behaves as Excel did in the live probe of
 * 25 Nov 2026: a leading apostrophe is dropped and the rest kept as text.
 */

const COLUMNS = ['Date', 'WIN', 'Description', 'AssignedTo', 'Comment', 'Status', 'AnyBlocker', 'UpdatedBy']

function fakeExcel (t, { file = true, header = COLUMNS, sheetTop = null } = {}) {
  const rows = []
  const calls = []
  const state = { file, header, uploaded: null, tableAdded: false }
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url))
    const method = init.method ?? 'GET'
    if (u.includes('/oauth2/')) return json({ access_token: 'x', expires_in: 3600 })
    calls.push(`${method} ${u.replace('https://graph.microsoft.com/v1.0', '')}`)
    if (method === 'PUT' && u.includes(':/content')) {
      state.file = true
      state.uploaded = init.body
      return json({ id: 'wb1', webUrl: 'https://example/wb1' }, 201)
    }
    if (u.includes('root:/Daily Status Tracker.xlsx')) return state.file ? json({ id: 'wb1', webUrl: 'https://example/wb1' }) : json({ error: { code: 'itemNotFound' } }, 404)
    if (u.includes('/headerRowRange')) return state.header === null ? json({ error: { code: 'ItemNotFound' } }, 404) : json({ values: [state.header] })
    if (u.includes("range(address='A1:H2')")) return json({ values: sheetTop ?? [COLUMNS, COLUMNS.map(() => '')] })
    if (u.endsWith('/tables/add')) { state.tableAdded = true; return json({ name: 'Table1' }, 201) }
    if (method === 'PATCH' && u.endsWith('/tables/Table1')) { state.header = COLUMNS; return json({}) }
    const text = (v) => typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v
    if (u.endsWith('/rows') && method === 'GET') return json({ value: rows.map((values, index) => ({ index, values: [values] })) })
    if (u.endsWith('/rows') && method === 'POST') { rows.push(JSON.parse(init.body).values[0].map(text)); return json({}, 201) }
    const at = u.match(/itemAt\(index=(\d+)\)/)
    if (at && method === 'PATCH') { rows[Number(at[1])] = JSON.parse(init.body).values[0].map(text); return json({}) }
    if (method === 'DELETE') throw new Error('the daily cycle never deletes (7d)')
    return json({ error: { code: 'unexpected', url: u } }, 400)
  }
  return { rows, calls, state }
}

const update = (memberName, localDate, rows) => ({
  teamId: 'team-1', memberId: 'm1', memberName, localDate, rows, rawText: '', capturedAt: new Date()
})
const row = (win, comment, extra = {}) => ({
  win, description: win === null ? null : `Title of ${win}`, assignedTo: '', comment, status: 'In Progress', anyBlocker: null, ...extra
})

test('7b/2a: a new item adds a row; the next day updates that row in place', async (t) => {
  const { rows } = fakeExcel(t)
  await new ExcelTracker('d', 'wb1', ['Gowtham']).write(update('Gowtham', '2026-11-24', [row('CIN-39', 'started')]))
  await new ExcelTracker('d', 'wb1', ['Gowtham']).write(update('Gowtham', '2026-11-25', [row('CIN-39', 'half done')]))

  assert.equal(rows.length, 1, 'one row per member + item')
  assert.deepEqual(rows[0], ['2026-11-25', 'CIN-39', 'Title of CIN-39', 'Gowtham', 'half done', 'In Progress', '', 'Gowtham'])
  const today = await new ExcelTracker('d', 'wb1', ['Gowtham']).readToday('team-1', '2026-11-25')
  assert.equal(today[0].rows[0].comment, 'half done')
})

test('7b/2b: an update with no work item goes to the General row', async (t) => {
  const { rows } = fakeExcel(t)
  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-25', [row(null, 'reviewed PRs')]))
  assert.equal(rows[0][1], '')
  assert.equal(rows[0][2], 'General')
  const today = await new ExcelTracker('d', 'wb1').readToday('team-1', '2026-11-25')
  assert.equal(today[0].rows[0].win, null)
  assert.equal(today[0].rows[0].description, null)
})

test('7b/2d: a blocker stays open until the item is reported without one', async (t) => {
  fakeExcel(t)
  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-24', [row('CIN-40', 'stuck', { status: 'Blocked', anyBlocker: 'no VPN' })]))
  assert.deepEqual((await new ExcelTracker('d', 'wb1').openBlockers('team-1')).map((b) => [b.member, b.workItem, b.since]), [['Gowtham', 'CIN-40', '2026-11-24']])

  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-25', [row('CIN-41', 'other work')]))
  assert.equal((await new ExcelTracker('d', 'wb1').openBlockers('team-1')).length, 1, 'another item leaves the blocker as it is (2c)')

  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-25', [row('CIN-40', 'VPN fixed')]))
  assert.deepEqual(await new ExcelTracker('d', 'wb1').openBlockers('team-1'), [])
})

test('7b/2e-2f: two people on one story keep a row each; AssignedTo is the owner, UpdatedBy the sender', async (t) => {
  const { rows } = fakeExcel(t)
  await new ExcelTracker('d', 'wb1').write(update('Vardhan', '2026-11-25', [row('REQ-1', 'mine')]))
  await new ExcelTracker('d', 'wb1').write(update('Sailaja', '2026-11-25', [row('REQ-1', 'helping', { assignedTo: 'Vardhan' })]))
  assert.equal(rows.length, 2)
  assert.deepEqual([rows[1][3], rows[1][7]], ['Vardhan', 'Sailaja'])
})

test('7b/4c: a team reads only its own members\' rows', async (t) => {
  fakeExcel(t)
  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-25', [row('CIN-39', 'a')]))
  await new ExcelTracker('d', 'wb1').write(update('Stranger', '2026-11-25', [row('X-1', 'b')]))
  const mine = await new ExcelTracker('d', 'wb1', ['Gowtham']).readToday('team-1', '2026-11-25')
  assert.deepEqual(mine.map((u) => u.memberName), ['Gowtham'])
})

test('7c: every cell is sent as text, so "=" stays words and the date stays the date', async (t) => {
  const { rows, calls } = fakeExcel(t)
  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-25', [row('CIN-39', '=HYPERLINK("x") and 0012')]))
  assert.equal(rows[0][0], '2026-11-25')
  assert.equal(rows[0][4], '=HYPERLINK("x") and 0012')
  assert.ok(calls.some((c) => c.startsWith('POST') && c.endsWith('/tables/DailyStatusTracker/rows')))
})

test('7d: rows are never deleted by a write', async (t) => {
  const { calls } = fakeExcel(t)
  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-25', [row('CIN-39', 'a'), row('CIN-40', 'b')]))
  await new ExcelTracker('d', 'wb1').write(update('Gowtham', '2026-11-25', [row('CIN-39', 'c')]))
  assert.ok(!calls.some((c) => c.startsWith('DELETE')))
})

test('7e: with no workbook on the site, it is created with the table', async (t) => {
  const { state } = fakeExcel(t, { file: false, header: null })
  const prepared = await prepareWorkbook('d')
  assert.deepEqual(prepared, { itemId: 'wb1', webUrl: 'https://example/wb1', created: true })
  assert.ok(state.uploaded instanceof Uint8Array, 'the workbook was uploaded')
  assert.ok(state.tableAdded, 'the header row was made into the table')
})

test('7e: an existing workbook with the table is used as is', async (t) => {
  const { state } = fakeExcel(t)
  const prepared = await prepareWorkbook('d')
  assert.equal(prepared.created, false)
  assert.equal(state.uploaded, null)
  assert.equal(state.tableAdded, false)
})

test('7e: a workbook with other content and no table is refused, never changed', async (t) => {
  const { state } = fakeExcel(t, { header: null, sheetTop: [['Budget', 'Q1'], ['10', '20']] })
  await assert.rejects(prepareWorkbook('d'), /has no "DailyStatusTracker" table/)
  assert.equal(state.tableAdded, false)
})

test('7e: a workbook missing a column is refused with its name', async (t) => {
  fakeExcel(t, { header: COLUMNS.filter((c) => c !== 'UpdatedBy') })
  await assert.rejects(prepareWorkbook('d'), /missing columns: UpdatedBy/)
})

test('7e: the new workbook is a valid zip holding the sheet and its header row', () => {
  const bytes = trackerWorkbook('Tracker', COLUMNS, COLUMNS.map(() => 12))
  const view = new DataView(bytes.buffer)
  assert.equal(view.getUint32(0, true), 0x04034B50, 'starts with a zip entry')
  const end = bytes.length - 22
  assert.equal(view.getUint32(end, true), 0x06054B50, 'ends with the zip directory')
  assert.equal(view.getUint16(end + 10, true), 6, 'six parts')
  const text = new TextDecoder().decode(bytes)
  assert.ok(text.includes('<sheet name="Tracker"'))
  for (const column of COLUMNS) assert.ok(text.includes(`<t>${column}</t>`), column)
})

test('a slow Graph is still retried for the Excel tracker (SPEC-002 5a)', async (t) => {
  const saved = { ...graphRetry }
  graphRetry.delaysMs = [1, 1]
  t.after(() => Object.assign(graphRetry, saved))
  let gets = 0
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth2/')) return new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }))
    gets++
    return gets === 1 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ value: [] }))
  }
  assert.deepEqual(await new ExcelTracker('d', 'wb1').readToday('team-1', '2026-11-25'), [])
  assert.equal(gets, 2)
})
