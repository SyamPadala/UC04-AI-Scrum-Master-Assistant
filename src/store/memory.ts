import type {
  BotTeam, ConfigChange, JobType, NonResponderFlag, ParticipationRecord, RunLog, ScrumMaster, TeamConfig
} from '../types.js'
import type { ClaimOutcome, Store } from './types.js'

/**
 * The in-memory adapter of the database contract (M17): for tests and local
 * runs (DB_PROVIDER=memory). Same rules as Firestore — claims are create-only,
 * and no update content is held. Data lives as long as the process.
 */

const copy = <T>(value: T): T => structuredClone(value)
const runId = (teamId: string, localDate: string, jobType: JobType): string => `${teamId}_${localDate}_${jobType}`
const flagId = (teamId: string, memberId: string, missedDates: string[]): string => `${teamId}_${memberId}_${missedDates[0]}`

export function memoryStore (): Store {
  const teams = new Map<string, TeamConfig>()
  const channelRefs = new Map<string, string>()
  const scrumMasters = new Map<string, Partial<ScrumMaster>>()
  const runs = new Map<string, { teamId: string, jobType: JobType, localDate: string, outcome: string, startedAt: Date, reopenedAt?: Date, reopenedBy?: string }>()
  const runLogs: RunLog[] = []
  const participation = new Map<string, ParticipationRecord>()
  const flags = new Map<string, NonResponderFlag>()
  const changes: ConfigChange[] = []
  const usage = new Map<string, Record<string, number>>()
  const claims = new Set<string>()
  const botTeamList = new Map<string, BotTeam>()

  const all = (): TeamConfig[] => [...teams.values()].map(copy)
  const claim = (key: string): ClaimOutcome => {
    if (claims.has(key)) return 'already'
    claims.add(key)
    return 'claimed'
  }

  const store: Store = {
    reachable: async () => true,
    activeTeams: async () => all().filter((t) => t.active),
    teamForMember: async (memberId) => {
      const matches = all().filter((t) => t.members.some((m) => m.memberId === memberId))
      if (matches.length > 1) throw new Error(`${memberId} is on more than one team (${matches.map((t) => t.name).join(', ')}); rosters must not overlap`)
      return matches[0]
    },
    teamForChannel: async (channelId) => all().find((t) => (t.stakeholders.channelId ?? '') === channelId),
    getTeam: async (teamId) => { const t = teams.get(teamId); return t === undefined ? undefined : copy(t) },
    saveTeam: async (team) => { teams.set(team.teamId, copy(team)) },
    saveConversationRef: async (teamId, memberId, displayName, reference) => {
      const team = teams.get(teamId)
      if (team === undefined) return
      const existing = team.members.find((m) => m.memberId === memberId)
      if (existing === undefined) {
        team.members.push({ memberId, displayName: displayName ?? 'Unknown', conversationRef: reference })
      } else {
        existing.conversationRef = reference
        if (displayName !== undefined && displayName !== '') existing.displayName = displayName
      }
    },
    scrumMasterOf: async (team) => {
      if ((team.scrumMasterId ?? '') === '') return undefined
      const stored = scrumMasters.get(team.scrumMasterId)
      const legacy = team.members.find((m) => m.memberId === team.scrumMasterId)
      const reference = (stored?.conversationRef ?? '') !== '' ? stored?.conversationRef : legacy?.conversationRef
      const email = stored?.email ?? team.scrumMasterEmail ?? legacy?.email
      const scrumMaster: ScrumMaster = {
        memberId: team.scrumMasterId,
        displayName: stored?.displayName ?? team.scrumMasterName ?? legacy?.displayName ?? 'Scrum Master'
      }
      if (email !== undefined) scrumMaster.email = email
      if (reference !== undefined && reference !== '') scrumMaster.conversationRef = reference
      return scrumMaster
    },
    saveScrumMasterRef: async (memberId, displayName, reference) => {
      scrumMasters.set(memberId, { ...scrumMasters.get(memberId), memberId, ...(displayName === undefined || displayName === '' ? {} : { displayName }), conversationRef: reference })
    },
    forgetScrumMasterChat: async (team) => {
      scrumMasters.set(team.scrumMasterId, { ...scrumMasters.get(team.scrumMasterId), conversationRef: '' })
      await store.clearConversationRef(team.teamId, team.scrumMasterId)
    },
    teamsRunBy: async (memberId) => memberId === '' ? [] : all().filter((t) => t.scrumMasterId === memberId),
    clearConversationRef: async (teamId, memberId) => {
      const member = teams.get(teamId)?.members.find((m) => m.memberId === memberId)
      if (member !== undefined) delete member.conversationRef
    },
    claimRun: async (teamId, localDate, jobType) => {
      const id = runId(teamId, localDate, jobType)
      if (runs.has(id)) return false
      runs.set(id, { teamId, jobType, localDate, outcome: 'claimed', startedAt: new Date() })
      return true
    },
    completeRun: async (teamId, localDate, jobType, outcome, startedAt, detail) => {
      runLogs.push({ teamId, jobType, localDate, outcome, startedAt, durationMs: Date.now() - startedAt.getTime(), ...(detail === undefined ? {} : { detail }) })
      const claimed = runs.get(runId(teamId, localDate, jobType))
      if (claimed !== undefined) claimed.outcome = outcome
    },
    logManualRun: async (teamId, localDate, jobType, outcome, startedAt, detail) => {
      runLogs.push({ teamId, jobType, localDate, outcome, startedAt, durationMs: Date.now() - startedAt.getTime(), trigger: 'manual', ...(detail === undefined ? {} : { detail }) })
    },
    releaseRun: async (teamId, localDate, jobType) => { runs.delete(runId(teamId, localDate, jobType)) },
    saveParticipation: async (record) => { participation.set(`${record.teamId}_${record.localDate}`, copy(record)) },
    recentParticipation: async (teamId, days, timeZone, endingOn = new Date()) => {
      const found: ParticipationRecord[] = []
      for (let back = 0; back < days; back++) {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
          .format(new Date(endingOn.getTime() - back * 86_400_000))
        const record = participation.get(`${teamId}_${day}`)
        if (record !== undefined) found.push(copy(record))
      }
      return found
    },
    alreadyFlagged: async (teamId, memberId, missedDates) => flags.has(flagId(teamId, memberId, missedDates)),
    saveFlag: async (flag) => { flags.set(flagId(flag.teamId, flag.memberId, flag.missedDates), copy(flag)) },
    summaryHasRun: async (teamId, localDate) => (await store.standupState(teamId, localDate)).closed,
    standupState: async (teamId, localDate) => {
      const summary = runs.get(runId(teamId, localDate, 'summary'))
      if (summary === undefined) return { closed: false, closedAt: null, reopenedAt: null, reopenedBy: null }
      return { closed: summary.reopenedAt === undefined, closedAt: summary.startedAt, reopenedAt: summary.reopenedAt ?? null, reopenedBy: summary.reopenedBy ?? null }
    },
    reopenStandup: async (teamId, localDate, by) => {
      const summary = runs.get(runId(teamId, localDate, 'summary'))
      if (summary === undefined) return false
      summary.reopenedAt = new Date()
      summary.reopenedBy = by
      return true
    },
    runsForDate: async (teamId, localDate) => {
      const jobTypes: JobType[] = ['reminder', 'followup', 'summary', 'participation']
      return jobTypes.filter((jobType) => runs.has(runId(teamId, localDate, jobType))).map((jobType) => {
        const latest = runLogs
          .filter((log) => log.teamId === teamId && log.localDate === localDate && log.jobType === jobType && log.trigger !== 'manual')
          .sort((a, b) => Number(b.startedAt) - Number(a.startedAt))[0]
        return { jobType, outcome: latest?.outcome ?? 'running', ...(latest?.detail === undefined ? {} : { detail: latest.detail }) }
      })
    },
    recordConfigChange: async (change) => { changes.push(copy(change)) },
    allTeams: async () => all(),
    configChangesFor: async (teamId, limit = 25) => changes
      .filter((c) => c.teamId === teamId)
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
      .slice(0, limit)
      .map(copy),
    reserveLlmCall: async (localDate, maxPerDay) => {
      const day = usage.get(localDate) ?? {}
      if ((day.calls ?? 0) >= maxPerDay) return false
      usage.set(localDate, { ...day, calls: (day.calls ?? 0) + 1 })
      return true
    },
    recordLlmUsage: async (localDate, label, used) => {
      const day = usage.get(localDate) ?? {}
      usage.set(localDate, {
        ...day,
        inputTokens: (day.inputTokens ?? 0) + used.inputTokens,
        outputTokens: (day.outputTokens ?? 0) + used.outputTokens,
        [`calls_${label}`]: (day[`calls_${label}`] ?? 0) + 1
      })
    },
    llmUsageForDates: async (dates) => dates.map((localDate) => {
      const day = usage.get(localDate) ?? {}
      const byLabel: Record<string, number> = {}
      for (const [key, value] of Object.entries(day)) if (key.startsWith('calls_')) byLabel[key.slice(6)] = value
      return { localDate, calls: day.calls ?? 0, inputTokens: day.inputTokens ?? 0, outputTokens: day.outputTokens ?? 0, byLabel }
    }),
    llmUsageFor: async (localDate) => {
      const day = usage.get(localDate) ?? {}
      return { calls: day.calls ?? 0, inputTokens: day.inputTokens ?? 0, outputTokens: day.outputTokens ?? 0 }
    },
    claimBlockerAlert: async (teamId, memberId, localDate, blockerHash) => claim(`alert_${teamId}_${memberId}_${localDate}_${blockerHash}`),
    releaseBlockerAlert: async (teamId, memberId, localDate, blockerHash) => { claims.delete(`alert_${teamId}_${memberId}_${localDate}_${blockerHash}`) },
    claimDailyNotice: async (teamId, localDate, kind) => claim(`notice_${teamId}_${localDate}_${kind}`),
    releaseDailyNotice: async (teamId, localDate, kind) => { claims.delete(`notice_${teamId}_${localDate}_${kind}`) },
    saveChannelRef: async (teamId, reference) => { channelRefs.set(teamId, reference) },
    clearChannelRef: async (teamId) => { channelRefs.set(teamId, '') },
    saveBotTeam: async (team) => { botTeamList.set(team.teamThreadId, copy(team)) },
    botTeams: async () => [...botTeamList.values()].map(copy),
    getChannelRef: async (teamId) => {
      const value = channelRefs.get(teamId)
      return value === undefined || value === '' ? undefined : value
    }
  }
  return store
}
