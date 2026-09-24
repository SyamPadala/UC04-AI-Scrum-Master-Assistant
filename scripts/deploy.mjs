/**
 * Manual deploy: package src, build the image in Cloud Build, point the
 * Cloud Run service at it. Run by hand — nothing triggers this.
 *
 *   node scripts/deploy.mjs
 *
 * Authenticates with GOOGLE_APPLICATION_CREDENTIALS from .env. The service
 * account needs Cloud Build Editor, Storage Object Admin, Artifact Registry
 * Reader + Writer, Cloud Run Admin and Service Account User.
 *
 * Environment variables already set on the Cloud Run service are preserved;
 * this never reads or writes secrets.
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { GoogleAuth } from 'google-auth-library'

const root = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] })
)

const PROJECT = env.GCP_PROJECT_ID
const REGION = env.CLOUD_RUN_REGION ?? 'asia-south1'
const SERVICE = env.CLOUD_RUN_SERVICE ?? 'scrum-assistant'
const BUCKET = `run-sources-${PROJECT}-${REGION}`
const REPO = `${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE}`
const TAG = `${REPO}:v${Date.now()}`

const auth = new GoogleAuth({ keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const client = await auth.getClient()
const token = async () => (await client.getAccessToken()).token
const headers = async (extra = {}) => ({ authorization: `Bearer ${await token()}`, ...extra })

// 1. package the source.
// The archive is written into the repo, not the system temp directory: tar on
// Windows is the Git Bash build and cannot resolve a 'C:\...' destination.
const tarball = '.deploy-source.tar.gz'
const tarballPath = path.join(root, tarball)
execFileSync('tar', ['--exclude=node_modules', '--exclude=.git', '--exclude=dist', '-czf', tarball,
  'src', 'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.json'], { cwd: root })
console.log(`packaged ${(fs.statSync(tarballPath).size / 1024).toFixed(0)} KB`)

// 2. upload it
const object = `source/${SERVICE}-${Date.now()}.tar.gz`
const upload = await fetch(
  `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(object)}`,
  { method: 'POST', headers: await headers({ 'content-type': 'application/gzip' }), body: fs.readFileSync(tarballPath) }
)
if (!upload.ok) throw new Error(`source upload failed: ${upload.status} ${(await upload.text()).slice(0, 300)}`)
fs.unlinkSync(tarballPath)

// 3. build
const submit = await fetch(`https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/builds`, {
  method: 'POST',
  headers: await headers({ 'content-type': 'application/json' }),
  body: JSON.stringify({
    source: { storageSource: { bucket: BUCKET, object } },
    steps: [{ name: 'gcr.io/cloud-builders/docker', args: ['build', '-t', TAG, '.'] }],
    images: [TAG],
    options: { logging: 'CLOUD_LOGGING_ONLY' }
  })
})
const operation = await submit.json()
if (!submit.ok) throw new Error(`build submit failed: ${JSON.stringify(operation.error)}`)
const buildId = operation.metadata.build.id
process.stdout.write('building')

let built = false
for (let i = 0; i < 60 && !built; i++) {
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  const build = await (await fetch(`https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/builds/${buildId}`, { headers: await headers() })).json()
  if (build.status === 'SUCCESS') built = true
  else if (['FAILURE', 'TIMEOUT', 'CANCELLED', 'INTERNAL_ERROR'].includes(build.status)) {
    throw new Error(`build ${build.status}: ${build.statusDetail ?? ''}\n${build.logUrl ?? ''}`)
  } else process.stdout.write('.')
}
if (!built) throw new Error('build did not finish within 10 minutes')
console.log(' done')

// 4. release.
// Runtime configuration is taken from .env, except GOOGLE_APPLICATION_CREDENTIALS:
// on Cloud Run the service runs as its own service account and must not be
// handed a key file path that does not exist in the container.
const RUNTIME_KEYS = [
  'BOT_APP_ID', 'BOT_APP_PASSWORD', 'M365_TENANT_ID',
  'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET',
  'SHAREPOINT_SITE_ID', 'SHAREPOINT_LIST_ID',
  'GCP_PROJECT_ID', 'FIRESTORE_DATABASE',
  'TEAMS_TEAM_ID', 'STAKEHOLDER_CHANNEL_ID',
  'TICK_SHARED_SECRET', 'DEFAULT_TIMEZONE', 'DEFAULT_GRACE_MINUTES'
]

// Carried through when set in .env, skipped when not. The LLM and Jira
// settings live here rather than above because the service starts without
// them — it simply cannot do the parts that need them.
const OPTIONAL_KEYS = [
  'LLM_PROVIDER', 'LLM_MODEL', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  'LLM_MAX_CALLS_PER_DAY',
  'AGENT1_MAX_TOOL_ITERATIONS', 'AGENT1_TIMEOUT_MS', 'AGENT1_MAX_RETRIES',
  'AGENT2_MAX_TOOL_ITERATIONS', 'AGENT2_TIMEOUT_MS', 'AGENT2_MAX_RETRIES',
  'STALE_PROGRESS_DAYS', 'BLOCKER_ALERT_DEDUPE', 'SUMMARY_SENDER_USER_ID',
  'JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY',
  'JIRA_STORY_POINTS_FIELD', 'JIRA_BOARD_ID',
  'ADMIN_USER_IDS', 'ADMIN_SESSION_SECRET', 'ADMIN_SESSION_HOURS', 'PUBLIC_BASE_URL'
]

/**
 * Settings the deployed service must not inherit from a developer's .env.
 *
 * LLM_LIVE decides whether this service is allowed to spend money, and
 * LLM_CACHE decides whether model output is written to disk — which the
 * Privacy NFR does not permit outside the tracker. Both are stated here so a
 * laptop's local settings can never become the running service's settings by
 * accident. Turn spending on deliberately, in the Cloud Run console.
 */
