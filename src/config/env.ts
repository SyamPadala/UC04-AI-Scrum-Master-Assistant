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

  sharepoint: {
    siteId: required('SHAREPOINT_SITE_ID'),
    listId: required('SHAREPOINT_LIST_ID')
  }
} as const

assertComplete()
