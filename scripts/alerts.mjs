/**
 * Maturity plan M14: e-mail alerts to the admin when something fails. Run by
 * hand, once, after the deploy account has been given the roles
 * "Monitoring Editor" (roles/monitoring.editor) and "Logs Configuration
 * Writer" (roles/logging.configWriter) on the project. Safe to run again.
 *
 *   node scripts/alerts.mjs
 *
 * Creates (or reuses, by name) an e-mail channel to every admin in
 * ADMIN_USER_IDS and four alert policies:
 *   1. a scheduled job (reminder, follow-up, summary, participation) failed
 *   2. an update could not be processed (the AI failed every attempt, or the tracker)
 *   3. an update took longer than 30 seconds (Latency NFR)
 *   4. the service stopped answering its health check
 * Google's free allowance covers these at this volume.
 */
import fs from 'node:fs'
import path from 'node:path'
import { GoogleAuth } from 'google-auth-library'

const root = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] })
)
const PROJECT = env.GCP_PROJECT_ID
const SERVICE = env.CLOUD_RUN_SERVICE ?? 'scrum-assistant'
const HOST = new URL(env.PUBLIC_BASE_URL).host

const auth = new GoogleAuth({ keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const client = await auth.getClient()
const call = async (method, url, data) => {
  try { return (await client.request({ method, url, data })).data } catch (error) {
    throw new Error(`${method} ${url.split('/v3/')[1] ?? url} failed: ${error.response?.status} ${error.response?.data?.error?.message ?? error.message}`)
  }
}
const mon = `https://monitoring.googleapis.com/v3/projects/${PROJECT}`

// The admins' e-mail addresses, from Microsoft 365 (ADMIN_USER_IDS are object ids).
const token = (await (await fetch(`https://login.microsoftonline.com/${env.M365_TENANT_ID}/oauth2/v2.0/token`, {
  method: 'POST',
  body: new URLSearchParams({ client_id: env.GRAPH_CLIENT_ID, client_secret: env.GRAPH_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
})).json()).access_token
const emails = []
for (const id of (env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const user = await (await fetch(`https://graph.microsoft.com/v1.0/users/${id}?$select=mail,userPrincipalName`, { headers: { authorization: `Bearer ${token}` } })).json()
  const email = user.mail ?? user.userPrincipalName
  if (email) emails.push(email)
}
if (emails.length === 0) throw new Error('No admin e-mail address found from ADMIN_USER_IDS.')

const existingChannels = (await call('GET', `${mon}/notificationChannels`)).notificationChannels ?? []
const channels = []
for (const email of emails) {
  const found = existingChannels.find((c) => c.type === 'email' && c.labels?.email_address === email)
  channels.push(found?.name ?? (await call('POST', `${mon}/notificationChannels`, {
    type: 'email', displayName: `Scrum Assistant admin (${email})`, labels: { email_address: email }
  })).name)
}

const logFilter = (extra) => `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}" AND ${extra}`
const logPolicy = (name, filter, doc) => ({
  displayName: `Scrum Assistant: ${name}`,
  combiner: 'OR',
  conditions: [{ displayName: name, conditionMatchedLog: { filter: logFilter(filter) } }],
  alertStrategy: { notificationRateLimit: { period: '300s' }, autoClose: '1800s' },
  notificationChannels: channels,
  documentation: { content: doc, mimeType: 'text/markdown' }
})

// Uptime check on /health, then a policy on it.
const uptimeName = 'Scrum Assistant health'
const uptimes = (await call('GET', `${mon}/uptimeCheckConfigs`)).uptimeCheckConfigs ?? []
const uptime = uptimes.find((u) => u.displayName === uptimeName) ?? await call('POST', `${mon}/uptimeCheckConfigs`, {
  displayName: uptimeName,
  monitoredResource: { type: 'uptime_url', labels: { project_id: PROJECT, host: HOST } },
  httpCheck: { path: '/health', port: 443, useSsl: true, validateSsl: true },
  period: '300s', timeout: '10s'
})
const checkId = uptime.name.split('/').pop()

const policies = [
  logPolicy('a scheduled job failed', 'jsonPayload.event="job.finished" AND jsonPayload.outcome="failed"',
    'A reminder, follow-up, summary or participation job failed. Open the admin page, Activity tab, for the detail.'),
  logPolicy('an update could not be processed', '(jsonPayload.event="update.failed" OR jsonPayload.event="handoff.processFailed")',
    'A member\'s update was not recorded (AI failed every attempt, or the tracker). The member was told to send it again.'),
  logPolicy('an update took longer than 30 seconds', 'jsonPayload.event="update.processed" AND jsonPayload.withinLatencyBudget=false',
    'Latency NFR: receipt to tracker took more than 30 s.'),
  {
    displayName: 'Scrum Assistant: service not answering',
    combiner: 'OR',
    conditions: [{
      displayName: 'health check failing',
      conditionThreshold: {
        filter: `metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.label.check_id="${checkId}" AND resource.type="uptime_url"`,
        aggregations: [{ alignmentPeriod: '600s', perSeriesAligner: 'ALIGN_NEXT_OLDER', crossSeriesReducer: 'REDUCE_COUNT_FALSE', groupByFields: ['resource.label.host'] }],
        comparison: 'COMPARISON_GT', thresholdValue: 1, duration: '600s', trigger: { count: 1 }
      }
    }],
    notificationChannels: channels,
    documentation: { content: 'The service did not answer /health for 10 minutes.', mimeType: 'text/markdown' }
  }
]
const existing = (await call('GET', `${mon}/alertPolicies`)).alertPolicies ?? []
for (const policy of policies) {
  const found = existing.find((p) => p.displayName === policy.displayName)
  if (found) { console.log(`exists   ${policy.displayName}`); continue }
  try {
    await call('POST', `${mon}/alertPolicies`, policy)
    console.log(`created  ${policy.displayName}`)
  } catch (error) {
    // Log-based alerts also need the "Logs Configuration Writer" role.
    console.log(`FAILED   ${policy.displayName}: ${error.message.slice(0, 140)}`)
  }
}
console.log(`\nAlerts go to: ${emails.join(', ')}`)
