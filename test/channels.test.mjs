import test from 'node:test'
import assert from 'node:assert/strict'
import { channelReference, parseChannelList, teamOfActivity } from '../dist/bot/channels.js'
import { graphRequest } from '../dist/graph/client.js'

/** Choosing the stakeholder channel on the admin page (SPEC-008 behaviour 6). */

const reference = {
  activityId: '1727241000000',
  bot: { id: '28:bot', name: 'Scrum Assistant' },
  conversation: { id: '19:general@thread.tacv2;messageid=1727241000000', conversationType: 'channel', tenantId: 't' },
  channelId: 'msteams',
  serviceUrl: 'https://smba.trafficmanager.net/in/'
}

test('a channel reference points at the chosen channel as a new post, not a reply', () => {
  const result = JSON.parse(channelReference(reference, '19:stakeholders@thread.tacv2'))
  assert.equal(result.conversation.id, '19:stakeholders@thread.tacv2')
  assert.equal(result.conversation.conversationType, 'channel')
  assert.equal(result.activityId, undefined)
  assert.equal(result.serviceUrl, reference.serviceUrl)
  assert.equal(result.conversation.tenantId, 't')
})

test('the Teams team is read from channelData, and absent outside a team', () => {
  assert.deepEqual(teamOfActivity({ team: { id: '19:t@thread.tacv2', name: 'Stakeholder' } }), { id: '19:t@thread.tacv2', name: 'Stakeholder' })
  assert.equal(teamOfActivity({ tenant: { id: 't' } }), undefined)
  assert.equal(teamOfActivity(undefined), undefined)
})

test('the default channel, which has no name in the API, is listed as General', () => {
  const channels = parseChannelList({ conversations: [{ id: '19:a' }, { id: '19:b', name: 'Stakeholder Channel' }] })
  assert.deepEqual(channels, [
    { channelId: '19:a', channelName: 'General' },
    { channelId: '19:b', channelName: 'Stakeholder Channel' }
  ])
})

test('an unexpected channel list is rejected, not guessed at', () => {
  assert.throws(() => parseChannelList({ value: [] }))
})

test('a Graph call answered 202 with no body succeeds (sendMail)', async (t) => {
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  globalThis.fetch = async (url) => String(url).includes('/oauth2/')
    ? new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }), { status: 200 })
    : new Response(null, { status: 202 })
  assert.equal(await graphRequest('POST', '/users/u/sendMail', {}), undefined)
})
