import { config } from '../config/env.js'
import type { Store } from './types.js'
import { firestoreStore } from './firestore.js'
import { memoryStore } from './memory.js'

/**
 * The database the assistant uses, chosen by DB_PROVIDER (M17): 'firestore'
 * (default) or 'memory' (tests and local runs). Callers import these names and
 * never know which adapter is underneath.
 */

export type { ClaimOutcome, Store } from './types.js'

let chosen: Store | undefined

export function store (): Store {
  if (chosen === undefined) {
    chosen = config.db.provider === 'memory' ? memoryStore() : firestoreStore
  }
  return chosen
}

/** Tests swap the adapter in; nothing else should. */
export function useStore (adapter: Store): void {
  chosen = adapter
}

export const storeReachable: Store['reachable'] = async (...args) => await store().reachable(...args)
export const activeTeams: Store['activeTeams'] = async (...args) => await store().activeTeams(...args)
export const teamForMember: Store['teamForMember'] = async (...args) => await store().teamForMember(...args)
export const teamForChannel: Store['teamForChannel'] = async (...args) => await store().teamForChannel(...args)
export const getTeam: Store['getTeam'] = async (...args) => await store().getTeam(...args)
export const saveTeam: Store['saveTeam'] = async (...args) => await store().saveTeam(...args)
export const saveConversationRef: Store['saveConversationRef'] = async (...args) => await store().saveConversationRef(...args)
export const scrumMasterOf: Store['scrumMasterOf'] = async (...args) => await store().scrumMasterOf(...args)
export const saveScrumMasterRef: Store['saveScrumMasterRef'] = async (...args) => await store().saveScrumMasterRef(...args)
export const forgetScrumMasterChat: Store['forgetScrumMasterChat'] = async (...args) => await store().forgetScrumMasterChat(...args)
export const teamsRunBy: Store['teamsRunBy'] = async (...args) => await store().teamsRunBy(...args)
export const clearConversationRef: Store['clearConversationRef'] = async (...args) => await store().clearConversationRef(...args)
export const claimRun: Store['claimRun'] = async (...args) => await store().claimRun(...args)
export const completeRun: Store['completeRun'] = async (...args) => await store().completeRun(...args)
export const logManualRun: Store['logManualRun'] = async (...args) => await store().logManualRun(...args)
export const releaseRun: Store['releaseRun'] = async (...args) => await store().releaseRun(...args)
export const saveParticipation: Store['saveParticipation'] = async (...args) => await store().saveParticipation(...args)
export const recentParticipation: Store['recentParticipation'] = async (...args) => await store().recentParticipation(...args)
export const alreadyFlagged: Store['alreadyFlagged'] = async (...args) => await store().alreadyFlagged(...args)
export const saveFlag: Store['saveFlag'] = async (...args) => await store().saveFlag(...args)
export const summaryHasRun: Store['summaryHasRun'] = async (...args) => await store().summaryHasRun(...args)
export const standupState: Store['standupState'] = async (...args) => await store().standupState(...args)
export const reopenStandup: Store['reopenStandup'] = async (...args) => await store().reopenStandup(...args)
export const runsForDate: Store['runsForDate'] = async (...args) => await store().runsForDate(...args)
export const recordConfigChange: Store['recordConfigChange'] = async (...args) => await store().recordConfigChange(...args)
export const allTeams: Store['allTeams'] = async (...args) => await store().allTeams(...args)
export const configChangesFor: Store['configChangesFor'] = async (...args) => await store().configChangesFor(...args)
export const reserveLlmCall: Store['reserveLlmCall'] = async (...args) => await store().reserveLlmCall(...args)
export const recordLlmUsage: Store['recordLlmUsage'] = async (...args) => await store().recordLlmUsage(...args)
export const llmUsageForDates: Store['llmUsageForDates'] = async (...args) => await store().llmUsageForDates(...args)
export const llmUsageFor: Store['llmUsageFor'] = async (...args) => await store().llmUsageFor(...args)
export const claimBlockerAlert: Store['claimBlockerAlert'] = async (...args) => await store().claimBlockerAlert(...args)
export const releaseBlockerAlert: Store['releaseBlockerAlert'] = async (...args) => await store().releaseBlockerAlert(...args)
export const claimDailyNotice: Store['claimDailyNotice'] = async (...args) => await store().claimDailyNotice(...args)
export const releaseDailyNotice: Store['releaseDailyNotice'] = async (...args) => await store().releaseDailyNotice(...args)
export const saveChannelRef: Store['saveChannelRef'] = async (...args) => await store().saveChannelRef(...args)
export const clearChannelRef: Store['clearChannelRef'] = async (...args) => await store().clearChannelRef(...args)
export const saveBotTeam: Store['saveBotTeam'] = async (...args) => await store().saveBotTeam(...args)
export const botTeams: Store['botTeams'] = async (...args) => await store().botTeams(...args)
export const getChannelRef: Store['getChannelRef'] = async (...args) => await store().getChannelRef(...args)
