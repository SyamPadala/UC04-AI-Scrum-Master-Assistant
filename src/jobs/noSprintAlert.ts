import type { TeamConfig } from '../types.js'
import { isConversationGone, sendProactive } from '../bot/adapter.js'
import { claimDailyNotice, forgetScrumMasterChat, releaseDailyNotice, scrumMasterOf } from '../store/firestore.js'
import { config } from '../config/env.js'

/**
 * SPEC-004 items 12 and 39(a): the Scrum Master hears once a day that there is
 * no active sprint, because until one is started every update is filed as a
 * general update rather than on a work item.
 *
 * Sent by code, like every other message; claimed before sending so a burst of
 * member messages produces one alert, not one each.
 */
export async function alertNoSprint (team: TeamConfig, localDate: string): Promise<{ sent: boolean, already?: boolean, reason?: string }> {
  const scrumMaster = await scrumMasterOf(team)
  if (scrumMaster === undefined) return { sent: false, reason: 'no Scrum Master is configured for this team' }
  if ((scrumMaster.conversationRef ?? '') === '') {
    return { sent: false, reason: `the app is not installed for ${scrumMaster.displayName}` }
  }
  const claim = await claimDailyNotice(team.teamId, localDate, 'noSprint')
  if (claim === 'already') return { sent: false, already: true, reason: 'already alerted today' }
  // M1: a notice that did not go out is released, so a later update tries again.
  const release = async (): Promise<void> => {
    if (claim === 'claimed') await releaseDailyNotice(team.teamId, localDate, 'noSprint').catch(() => {})
  }

  // SPEC-004 item 39(a): updates are still recorded, as general updates.
  const text = `No active sprint in Jira project ${config.jira.projectKey}. ` +
    'Stand-up updates are being saved as general updates. ' +
    'Start the sprint in Jira if one should be running.'

  if (config.dryRun) {
    console.log(JSON.stringify({ event: 'noSprintAlert.dryRun', teamId: team.teamId, localDate }))
    return { sent: true }
  }
  try {
    await sendProactive(scrumMaster.conversationRef as string, text)
  } catch (error) {
    await release()
    if (!isConversationGone(error)) throw error
    await forgetScrumMasterChat(team).catch(() => {})
    return { sent: false, reason: `the app is not installed for ${scrumMaster.displayName}` }
  }
  console.log(JSON.stringify({ event: 'noSprintAlert.sent', teamId: team.teamId, localDate }))
  return { sent: true }
}
