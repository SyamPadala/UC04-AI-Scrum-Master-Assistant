import 'dotenv/config'

const missing: string[] = []

/**
 * Reads a required environment variable.
 *
 * Every missing name is collected and reported together, because a container
 * that exits on the first missing variable makes the operator redeploy once
 * per variable to discover them all.
 */
function required (name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    missing.push(name)
    return ''
  }
  return value.trim()
}

/** Called once the whole config has been read, so the report is complete. */
function assertComplete (): void {
  if (missing.length === 0) return
  const lines = [
    `Cannot start: ${missing.length} required environment variable(s) are not set:`,
    ...missing.map((name) => `  - ${name}`),
    'Set them on the Cloud Run service (Variables & Secrets), or in .env when running locally.'
  ]
  console.error(lines.join('\n'))
  process.exit(1)
}

function optional (name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? fallback : value.trim()
}

function numeric (name: string, fallback: number): number {
  const parsed = Number(optional(name, String(fallback)))
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: Number(optional('PORT', '3978')),
  dryRun: optional('DRY_RUN', 'false') === 'true',
  defaultTimezone: optional('DEFAULT_TIMEZONE', 'Asia/Kolkata'),

  bot: {
    appId: required('BOT_APP_ID'),
    appPassword: required('BOT_APP_PASSWORD')
  },

  m365: {
    tenantId: required('M365_TENANT_ID')
  },

  graph: {
    clientId: required('GRAPH_CLIENT_ID'),
    clientSecret: required('GRAPH_CLIENT_SECRET')
  },

  gcp: {
    projectId: required('GCP_PROJECT_ID'),
    firestoreDatabase: optional('FIRESTORE_DATABASE', '(default)'),
    /** Empty on Cloud Run, where the runtime service account is used instead. */
    credentialsPath: optional('GOOGLE_APPLICATION_CREDENTIALS', '')
  },

  tick: {
    /** Shared secret that stops anyone POSTing /tick and firing jobs. */
    sharedSecret: required('TICK_SHARED_SECRET')
  },

  admin: {
    /** Users who may configure any team, beyond that team's Scrum Master. */
    userIds: optional('ADMIN_USER_IDS', '').split(',').map((id) => id.trim()).filter((id) => id !== ''),
    /**
     * Signs the admin page's session cookie (SPEC-008). Unset means the page
     * is switched off: without it a session could not be trusted.
     */
    sessionSecret: optional('ADMIN_SESSION_SECRET', ''),
    sessionHours: numeric('ADMIN_SESSION_HOURS', 8),
    /**
     * The service's public address. The sign-in redirect must match the one
     * registered in Entra exactly, and Cloud Run answers on more than one
     * hostname, so it is configured rather than read from the request.
     */
    publicBaseUrl: optional('PUBLIC_BASE_URL', '').replace(/\/+$/, '')
  },

  teams: {
    /**
     * The single team this deployment serves. FR-10 (multi-team) resolves the
     * team from the incoming activity instead; until then one team is
     * configured here so conversation references have somewhere to go.
     */
    teamId: required('TEAMS_TEAM_ID'),
    stakeholderChannelId: optional('STAKEHOLDER_CHANNEL_ID', '')
  },

  sharepoint: {
    siteId: required('SHAREPOINT_SITE_ID'),
    listId: required('SHAREPOINT_LIST_ID')
  },

  jira: {
    baseUrl: optional('JIRA_BASE_URL', '').replace(/\/+$/, ''),
    email: optional('JIRA_EMAIL', ''),
    apiToken: optional('JIRA_API_TOKEN', ''),
    projectKey: optional('JIRA_PROJECT_KEY', ''),
    /**
     * Story points are a per-site custom field, so the id differs between Jira
     * sites and between team- and company-managed projects. Never hardcoded
     * (SPEC-002). Unset means points are unknown, which is not the same as zero.
     */
    storyPointsField: optional('JIRA_STORY_POINTS_FIELD', ''),
    /** Resolved from the project key on first use when not set. */
    boardId: optional('JIRA_BOARD_ID', '')
  },

  llm: {
    provider: optional('LLM_PROVIDER', 'gemini') as 'gemini' | 'anthropic' | 'vertex',
    model: optional('LLM_MODEL', ''),
    geminiApiKey: optional('GEMINI_API_KEY', ''),
    anthropicApiKey: optional('ANTHROPIC_API_KEY', ''),

    /**
     * The master switch for spending money.
     *
     * Off by default and deliberately separate from DRY_RUN, which only
     * suppresses Teams messages. With this off, a cache miss fails loudly
     * rather than silently billing — so a bug deployed on a Friday cannot
     * spend the weekend calling the model.
     */
    live: optional('LLM_LIVE', 'false') === 'true',

    /** Replay recorded responses instead of calling the model. */
    cache: optional('LLM_CACHE', 'true') === 'true',
    cachePath: optional('LLM_CACHE_PATH', './.llm-cache'),

    /**
     * Hard ceiling on calls per day, counted in Firestore so it survives a
     * Cloud Run restart. Billing alerts lag 24-48 hours, which is far too slow
     * to catch a runaway loop; this is the control that acts in time.
     */
    maxCallsPerDay: numeric('LLM_MAX_CALLS_PER_DAY', 200)
  },

  agent1: {
    maxToolIterations: numeric('AGENT1_MAX_TOOL_ITERATIONS', 3),
    timeoutMs: numeric('AGENT1_TIMEOUT_MS', 20_000),
    maxRetries: numeric('AGENT1_MAX_RETRIES', 2),
    /** Longest member message sent to the model; the truncation is recorded. */
    maxInputChars: numeric('AGENT1_MAX_INPUT_CHARS', 4000)
  },

  agent2: {
    maxToolIterations: numeric('AGENT2_MAX_TOOL_ITERATIONS', 4),
    timeoutMs: numeric('AGENT2_TIMEOUT_MS', 45_000),
    maxRetries: numeric('AGENT2_MAX_RETRIES', 2),
    /** A5: days without progress before a sprint item counts as at risk. */
    staleProgressDays: numeric('STALE_PROGRESS_DAYS', 2)
  },

  summary: {
    /**
     * The mailbox the stakeholder summary is sent from (FR-08).
     *
     * Mail.Send is an application permission, so Graph needs to be told which
     * mailbox to send as — there is no signed-in user to infer it from. Unset
     * means email distribution is skipped and the reason is recorded, rather
     * than the job failing.
     */
    senderUserId: optional('SUMMARY_SENDER_USER_ID', '')
  },

  blocker: {
    /** Suppress a repeat alert for the same blocker on the same day (SPEC-005). */
    dedupe: optional('BLOCKER_ALERT_DEDUPE', 'true') === 'true'
  }
} as const

assertComplete()
