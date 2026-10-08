import type { TeamConfig } from '../types.js'
import type { PmClient } from './types.js'
import { JiraClient } from './jira.js'
import { config } from '../config/env.js'

/**
 * One place that builds Jira clients (design review, 8 Oct 2026: they were
 * built by hand in three places).
 *
 * The Jira **site** and the assistant's login are deployment settings; the
 * **project** and board are each team's own (SPEC-008 10p, M10).
 */

export function jiraConfigured (): boolean {
  return config.jira.baseUrl !== '' && config.jira.apiToken !== ''
}

/**
 * Site-wide work that belongs to no project: listing users, inviting and
 * removing people, granting access. Undefined when Jira is not configured.
 */
export function jiraSite (): JiraClient | undefined {
  if (!jiraConfigured()) return undefined
  return new JiraClient({
    baseUrl: config.jira.baseUrl,
    email: config.jira.email,
    apiToken: config.jira.apiToken,
    projectKey: '',
    storyPointsField: config.jira.storyPointsField
  })
}

/** The team's own Jira project, or the "no Jira" client when it has none. */
export function pmFor (team: Pick<TeamConfig, 'jira'>): PmClient {
  if (team.jira === undefined || !jiraConfigured()) return NO_JIRA
  return new JiraClient({
    baseUrl: config.jira.baseUrl,
    email: config.jira.email,
    apiToken: config.jira.apiToken,
    projectKey: team.jira.projectKey,
    storyPointsField: config.jira.storyPointsField,
    ...(team.jira.boardId === undefined ? {} : { boardId: team.jira.boardId })
  })
}

/**
 * A team without a Jira project (M10): no sprint, no stories. The intake then
 * files every update as a general update (SPEC-004 item 39), and the summary
 * carries no sprint figures.
 */
export const NO_JIRA: PmClient = {
  projectKey: '',
  getActiveSprint: async () => undefined,
  getSprintData: async () => undefined,
  lookupStory: async () => undefined,
  getMemberOpenItems: async () => [],
  getSprintOpenItems: async () => []
}
