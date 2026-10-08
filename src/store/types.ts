import type { BotTeam, ConfigChange, JobType, NonResponderFlag, ParticipationRecord, RunOutcome, ScrumMaster, TeamConfig } from '../types.js'

/**
 * The database contract (M17, design review 8 Oct 2026).
 *
 * Everything the assistant needs from its database, and nothing about how a
 * given database does it. Firestore is one adapter; DynamoDB or Cosmos DB
 * would be others, chosen with DB_PROVIDER; an in-memory one serves tests.
 *
 * Two rules every adapter must keep:
 * - **Create only if missing** for every claim (runs, blocker alerts, daily
 *   notices): it is what stops a reminder or an alert going out twice.
 * - **No update content** is ever stored (Privacy NFR): ids, counts, hashes.
 */

export type ClaimOutcome = 'claimed' | 'already' | 'error'

export interface Store {
  /** The database answers at all (the health check). */
  reachable: () => Promise<boolean>
  activeTeams: () => Promise<TeamConfig[]>
  teamForMember: (memberId: string) => Promise<TeamConfig | undefined>
  teamForChannel: (channelId: string) => Promise<TeamConfig | undefined>
  getTeam: (teamId: string) => Promise<TeamConfig | undefined>
  saveTeam: (team: TeamConfig) => Promise<void>
  saveConversationRef: (teamId: string, memberId: string, displayName: string | undefined, reference: string) => Promise<void>
  scrumMasterOf: (team: TeamConfig) => Promise<ScrumMaster | undefined>
  saveScrumMasterRef: (memberId: string, displayName: string | undefined, reference: string) => Promise<void>
  forgetScrumMasterChat: (team: TeamConfig) => Promise<void>
  teamsRunBy: (memberId: string) => Promise<TeamConfig[]>
  clearConversationRef: (teamId: string, memberId: string) => Promise<void>
  claimRun: (teamId: string, localDate: string, jobType: JobType) => Promise<boolean>
  completeRun: (teamId: string, localDate: string, jobType: JobType, outcome: RunOutcome, startedAt: Date, detail?: string) => Promise<void>
  logManualRun: (teamId: string, localDate: string, jobType: JobType, outcome: RunOutcome, startedAt: Date, detail?: string) => Promise<void>
  releaseRun: (teamId: string, localDate: string, jobType: JobType) => Promise<void>
  saveParticipation: (record: ParticipationRecord) => Promise<void>
  recentParticipation: (teamId: string, days: number, timeZone: string, endingOn?: Date) => Promise<ParticipationRecord[]>
  alreadyFlagged: (teamId: string, memberId: string, missedDates: string[]) => Promise<boolean>
  saveFlag: (flag: NonResponderFlag) => Promise<void>
  summaryHasRun: (teamId: string, localDate: string) => Promise<boolean>
  standupState: (teamId: string, localDate: string) => Promise<{
    closed: boolean;
    closedAt: Date | null;
    reopenedAt: Date | null;
    reopenedBy: string | null;
}>
  reopenStandup: (teamId: string, localDate: string, by: string) => Promise<boolean>
  runsForDate: (teamId: string, localDate: string) => Promise<Array<{
    jobType: string;
    outcome: string;
    detail?: string;
}>>
  recordConfigChange: (change: ConfigChange) => Promise<void>
  allTeams: () => Promise<TeamConfig[]>
  configChangesFor: (teamId: string, limit?: number) => Promise<ConfigChange[]>
  reserveLlmCall: (localDate: string, maxPerDay: number) => Promise<boolean>
  recordLlmUsage: (localDate: string, label: string, usage: { inputTokens: number, outputTokens: number }) => Promise<void>
  llmUsageForDates: (dates: string[]) => Promise<Array<{
    localDate: string, calls: number, inputTokens: number, outputTokens: number, byLabel: Record<string, number>
  }>>
  llmUsageFor: (localDate: string) => Promise<{ calls: number, inputTokens: number, outputTokens: number }>
  claimBlockerAlert: (teamId: string, memberId: string, localDate: string, blockerHash: string) => Promise<ClaimOutcome>
  releaseBlockerAlert: (teamId: string, memberId: string, localDate: string, blockerHash: string) => Promise<void>
  claimDailyNotice: (teamId: string, localDate: string, kind: string) => Promise<ClaimOutcome>
  releaseDailyNotice: (teamId: string, localDate: string, kind: string) => Promise<void>
  saveChannelRef: (teamId: string, reference: string) => Promise<void>
  clearChannelRef: (teamId: string) => Promise<void>
  saveBotTeam: (team: BotTeam) => Promise<void>
  botTeams: () => Promise<BotTeam[]>
  getChannelRef: (teamId: string) => Promise<string | undefined>
}
