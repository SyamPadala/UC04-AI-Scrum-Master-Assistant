import {
  createCloudAdapter, AuthType, CardFactory, MessageFactory,
  type AuthConfiguration, type TurnContext
} from '@microsoft/agents-hosting'
import type { ConversationReference } from '@microsoft/agents-activity'
import { config } from '../config/env.js'
import { ScrumAssistant } from './handler.js'
import { createLlm } from '../llm/index.js'
import { JiraClient } from '../pm/jira.js'

export const authConfig: AuthConfiguration = {
  tenantId: config.m365.tenantId,
  clientId: config.bot.appId,
  clientSecret: config.bot.appPassword,
  authType: AuthType.ClientSecret
}

// Built here and handed to the handler rather than imported at the point of
// use, so a test can substitute either one (coding rule 9). The tracker is not
// among them: it comes from the team's own record, per team, at message time.
export const agent = new ScrumAssistant(
  createLlm(),
  new JiraClient({
    baseUrl: config.jira.baseUrl,
    email: config.jira.email,
    apiToken: config.jira.apiToken,
    projectKey: config.jira.projectKey,
    storyPointsField: config.jira.storyPointsField,
    boardId: config.jira.boardId
  })
)

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

/**
 * The same path as `sendProactive`, carrying an Adaptive Card.
 *
 * `fallbackText` is what appears in the Teams notification preview and in any
 * client that cannot render the card — without it the alert arrives as a blank
 * line, which is worse than no alert at all.
 */
export async function sendProactiveCard (
  reference: string, card: unknown, fallbackText: string
): Promise<void> {
  const parsed = JSON.parse(reference) as ConversationReference
  await adapter.continueConversation(config.bot.appId, parsed, async (context: TurnContext) => {
    const message = MessageFactory.attachment(CardFactory.adaptiveCard(card))
    message.summary = fallbackText
    await context.sendActivity(message)
  })
}
