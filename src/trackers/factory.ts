import type { TeamConfig } from '../types.js'
import type { Tracker } from './types.js'
import { SharePointTracker } from './sharepoint.js'
import { MockTracker } from './mock.js'
import { JiraCommentTracker } from './jira.js'
import { config } from '../config/env.js'

/**
 * The team's tracker, built from that team's own configuration.
 *
 * One source for this setting (coding rule 8). It used to be read from `.env`
 * on the message path and from the team record on the scheduled path, which
 * meant a second team's members had their updates written into the first
 * team's list — recorded as item 7 in KNOWN-DEBT.md. The team record wins.
 */
export function trackerFor (team: TeamConfig): Tracker {
  switch (team.tracker.kind) {
    case 'sharepoint':
      return new SharePointTracker(team.tracker.siteId, team.tracker.listId)
    case 'mock':
      return new MockTracker(team.tracker.path)
    case 'jira':
      // The Jira site and its credentials are one per deployment; which
      // project and which stand-up issue are the team's own.
      return new JiraCommentTracker({
        baseUrl: config.jira.baseUrl,
        email: config.jira.email,
        apiToken: config.jira.apiToken,
        projectKey: team.tracker.projectKey,
        standupIssueKey: team.tracker.standupIssueKey
      })
  }
}
