import express from 'express'
import { config } from './config/env.js'
import { adapter, agent, headerPropagation } from './bot/adapter.js'
import { firestoreReachable } from './store/firestore.js'
import { runTick } from './jobs/tick.js'

const app = express()
app.use(express.json())

// Teams delivers every activity here. The SDK verifies the request came from
// Microsoft before the handler sees it.
app.post('/api/messages', (request, response) => {
  void adapter.process(
    request as never,
    response as never,
    async (context) => { await agent.run(context) },
    headerPropagation
  )
})

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

app.get('/health', (_request, response) => {
  void (async () => {
    response.json({
      status: 'ok',
      firestore: await firestoreReachable() ? 'ok' : 'unreachable',
      version: '0.2.0'
    })
  })()
})

app.listen(config.port, () => {
  console.log(`Scrum Assistant listening on port ${config.port}`)
})
