/**
 * Host half of dsh-workspace-classifier.
 *
 * The sidebar tree itself is browser-only. The host contributes one small
 * read model the client cannot derive from the shipped snapshots: the latest
 * failed turn per Session. It listens to committed session events and serves
 * `GET /workspace-classifier/turn-errors` as JSON; the client polls it and
 * turns an unacknowledged failed turn into a red reminder dot.
 */

export const name = 'dsh-workspace-classifier'

const ENDPOINT = '/workspace-classifier/turn-errors'

export function apply(ctx) {
  /** sessionId -> { turn, kind, message, code, time } */
  const turnErrors = new Map()

  const sessionIdOf = (session) => {
    if (session === null || session === undefined) return undefined
    if (typeof session.id === 'string') return session.id
    if (session.header !== undefined && typeof session.header.id === 'string') return session.header.id
    return undefined
  }

  ctx.on('session/event', (session, event) => {
    const sessionId = sessionIdOf(session)
    if (sessionId === undefined || event === null || event === undefined) return
    const data = event.data === undefined ? {} : event.data
    if (event.type === 'turn/start') {
      turnErrors.delete(sessionId)
      return
    }
    if (event.type === 'turn/end') {
      const reason = data.reason === undefined ? {} : data.reason
      if (reason.kind !== 'error') {
        turnErrors.delete(sessionId)
        return
      }
      const error = reason.error === undefined ? {} : reason.error
      turnErrors.set(sessionId, {
        turn: typeof data.turn === 'number' ? data.turn : 0,
        kind: 'error',
        message: typeof error.message === 'string' && error.message !== '' ? error.message : '运行失败',
        code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
        time: typeof event.time === 'number' ? event.time : Date.now()
      })
      return
    }
    if (event.type === 'agent-error') {
      turnErrors.set(sessionId, {
        turn: typeof data.turn === 'number' ? data.turn : 0,
        kind: 'error',
        message: typeof data.message === 'string' && data.message !== '' ? data.message : '运行失败',
        code: typeof data.code === 'string' ? data.code : 'UNKNOWN',
        time: typeof event.time === 'number' ? event.time : Date.now()
      })
    }
  })

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() => {
      const dispose = scoped.webServer.register({
        kind: 'exact',
        path: ENDPOINT,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          const body = JSON.stringify(Object.fromEntries(turnErrors))
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          })
          if (req.method === 'HEAD') res.end()
          else res.end(body)
        }
      })
      return () => {
        dispose()
        turnErrors.clear()
      }
    }, 'workspace-classifier: turn-errors route')
  })
}
