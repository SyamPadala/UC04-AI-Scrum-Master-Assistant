import { createCloudAdapter, AuthType, type AuthConfiguration, type TurnContext } from '@microsoft/agents-hosting'
import type { ConversationReference } from '@microsoft/agents-activity'
import { config } from '../config/env.js'
import { ScrumAssistant } from './handler.js'
import { SharePointTracker } from '../trackers/sharepoint.js'

export const authConfig: AuthConfiguration = {
  tenantId: config.m365.tenantId,
  clientId: config.bot.appId,
  clientSecret: config.bot.appPassword,
  authType: AuthType.ClientSecret
}

const tracker = new SharePointTracker(config.sharepoint.siteId, config.sharepoint.listId)
export const agent = new ScrumAssistant(tracker)

const { adapter, headerPropagation } = createCloudAdapter(agent, authConfig)
export { adapter, headerPropagation }

/**
 * Sends a message to someone the app is not currently talking to.
 *
 * Only possible with a stored conversation reference, which exists only once
 * the app has been installed for that person. Without one the member is
 * silently unreachable — callers must treat that as a reportable outcome, not
 * a no-op.
 */
export async function sendProactive (reference: string, text: string): Promise<void> {
  const parsed = JSON.parse(reference) as ConversationReference
  await adapter.continueConversation(config.bot.appId, parsed, async (context: TurnContext) => {
    await context.sendActivity(text)
  })
}
