import type { PmClient } from '../../pm/types.js'
import type { LlmTool, ToolExecutor } from '../../llm/types.js'

/**
 * Read-only tools over the work tracker (SPEC-004).
 *
 * Every tool here answers a question. None of them changes anything, anywhere.
 * A tool that writes or sends is a build error (coding rule 15) — when a model's
 * conclusion needs to cause an action, code performs that action after the call
 * has returned and been validated.
 */

export const storyTools: LlmTool[] = [
  {
    name: 'lookup_story',
    description:
      'Check whether a work item key exists and read its title and status. ' +
      'Use this before attributing a comment to a key the person mentioned.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Work item key, e.g. SCRUM-12' }
      },
      required: ['key']
    }
  }
]

/**
 * Builds the executor for one member's call.
 *
 * Returns compact objects rather than whole Jira issues: a raw issue runs to
 * thousands of tokens, and every one of them is resent on the next round-trip.
 */
export function createStoryToolExecutor (pm: PmClient, jiraAccountId: string): ToolExecutor {
  return async (name, args) => {
    switch (name) {
      case 'lookup_story': {
        const key = typeof args.key === 'string' ? args.key.trim().toUpperCase() : ''
        if (key === '') return { found: false, reason: 'no key given' }
        const story = await pm.lookupStory(key)
        return story === undefined
          ? { found: false, key }
          : { found: true, key: story.key, title: story.title, status: story.status, assignee: story.assignee }
      }
      default:
        return { error: `unknown tool: ${name}` }
    }
  }
}
