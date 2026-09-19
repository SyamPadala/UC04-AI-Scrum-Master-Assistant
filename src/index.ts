import { startServer } from '@microsoft/agents-hosting-express'
import { AuthType, type AuthConfiguration } from '@microsoft/agents-hosting'
import { config } from './config/env.js'
import { SharePointTracker } from './trackers/sharepoint.js'
import { ScrumAssistant } from './bot/handler.js'
import { getGraphToken } from './graph/client.js'

const tracker = new SharePointTracker(config.sharepoint.siteId, config.sharepoint.listId)
const agent = new ScrumAssistant(tracker)

const authConfig: AuthConfiguration = {
  tenantId: config.m365.tenantId,
  clientId: config.bot.appId,
  clientSecret: config.bot.appPassword,
  authType: AuthType.ClientSecret
}

startServer(agent, {
  authConfig,
  port: config.port,
  beforeListen: (app) => {
    // SPEC-001: /health reports liveness and dependency reachability, no auth.
    app.get('/health', (_request, response) => {
      void (async () => {
        let graph: 'ok' | 'unreachable' = 'ok'
        try {
          await getGraphToken()
        } catch {
          graph = 'unreachable'
        }
        response.json({ status: 'ok', graph, version: '0.1.0' })
      })()
    })
  }
})

console.log(`Scrum Assistant listening on port ${config.port}`)