const RUNTIME_OVERRIDES = {
  LLM_LIVE: env.CLOUD_RUN_LLM_LIVE ?? 'false',
  LLM_CACHE: 'false'
}

const missingKeys = RUNTIME_KEYS.filter((k) => (env[k] ?? '') === '')
if (missingKeys.length > 0) throw new Error(`not set in .env: ${missingKeys.join(', ')}`)

const runtimeEnv = [
  ...RUNTIME_KEYS.map((name) => ({ name, value: env[name] })),
  ...OPTIONAL_KEYS.filter((name) => (env[name] ?? '') !== '').map((name) => ({ name, value: env[name] })),
  ...Object.entries(RUNTIME_OVERRIDES).map(([name, value]) => ({ name, value }))
]
console.log(`runtime settings: ${runtimeEnv.length} (LLM_LIVE=${RUNTIME_OVERRIDES.LLM_LIVE})`)

const base = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`
const release = await fetch(base, {
  method: 'PATCH',
  headers: await headers({ 'content-type': 'application/json' }),
  body: JSON.stringify({
    template: {
      containers: [{ image: TAG, env: runtimeEnv, resources: { limits: { cpu: '1', memory: '512Mi' } } }],
      scaling: { minInstanceCount: 0, maxInstanceCount: 2 },
      timeout: '300s'
    }
  })
})
if (!release.ok) throw new Error(`release failed: ${JSON.stringify((await release.json()).error)}`)
process.stdout.write('releasing')

for (let i = 0; i < 40; i++) {
  await new Promise((resolve) => setTimeout(resolve, 6000))
  const service = await (await fetch(base, { headers: await headers() })).json()
  const conditions = service.conditions ?? []
  const failed = conditions.find((c) => c.state === 'CONDITION_FAILED')
  if (failed !== undefined) throw new Error(`release failed: ${failed.message}`)
  if (conditions.length > 0 && conditions.every((c) => c.state === 'CONDITION_SUCCEEDED')) {
    console.log(`\nlive: ${service.uri}`)
    const health = await (await fetch(`${service.uri}/health`)).json()
    console.log('health:', JSON.stringify(health))
    process.exit(0)
  }
  process.stdout.write('.')
}
throw new Error('release did not become ready')
