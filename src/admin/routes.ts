import { randomBytes } from 'node:crypto'
import express, { type Request, type Response, type NextFunction } from 'express'
import { config } from '../config/env.js'
import { authorizeUrl, completeSignIn } from './auth.js'
import { cookie, readCookie, seal, unseal } from './session.js'
import { adminPage } from './page.js'
import {
  AdminError, addMember, addStakeholder, linkJira, removeMember, removeStakeholder, runNow,
  llmUsage, teamFor, teamsFor, teamView, updateSchedule, type Actor
} from './service.js'

/**
 * The admin page and its JSON API, mounted at /admin (SPEC-008).
 *
 * Everything except sign-in itself requires a valid session. Writes also
 * require a custom header, which a form posted from another site cannot send.
 */

const SESSION = 'sa_session'
const PENDING = 'sa_signin'
const WRITE_HEADER = 'x-admin-request'

interface Session extends Actor { exp: number }
interface Pending { state: string, nonce: string, exp: number }

function enabled (): boolean {
  return config.admin.sessionSecret !== '' && config.admin.publicBaseUrl !== ''
}

function sessionOf (request: Request): Session | undefined {
  return unseal<Session>(readCookie(request.headers.cookie, SESSION), config.admin.sessionSecret)
}

/** Express 4 does not catch a rejected promise; this does, and answers with it. */
function handle (work: (request: Request, response: Response, actor: Actor) => Promise<unknown>) {
  return (request: Request, response: Response): void => {
    const actor = sessionOf(request)
    if (actor === undefined) {
      response.status(401).json({ error: 'Your session has ended. Sign in again.' })
      return
    }
    if (request.method !== 'GET' && request.get(WRITE_HEADER) !== '1') {
      response.status(403).json({ error: 'Request refused.' })
      return
    }
    work(request, response, actor)
      .then((result) => { if (!response.headersSent) response.json(result) })
      .catch((error: unknown) => {
        if (error instanceof AdminError) {
          response.status(error.status).json({ error: error.message })
          return
        }
        console.error(JSON.stringify({ event: 'admin.error', path: request.path, error: String(error) }))
        response.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong.' })
      })
  }
}

export function adminRouter (): express.Router {
  const router = express.Router()

  router.use((_request: Request, response: Response, next: NextFunction) => {
    if (!enabled()) {
      response.status(503).type('text/plain').send('The admin page is not configured: ADMIN_SESSION_SECRET and PUBLIC_BASE_URL must be set.')
      return
    }
    response.set('cache-control', 'no-store')
    next()
  })

  router.get('/', (request, response) => {
    const actor = sessionOf(request)
    if (actor === undefined) {
      response.redirect('/admin/login')
      return
    }
    response.type('html').send(adminPage(actor.name))
  })

  router.get('/login', (_request, response) => {
    const pending: Pending = {
      state: randomBytes(16).toString('base64url'),
      nonce: randomBytes(16).toString('base64url'),
      exp: Date.now() + 10 * 60_000
    }
    response.set('set-cookie', cookie(PENDING, seal(pending, config.admin.sessionSecret), 600))
    response.redirect(authorizeUrl(pending.state, pending.nonce))
  })

  router.get('/auth/callback', (request, response) => {
    void (async () => {
      const pending = unseal<Pending>(readCookie(request.headers.cookie, PENDING), config.admin.sessionSecret)
      const code = typeof request.query.code === 'string' ? request.query.code : ''
      const state = typeof request.query.state === 'string' ? request.query.state : ''

      if (pending === undefined || state !== pending.state || code === '') {
        const reason = typeof request.query.error_description === 'string' ? request.query.error_description : 'The sign-in could not be matched to this browser.'
        response.status(400).type('text/plain').send(`Sign-in failed: ${reason}\n\nGo to /admin to try again.`)
        return
      }
      try {
        const user = await completeSignIn(code, pending.nonce)
        const session: Session = { ...user, exp: Date.now() + config.admin.sessionHours * 3_600_000 }
        console.log(JSON.stringify({ event: 'admin.signedIn', actor: user.oid }))
        response.set('set-cookie', [
          cookie(SESSION, seal(session, config.admin.sessionSecret), config.admin.sessionHours * 3600),
          cookie(PENDING, '', 0)
        ])
        response.redirect('/admin')
      } catch (error) {
        console.error(JSON.stringify({ event: 'admin.signInFailed', error: String(error) }))
        response.status(400).type('text/plain').send(`Sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  })

  router.post('/logout', (_request, response) => {
    response.set('set-cookie', cookie(SESSION, '', 0))
    response.json({ ok: true })
  })

  router.get('/api/teams', handle(async (_request, _response, actor) => ({ teams: await teamsFor(actor) })))

  router.get('/api/llm', handle(async (_request, _response, actor) => await llmUsage(actor)))

  router.get('/api/teams/:teamId', handle(async (request, _response, actor) =>
    await teamView(await teamFor(actor, request.params.teamId))))

  router.patch('/api/teams/:teamId/schedule', handle(async (request, _response, actor) => {
    const team = await teamFor(actor, request.params.teamId)
    const changed = await updateSchedule(team, request.body as Record<string, unknown>, actor)
    return { message: changed.length === 0 ? 'Nothing changed.' : `Saved: ${changed.join(', ')}.` }
  }))

  router.post('/api/teams/:teamId/members', handle(async (request, _response, actor) =>
    ({ message: await addMember(await teamFor(actor, request.params.teamId), (request.body as { email?: unknown }).email, actor) })))

  router.delete('/api/teams/:teamId/members/:memberId', handle(async (request, _response, actor) =>
    ({ message: await removeMember(await teamFor(actor, request.params.teamId), request.params.memberId, actor) })))

  router.put('/api/teams/:teamId/members/:memberId/jira', handle(async (request, _response, actor) =>
    ({
      message: await linkJira(
        await teamFor(actor, request.params.teamId), request.params.memberId,
        (request.body as { jiraAccountId?: unknown }).jiraAccountId, actor
      )
    })))

  router.post('/api/teams/:teamId/stakeholders', handle(async (request, _response, actor) =>
    ({ message: await addStakeholder(await teamFor(actor, request.params.teamId), (request.body as { email?: unknown }).email, actor) })))

  router.delete('/api/teams/:teamId/stakeholders/:email', handle(async (request, _response, actor) =>
    ({ message: await removeStakeholder(await teamFor(actor, request.params.teamId), request.params.email, actor) })))

  router.post('/api/teams/:teamId/run/:jobType', handle(async (request, _response, actor) =>
    ({ message: await runNow(await teamFor(actor, request.params.teamId), request.params.jobType, actor) })))

  return router
}
