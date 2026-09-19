import 'dotenv/config'

/** Reads a required environment variable, failing loudly at startup rather than at first use. */
function required (name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function optional (name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? fallback : value.trim()
}

export const config = {
  port: Number(optional('PORT', '3978')),
  dryRun: optional('DRY_RUN', 'false') === 'true',

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
