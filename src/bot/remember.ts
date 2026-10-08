import { type TurnContext } from '@microsoft/agents-hosting'
import type { TeamConfig } from '../types.js'
import { saveBotTeam, saveChannelRef, saveConversationRef, saveScrumMasterRef, teamForChannel, teamForMember, teamsRunBy } from '../store/index.js'
import { channelReference, teamOfActivity } from './channels.js'

/**
 * Stores what the app needs to message this person later.
 *
 * The reference is captured on every activity, not only on install: a member
 * who was added to the team before the app existed still becomes reachable the
 * first time they say anything.
 */
export async function rememberSender (context: TurnContext): Promise<void> {
  const from = context.activity.from
  if (from?.id === undefined) return
  const memberId = from.aadObjectId ?? from.id
  const reference = context.activity.getConversationReference()

  // A Scrum Master is not on any roster (SPEC-008 10f). Their chat is kept once
  // per person, so alerts from every team they run can reach them (10g).
  try {
    if ((await teamsRunBy(memberId)).length > 0) {
      await saveScrumMasterRef(memberId, from.name, JSON.stringify(reference))
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'scrumMaster.saveRefFailed', memberId, error: String(error) }))
  }

  // Stored against the sender's own team (FR-10). Someone on no roster is not
  // added to one: joining a team is the Scrum Master's decision, not a side
  // effect of installing the app. Overlapping rosters are reported by
  // recordUpdate, so they are only logged here.
  let team: TeamConfig | undefined
  try {
    team = await teamForMember(memberId)
  } catch (error) {
    console.error(JSON.stringify({ event: 'team.resolveFailed', memberId, error: String(error) }))
    return
  }
  if (team === undefined) {
    console.log(JSON.stringify({ event: 'sender.notOnRoster', memberId }))
    return
  }

  await saveConversationRef(team.teamId, memberId, from.name, JSON.stringify(reference))
}

/**
 * Captures the channel this activity came from, if it came from one.
 *
 * The end-of-day summary is posted by the bot itself, which needs a stored
 * channel reference — Graph cannot do it, because ChannelMessage.Send works
 * only with a signed-in user behind it. Without this the summary has nowhere
 * to go but email.
 */
export async function rememberChannel (context: TurnContext): Promise<void> {
  const conversation = context.activity.conversation
  if (conversation?.conversationType !== 'channel') return

  // Any activity in a Teams team — the install itself included — makes that
  // team's channels choosable on the admin page (SPEC-008 behaviour 6).
  const teamsTeam = teamOfActivity(context.activity.channelData)
  if (teamsTeam !== undefined) {
    await saveBotTeam({
      teamThreadId: teamsTeam.id,
      name: teamsTeam.name ?? 'Unnamed team',
      reference: JSON.stringify(context.activity.getConversationReference()),
      seenAt: new Date()
    })
    console.log(JSON.stringify({ event: 'channel.teamSeen', teamThreadId: teamsTeam.id }))
  }

  // A reply in a thread carries ';messageid=...' after the channel id.
  const channelId = conversation.id.split(';')[0]
  const team = await teamForChannel(channelId)
  if (team === undefined) {
    // Not any team's stakeholder channel. Storing it would redirect that
    // team's summary into a channel its stakeholders may not be in.
    console.log(JSON.stringify({ event: 'channel.notConfigured', channelId }))
    return
  }
  await saveChannelRef(team.teamId, channelReference(context.activity.getConversationReference(), channelId))
}
