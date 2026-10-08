import type { RowStatus } from '../trackers/types.js'

/**
 * How a message ended (SPEC-004 items 11–20). Every value has its own reply;
 * none of them is silent.
 */
export type IntakeOutcome =
  | 'recorded' // at least one verified item was written
  | 'nothingRecorded' // the message was an update, but no item could be verified
  | 'notUnderstood' // an update the model could not read (5b)
  | 'notUpdate' // not a stand-up update at all (item 15)
  | 'nothing' // "nothing to report" — not recorded, non-responder for now (item 16)
  | 'notLinked' // member has no Jira link, so ownership cannot be checked (item 20)
  | 'general' // no sprint, or no open story of their own: one General row (item 39)

/** An item the member reported that was not written, and why (items 13–14). */
export type Refusal =
  | { reason: 'noWorkItem', words: string }
  | { reason: 'unassigned', key: string }

/**
 * An item that is not clearly the member's own story (SPEC-004 item 38): her
 * own open stories and every other story it could fit, for her to choose on a
 * card. Travels in the card's button data, never in Firestore.
 */
export interface ChoiceItem {
  words: string
  status: RowStatus
  blocker: string | null
  options: Array<{ key: string, title: string, owner: string | null, mine: boolean }>
  /** Item 40: a blocker that fit no story; None of these files it as a General row. */
  noStory?: boolean
}

/** At most this many stories on one choice card (item 38). */
export const MAX_CHOICES = 5

/** A story item to record on Submit (items 14a, 38): the hand-over to `recordForeignItem`. */
export interface PendingItem {
  key: string
  title: string | null
  owner: string
  status: RowStatus
  comment: string | null
  blocker: string | null
}

/** A row this message wrote, as the member is told about it (item 17). */
export interface RecordedItem {
  win: string
  title: string | null
  status: RowStatus
  blocker: string | null
  /** Her own words for this item, so she sees which part of the message went where (1 Oct 2026). */
  said?: string | null
}

export interface IntakeResult {
  outcome: IntakeOutcome
  /** False when nothing could be taken from the message and nothing was written (SPEC-004 5b). */
  understood: boolean
  recorded: RecordedItem[]
  refused: Refusal[]
  /** Items that are not clearly her own story, awaiting her choice on a card (item 38). */
  choices: ChoiceItem[]
  /** Blockers not tied to a verified work item: not written, but alerted (item 19; item 40 when she has no open story). */
  unlinkedBlockers: string[]
  /** The member's open sprint items, offered back when a work item was not found (item 13). */
  openItems: Array<{ key: string, title: string }>
  /** False when no alert about a missing sprint could be sent; the reason says why. */
  noSprintAlertSent?: boolean
  /** Item 39: what went into the member's General row from this message. */
  general?: { said: string | null, blocker: string | null }
  /** Rows the member now has for the day, after merging (A11). */
  rows: number
  /** Rows this particular message contributed. */
  added: number
  blockers: number
  alertSent: boolean
  alertReason?: string
  /** The alert's result code (design review: decide on codes, not sentences). */
  alertCode?: import('./blockerAlert.js').AlertCode
  extractionMs: number
  totalMs: number
  truncated: boolean
  confidence: 'high' | 'low'
}

/**
 * Raised when a member messages after the day's summary has gone out (A14).
 *
 * The stand-up closes when the summary runs: nothing is written to the tracker
 * and the member is sent to their Scrum Master. Thrown before the model is
 * called, so a message that will not be recorded is never paid for.
 */
export class StandupClosedError extends Error {
  constructor (public readonly localDate: string) {
    super(`the stand-up for ${localDate} closed when the summary was sent`)
    this.name = 'StandupClosedError'
  }
}
