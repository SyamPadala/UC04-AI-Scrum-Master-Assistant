/**
 * What the admin page can do to a team (SPEC-008), split by job (design
 * review, 8 Oct 2026; the single module had grown past 1,000 lines):
 *
 * - common.ts       shared rules: errors, who may act, saving with history
 * - teams.ts        team view, create, schedule, Scrum Master, reopen, run now
 * - members.ts      roster, onboarding and offboarding steps, Jira link
 * - integrations.ts Teams team, Jira project, tracker list, stakeholder channel
 * - health.ts       readiness and the onboarding checklist
 *
 * Callers import from here; the split is internal.
 */
export * from './common.js'
export * from './teams.js'
export * from './members.js'
export * from './integrations.js'
export * from './health.js'
