import { timingSafeEqual } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import { z } from 'zod'
import { Activity, type ConversationReference } from '@microsoft/agents-activity'
import type { TurnContext } from '@microsoft/agents-hosting'
import { config } from '../config/env.js'
import { adapter, agent } from './adapter.js'
import { HANDOFF_HEADER, HANDOFF_PATH, type HandedOffUpdate } from './handoff.js'
import { newCorrelationId, withCorrelation } from '../util/correlation.js'

/**
 * SPEC-004 item 41 (M4): the receiving end of the hand-over. Answers 202 at
 * once so the Teams turn can finish, then keeps this request open until the
 * update is processed — Cloud Run gives the work CPU only while it is open.
 */

const payloadSchema = z.object({
  reference: z.record(z.string(), z.unknown()),
  ackId: z.string().min(1),
  memberId: z.string().min(1),
  memberName: z.string(),
  text: z.string().min(1).max(20_000)
})

function allowed (request: Request): boolean {
  const given = Buffer.from(request.get(HANDOFF_HEADER) ?? '')
  const expected = Buffer.from(config.tick.sharedSecret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export function handoffRouter (): express.Router {
  const router = express.Router()
  router.post(HANDOFF_PATH, (request: Request, response: Response) => {
    if (!allowed(request)) {
      response.status(401).end()
      return
    }
    const parsed = payloadSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).end()
      return
    }
    const update = parsed.data as HandedOffUpdate
    const id = request.get('x-correlation-id') ?? newCorrelationId('msg')

    // Accepted: headers out now, body ends when the work is done.
    response.status(202)
    response.setHeader('content-type', 'text/plain')
    response.flushHeaders()

    void withCorrelation(id, async () => {
      try {
        await adapter.continueConversation(config.bot.appId, update.reference as ConversationReference, async (context: TurnContext) => {
          await agent.processHandedOff(context, update)
        })
        console.log(JSON.stringify({ event: 'handoff.done', memberId: update.memberId }))
      } catch (error) {
        console.error(JSON.stringify({ event: 'handoff.processFailed', memberId: update.memberId, error: String(error) }))
        // Never leave the member looking at "working on it…".
        await adapter.continueConversation(config.bot.appId, update.reference as ConversationReference, async (context: TurnContext) => {
          const text = 'I could not process that update, so nothing was recorded. Please send it again in a moment.'
          await context.updateActivity(Activity.fromObject({ type: 'message', id: update.ackId, text }))
            .catch(async () => { await context.sendActivity(text) })
        }).catch(() => {})
      } finally {
        response.end()
      }
    })
  })
  return router
}
