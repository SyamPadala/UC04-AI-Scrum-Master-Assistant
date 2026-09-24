import test from 'node:test'
import assert from 'node:assert/strict'
import { JiraCommentTracker, groupByIssue, renderComment, PROPERTY_KEY } from '../dist/trackers/jira.js'

/** The Jira comment tracker (SPEC-002, FR-04 destination 3). */

const row = (win, status, comment, blocker = null) => ({
  win, description: win === null ? null : `Title of ${win}`, assignedTo: 'Tiwari Satyam', comment, status, anyBlocker: blocker
})

test('rows are grouped by work item; rows with none go to the stand-up issue', () => {
  const groups = groupByIssue([
    row('SCRUM-20', 'Blocked', null, 'webhooks blocked'),
    row(null, 'In Progress', 'reviewing pull requests'),
    row('SCRUM-6', 'Completed', 'done')
  ], 'SCRUM-30')
  assert.deepEqual([...groups.keys()], ['SCRUM-20', 'SCRUM-30', 'SCRUM-6'])
})

test('the comment names the member, the date, the status and the blocker', () => {
  const doc = JSON.stringify(renderComment('Tiwari Satyam', '2026-09-24', [row('SCRUM-20', 'Blocked', null, 'webhooks blocked')]))
  for (const expected of ['Stand-up 2026-09-24 — Tiwari Satyam', 'Blocked', 'webhooks blocked', 'Recorded by Scrum Assistant']) {
    assert.ok(doc.includes(expected), expected)
  }
})

/** A minimal in-memory Jira: search, list comments with properties, add, delete. */
function fakeJira () {
  const comments = new Map() // issueKey -> [{ id, body, properties }]
  let nextId = 1
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status })
  const fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url)
    const method = init.method ?? 'GET'
    if (pathname === '/rest/api/3/search/jql') {
      return json(200, { issues: [...comments.keys()].map((key) => ({ key })) })
    }
    const match = pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment(?:\/(\d+))?$/)
    if (match === null) return json(404, { error: 'unexpected ' + pathname })
    const key = decodeURIComponent(match[1])
    const list = comments.get(key) ?? []
    if (method === 'GET') {
      assert.equal(searchParams.get('expand'), 'properties')
      return json(200, { comments: list, total: list.length })
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const comment = { id: String(nextId++), body: body.body, properties: body.properties }
      comments.set(key, [...list, comment])
      return json(201, comment)
    }
    if (method === 'DELETE') {
      comments.set(key, list.filter((c) => c.id !== match[2]))
      return json(204)
    }
    return json(405, {})
  }
  return { comments, fetch }
}

const options = { baseUrl: 'https://jira.test', email: 'a@b.c', apiToken: 't', projectKey: 'SCRUM', standupIssueKey: 'SCRUM-30' }

const update = (rows, memberId = 'm-1', memberName = 'Tiwari Satyam') => ({
  teamId: 'team-1', memberId, memberName, localDate: '2026-09-24', rows, rawText: 'not stored', capturedAt: new Date()
})

test('an update is written as comments and read back as the same rows', async (t) => {
  const jira = fakeJira()
  t.mock.method(globalThis, 'fetch', jira.fetch)
  const tracker = new JiraCommentTracker(options)

  await tracker.write(update([row('SCRUM-20', 'Blocked', null, 'webhooks blocked'), row(null, 'In Progress', 'reviewing PRs')]))

  assert.equal(jira.comments.get('SCRUM-20').length, 1)
  assert.equal(jira.comments.get('SCRUM-30').length, 1, 'the row with no work item went to the stand-up issue')
  assert.equal(jira.comments.get('SCRUM-20')[0].properties[0].key, PROPERTY_KEY)

  const [read] = await tracker.readToday('team-1', '2026-09-24')
  assert.equal(read.memberName, 'Tiwari Satyam')
  assert.equal(read.rows.length, 2)
  assert.equal(read.rows.find((r) => r.win === 'SCRUM-20').anyBlocker, 'webhooks blocked')
  assert.ok(!JSON.stringify(jira.comments.get('SCRUM-20')).includes('not stored'), 'the raw message is never sent to Jira')
})

test('a second write replaces that member\'s comments instead of adding more', async (t) => {
  const jira = fakeJira()
  t.mock.method(globalThis, 'fetch', jira.fetch)
  const tracker = new JiraCommentTracker(options)

  await tracker.write(update([row('SCRUM-20', 'In Progress', 'started')]))
  await tracker.write(update([row('SCRUM-20', 'Completed', 'finished')]))

  assert.equal(jira.comments.get('SCRUM-20').length, 1)
  const [read] = await tracker.readToday('team-1', '2026-09-24')
  assert.equal(read.rows[0].status, 'Completed')
})

test('another member\'s comments and another team\'s are left alone', async (t) => {
  const jira = fakeJira()
  t.mock.method(globalThis, 'fetch', jira.fetch)
  const tracker = new JiraCommentTracker(options)

  await tracker.write(update([row('SCRUM-20', 'In Progress', 'mine')], 'm-1', 'Tiwari Satyam'))
  await tracker.write(update([row('SCRUM-20', 'In Progress', 'theirs')], 'm-2', 'Madhavi Andoju'))
  await tracker.write(update([row('SCRUM-20', 'Completed', 'mine again')], 'm-1', 'Tiwari Satyam'))

  assert.equal(jira.comments.get('SCRUM-20').length, 2)
  const updates = await tracker.readToday('team-1', '2026-09-24')
  assert.deepEqual(updates.map((u) => u.memberName).sort(), ['Madhavi Andoju', 'Tiwari Satyam'])
  assert.deepEqual(await tracker.readToday('team-2', '2026-09-24'), [])
})

test('comments from another day are not read as today\'s', async (t) => {
  const jira = fakeJira()
  t.mock.method(globalThis, 'fetch', jira.fetch)
  const tracker = new JiraCommentTracker(options)
  await tracker.write({ ...update([row('SCRUM-20', 'In Progress', 'yesterday')]), localDate: '2026-09-23' })
  assert.deepEqual(await tracker.readToday('team-1', '2026-09-24'), [])
})
