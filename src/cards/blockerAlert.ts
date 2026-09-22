/**
 * The blocker alert the Scrum Master receives (SPEC-005, FR-06).
 *
 * Text first, so it reads correctly on the Teams mobile client as well as the
 * desktop one (Accessibility NFR). Several blockers from one person arrive as
 * one card rather than several messages.
 */

export interface BlockerLine {
  description: string
  storyRef: string | null
  storyTitle?: string | null
  storyUrl?: string | null
}

export function blockerAlertCard (
  memberName: string, localDate: string, blockers: BlockerLine[]
): unknown {
  const body: unknown[] = [
    {
      type: 'TextBlock',
      text: blockers.length === 1 ? 'Blocker reported' : `${blockers.length} blockers reported`,
      weight: 'Bolder',
      size: 'Medium',
      wrap: true
    },
    {
      type: 'TextBlock',
      text: `${memberName} · ${localDate}`,
      isSubtle: true,
      spacing: 'None',
      wrap: true
    }
  ]

  for (const blocker of blockers) {
    // "not specified" rather than silence: an unattributed blocker is still a
    // blocker, and hiding the gap would read as though a story was known (A8).
    const story = blocker.storyRef === null
      ? 'not specified'
      : blocker.storyTitle == null
        ? blocker.storyRef
        : `${blocker.storyRef} — ${blocker.storyTitle}`

    body.push({
      type: 'Container',
      separator: true,
      spacing: 'Medium',
      items: [
        { type: 'TextBlock', text: blocker.description, wrap: true },
        {
          type: 'TextBlock',
          text: `Affected work item: ${story}`,
          isSubtle: true,
          size: 'Small',
          spacing: 'Small',
          wrap: true
        }
      ]
    })
  }

  const links = blockers
    .filter((blocker) => blocker.storyUrl != null && blocker.storyRef !== null)
    .map((blocker) => ({
      type: 'Action.OpenUrl',
      title: `Open ${blocker.storyRef}`,
      url: blocker.storyUrl as string
    }))

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
    ...(links.length === 0 ? {} : { actions: links.slice(0, 3) })
  }
}
