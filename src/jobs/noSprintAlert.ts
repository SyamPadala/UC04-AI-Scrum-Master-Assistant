import type { TeamConfig } from '../types.js'
import { isConversationGone, sendProactive } from '../bot/adapter.js'
import { claimDailyNotice, forgetScrumMasterChat, scrumMasterOf } from '../store/firestore.js'
import { config } from '../config/env.js'

/**
 * SPEC-004 item 12: the Scrum Master hears once a day that there is no active
 * sprint, because until one is started no update can be matched to a work item.
 *
 * Sent by code, like every other message; claimed before sending so a burst of
 * member messages produces one alert, not one each.
 */
export async function alertNoSprint (team: TeamConfig, localDate: string): Promise<{ sent: boolean, reason?: string }> {
  const scrumMaster = await scrumMasterOf(team)
  if (scrumMaster === undefined) return { sent: false, reason: 'no Scrum Master is configured for this team' }
  if ((scrumMaster.conversationRef ?? '') === '') {
    return { sent: false, reason: `the app is not installed for ${scrumMaster.displayName}` }
  }
  if (!await claimDailyNotice(team.teamId, localDate, 'noSprint')) {
    return { sent: false, reason: 'already alerted today' }
  }

  const text = `No active sprint in Jira project ${config.jira.projectKey}. ` +
    "Stand-up updates can't be matched to work items, so they are not being recorded. " +
    'Start the sprint in Jira to fix this.'

  if (config.dryRun) {
    console.log(JSON.stringify({ event: 'noSprintAlert.dryRun', teamId: team.teamId, localDate }))
    return { sent: true }
  }
  try {
    await sendProactive(scrumMaster.conversationRef as string, text)
  } catch (error) {
    if (!isConversationGone(error)) throw error
    await forgetScrumMasterChat(team).catch(() => {})
    return { sent: false, reason: `the app is not installed for ${scrumMaster.displayName}` }
  }
  console.log(JSON.stringify({ event: 'noSprintAlert.sent', teamId: team.teamId, localDate }))
  return { sent: true }
}
