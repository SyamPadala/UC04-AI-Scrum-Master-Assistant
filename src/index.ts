import express from 'express'
import { createAgentRequestHandler } from '@microsoft/agents-hosting-express'
import { config } from './config/env.js'
import { agent, authConfig } from './bot/adapter.js'
import { firestoreReachable } from './store/firestore.js'
import { runTick } from './jobs/tick.js'
import { adminRouter } from './admin/routes.js'

const app = express()
app.use(express.json())

/**
 * Teams delivers every activity here.
 *
 * The SDK's own handler is used rather than calling the adapter directly: it
 * applies the JWT authorization step that both verifies the request came from
 * Microsoft and establishes the identity the app needs to reply. Wiring the
 * adapter by hand skips that, and every reply then fails with a 401 while
 * proactive messages — which carry their own credentials — keep working.
 */
app.post('/api/messages', createAgentRequestHandler(agent, authConfig) as never)

/**
 * Cloud Scheduler heartbeat.
 *
 * Returns 200 even when individual jobs fail: a 5xx makes Cloud Scheduler retry
 * the whole tick, which would re-run the jobs that had already succeeded.
 */
app.post('/tick', (request, response) => {
  void (async () => {
    if (request.get('x-tick-secret') !== config.tick.sharedSecret) {
      response.status(401).json({ error: 'bad or missing x-tick-secret' })
      return
    }
    try {
      const ran = await runTick()
      response.json({ ran })
    } catch (error) {
      console.error('tick failed', error)
      response.status(200).json({ ran: [], error: 'tick failed, see logs' })
    }
  })()
})

/** The Scrum Master's admin page and its API (SPEC-008). */
app.use('/admin', adminRouter())

app.get('/health', (_request, response) => {
  void (async () => {
    response.json({
      status: 'ok',
      firestore: await firestoreReachable() ? 'ok' : 'unreachable',
      version: '0.3.0'
    })
  })()
})

app.listen(config.port, () => {
  console.log(`Scrum Assistant listening on port ${config.port}`)
})
