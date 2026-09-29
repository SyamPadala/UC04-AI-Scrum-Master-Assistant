import type { IntakeResult } from '../jobs/updateIntake.js'

/**
 * What a member is told about their update (SPEC-004 items 12–20).
 *
 * Plain text, not a card (user decision, 28 Sep 2026): it reads in full in the
 * Teams notification. One line per item written, then every item that was not
 * written with its reason. It never says "Recorded" when nothing was.
 */
export function intakeReply (result: IntakeResult, memberName: string): string {
  switch (result.outcome) {
    case 'notLinked':
      return "Your account isn't linked to Jira yet, so I can't record updates for you. Please ask your Scrum Master."
    case 'notUpdate':
      return "This doesn't look like a stand-up update, so it isn't counted as a response."
    case 'nothing':
      return 'Nothing recorded. A stand-up update needs at least one work item, so this isn\'t counted as a response.'
    case 'notUnderstood':
      return "I couldn't tell which work item that is about, so I haven't changed anything. " +
        'Could you name the item? For example: *SCRUM-21 is unblocked and back in progress*.'
    default:
      break
  }

  const lines: string[] = []

  if (result.outcome === 'noSprint') {
    lines.push("There is no active sprint, so I couldn't link your update to a work item and haven't recorded it." +
      (result.noSprintAlertSent === true ? ' Your Scrum Master has been told.' : ''))
  } else if (result.recorded.length > 0) {
    lines.push(`Recorded your update, ${memberName}:`)
    for (const item of result.recorded) {
      const title = item.title === null ? '' : ` ${item.title}`
      lines.push(item.blocker === null
        ? `✔ ${item.win}${title} — ${item.status}`
        : `⚠ ${item.win}${title} — Blocked: ${item.blocker}`)
    }
  } else {
    lines.push((result.pending.length > 0 || result.ambiguous.length > 0) && result.refused.length === 0
      ? 'Nothing recorded yet:'
      : "I haven't recorded anything from that message:")
  }

  for (const refusal of result.refused) {
    if (refusal.reason === 'unassigned') {
      lines.push(`✘ ${refusal.key} is not assigned to you, so it can't be updated. Please reach out to your Scrum Master.`)
    } else {
      const options = result.openItems.length === 0
        ? ''
        : ` Your open items: ${result.openItems.map((item) => `${item.key} ${item.title}`).join(', ')}. Which one is it?`
      lines.push(`✘ I couldn't find a work item for: "${refusal.words}".${options}`)
    }
  }

  // Item 14a: the card that follows this reply asks them to confirm.
  for (const item of result.pending) {
    lines.push(`? ${item.key} is assigned to ${item.owner}, not you. Confirm below if you still want it recorded.`)
  }

  // Item 24: the card that follows asks which story they meant.
  for (const item of result.ambiguous) {
    lines.push(`? Which story is "${item.words}"? Choose below.`)
  }

  // A blocker already alerted earlier today is one the Scrum Master has heard.
  const alerted = result.alertSent || result.alertReason === 'all blockers already alerted today'
  for (const blocker of result.unlinkedBlockers) {
    lines.push(alerted
      ? `⚠ Your Scrum Master has been told about: "${blocker}". It isn't linked to a work item, so it hasn't gone into the tracker.`
      : `⚠ "${blocker}" isn't linked to a work item, so it hasn't gone into the tracker, and I couldn't reach your Scrum Master about it.`)
  }
  // Blockers on recorded items: say whether the Scrum Master heard.
  if (result.recorded.some((item) => item.blocker !== null)) {
    lines.push(alerted
      ? '→ Your Scrum Master has been told about the blocker.'
      : '→ I could not reach your Scrum Master about the blocker; it is recorded in the tracker.')
  }
  if (result.truncated) lines.push('Your message was long, so only the first part was read.')
  return lines.join('\n')
}
