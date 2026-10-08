import type { TeamConfig } from '../types.js'
import { chatState } from '../bot/reachability.js'
import { scrumMasterOf } from '../store/index.js'

/**
 * SPEC-008 10o (M3): a team runs only when its Scrum Master can be messaged.
 *
 * Without that, blocker alerts, non-responder flags and failure notices go
 * nowhere while reminders keep going out. Applies to whoever is Scrum Master,
 * an admin included. Returns the reason it can't run, or undefined when it can.
 */
export async function cannotRun (team: TeamConfig): Promise<string | undefined> {
  // SPEC-008 10q (M11): a team runs only with its own tracker list chosen.
  if (team.tracker.kind === 'unset') return "Choose this team's tracker list first (Schedule tab, Tracker)."
  const scrumMaster = await scrumMasterOf(team)
  if (scrumMaster === undefined) return 'This team has no Scrum Master.'
  const notReachable = `${scrumMaster.displayName} (Scrum Master) can't be messaged yet. They need to open Scrum Assistant in Teams once.`
  if ((scrumMaster.conversationRef ?? '') === '') return notReachable
  try {
    return await chatState(scrumMaster.conversationRef) === 'ok' ? undefined : notReachable
  } catch (error) {
    return `Could not check whether ${scrumMaster.displayName} can be messaged: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`
  }
}
