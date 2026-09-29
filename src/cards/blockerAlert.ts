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

/** A member's open sprint item, listed when a blocker names none (SPEC-005 2a). */
export interface OpenItemLine { key: string, title: string, url?: string | null }

export function blockerAlertCard (
  memberName: string, localDate: string, blockers: BlockerLine[], openItems: OpenItemLine[] = []
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
    // SPEC-005 2a: when no story is named, show what the member is working on.
    // Information, not attribution — nothing is marked Blocked because of it.
    // By name, never a pronoun.
    const openLine = blocker.storyRef !== null
      ? []
      : [{
          type: 'TextBlock',
          text: openItems.length === 0
            ? `${memberName} has no open items in the sprint.`
            : `${memberName}'s open items: ${openItems.map((item) => `${item.key} ${item.title}`).join('; ')}`,
          isSubtle: true,
          size: 'Small',
          spacing: 'Small',
          wrap: true
        }]
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
        },
        ...openLine
      ]
    })
  }

  const blockerLinks = blockers
    .filter((blocker) => blocker.storyUrl != null && blocker.storyRef !== null)
    .map((blocker) => ({
      type: 'Action.OpenUrl',
      title: `Open ${blocker.storyRef}`,
      url: blocker.storyUrl as string
    }))
  const openLinks = blockers.some((blocker) => blocker.storyRef === null)
    ? openItems.filter((item) => item.url != null && item.url !== '').map((item) => ({
      type: 'Action.OpenUrl', title: `Open ${item.key}`, url: item.url as string
    }))
    : []
  const links = [...blockerLinks, ...openLinks.filter((o) => !blockerLinks.some((b) => b.url === o.url))]

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
    ...(links.length === 0 ? {} : { actions: links.slice(0, 3) })
  }
}
