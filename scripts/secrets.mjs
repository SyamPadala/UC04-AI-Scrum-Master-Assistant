/**
 * Maturity plan M5: moves the service's secrets into Secret Manager. Run by
 * hand, once, after the deploy account has been given the role
 * "Secret Manager Admin" (roles/secretmanager.admin) on the project.
 *
 *   node scripts/secrets.mjs
 *
 * For each secret below it creates the secret if missing, adds the value from
 * .env as a new version, and lets the service's own runtime account read it.
 * Prints names only, never values. Then set CLOUD_RUN_SECRETS=secret-manager
 * in .env and deploy: the service reads them from Secret Manager from then on.
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

export const SECRET_KEYS = [
  'BOT_APP_PASSWORD', 'GRAPH_CLIENT_SECRET', 'JIRA_API_TOKEN', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  'ADMIN_SESSION_SECRET', 'TICK_SHARED_SECRET'
]
export const secretId = (key) => `scrum-assistant-${key.toLowerCase().replaceAll('_', '-')}`

const PROJECT = env.GCP_PROJECT_ID
const REGION = env.CLOUD_RUN_REGION ?? 'asia-south1'
const SERVICE = env.CLOUD_RUN_SERVICE ?? 'scrum-assistant'

// Runs only when called directly; deploy.mjs imports the names above.
if ((process.argv[1] ?? '').endsWith('secrets.mjs')) {
  const auth = new GoogleAuth({ keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  const client = await auth.getClient()
  const call = async (method, url, data) => {
    try { return (await client.request({ method, url, data })).data } catch (error) {
      const status = error.response?.status
      if (status === 409) return { exists: true }
      throw new Error(`${method} ${url.split('/v1/')[1] ?? url} failed: ${status} ${error.response?.data?.error?.message ?? error.message}`)
    }
  }
  const sm = 'https://secretmanager.googleapis.com/v1'
  await call('POST', `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/secretmanager.googleapis.com:enable`)
  const service = await call('GET', `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`)
  const runtime = service.template.serviceAccount

  for (const key of SECRET_KEYS) {
    const value = env[key] ?? ''
    if (value === '') { console.log(`${key.padEnd(22)} not set in .env, skipped`); continue }
    const id = secretId(key)
    await call('POST', `${sm}/projects/${PROJECT}/secrets?secretId=${id}`, { replication: { automatic: {} } })
    await call('POST', `${sm}/projects/${PROJECT}/secrets/${id}:addVersion`, { payload: { data: Buffer.from(value).toString('base64') } })
    const policy = await call('GET', `${sm}/projects/${PROJECT}/secrets/${id}:getIamPolicy`)
    const bindings = policy.bindings ?? []
    const role = 'roles/secretmanager.secretAccessor'
    const member = `serviceAccount:${runtime}`
    const binding = bindings.find((b) => b.role === role)
    if (binding === undefined) bindings.push({ role, members: [member] })
    else if (!binding.members.includes(member)) binding.members.push(member)
    await call('POST', `${sm}/projects/${PROJECT}/secrets/${id}:setIamPolicy`, { policy: { ...policy, bindings } })
    console.log(`${key.padEnd(22)} -> ${id} (readable by ${runtime})`)
  }
  console.log('\nNext: add CLOUD_RUN_SECRETS=secret-manager to .env, then node scripts/deploy.mjs')
}
