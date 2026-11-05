/**
 * Host half of the sticky-note plugin.
 *
 * Owns one JSON board under `$DSH_HOME/sticky-note/board.json`:
 *
 *   sticky-note/
 *   └─ board.json   { version, updatedAt, notes: [{ id, col, text, order, createdAt, updatedAt }] }
 *
 * Four columns are fixed (stash / todo / done / trash); the client renders them
 * in that order. Every mutation is serialized and written through a temp file +
 * rename so a crash never leaves a half-written board.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PREFIX = '/sticky-note'
const COLS = ['stash', 'todo', 'done', 'trash']
const MAX_TEXT = 2000
const MAX_BODY_BYTES = 256 * 1024
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i

export const name = 'sticky-note'
export const inject = ['webServer']

export function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dir = join(home, 'sticky-note')
  const boardPath = join(dir, 'board.json')

  let chain = Promise.resolve()

  function log(level, message) {
    try {
      const logger = typeof ctx.logger === 'function' ? ctx.logger('sticky-note') : undefined
      if (logger && typeof logger[level] === 'function') logger[level](message)
    } catch {
      /* logging never fails a request */
    }
  }

  function emptyBoard() {
    return { version: 1, updatedAt: 0, notes: [] }
  }

  function cleanText(value) {
    if (typeof value !== 'string') return ''
    const normalized = value.replace(/\r\n/g, '\n')
    // Count by code point so a 2000th-character cut never splits an emoji.
    const chars = Array.from(normalized)
    return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT).join('') : normalized
  }

  function normalizeNote(raw, fallbackCol) {
    if (!raw || typeof raw !== 'object') return null
    const col = COLS.includes(raw.col) ? raw.col : fallbackCol
    if (!COLS.includes(col)) return null
    const text = cleanText(raw.text)
    if (text.trim() === '') return null
    const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id.slice(0, 64) : 'n_' + randomUUID().slice(0, 8)
    return {
      id,
      col,
      text,
      order: Number.isFinite(raw.order) ? Math.max(0, Math.trunc(raw.order)) : 0,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    }
  }

  /** Re-index every column to 0..n-1 and drop duplicates by id. */
  function tidy(notes) {
    const seen = new Set()
    const out = []
    for (const col of COLS) {
      const bucket = notes.filter((n) => n.col === col).sort((a, b) => a.order - b.order)
      bucket.forEach((note, index) => {
        if (seen.has(note.id)) return
        seen.add(note.id)
        out.push({ ...note, order: index })
      })
    }
    return out
  }

  function readBoard() {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(boardPath, 'utf8'))
    } catch {
      return emptyBoard()
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.notes)) return emptyBoard()
    const notes = tidy(parsed.notes.map((raw) => normalizeNote(raw, null)).filter(Boolean))
    return {
      version: 1,
      updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
      notes,
    }
  }

  function writeBoard(board) {
    mkdirSync(dir, { recursive: true })
    const temp = boardPath + '.tmp'
    writeFileSync(temp, JSON.stringify(board, null, 2) + '\n', 'utf8')
    renameSync(temp, boardPath)
  }

  function view() {
    const board = readBoard()
    return { ok: true, board }
  }

  /** Serialize every read-modify-write so concurrent windows cannot interleave. */
  function mutate(work) {
    const run = chain.then(() => {
      const board = readBoard()
      const next = work(board)
      const { notes: rawNotes, ...extra } = next
      const notes = tidy(rawNotes)
      const saved = { version: 1, updatedAt: Date.now(), notes }
      writeBoard(saved)
      return { ok: true, board: saved, ...extra }
    })
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  function sendJson(response, status, payload) {
    if (response.writableEnded) return
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'content-length': body.length,
    })
    response.end(body)
  }

  async function readBody(request) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        const error = new Error('request body too large')
        error.status = 413
        throw error
      }
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  }

  async function readJsonBody(request) {
    const raw = (await readBody(request)).toString('utf8')
    if (raw.trim() === '') return {}
    try {
      return JSON.parse(raw)
    } catch {
      const error = new Error('invalid json')
      error.status = 400
      throw error
    }
  }

  /** The host's own request gate (login + origin fence), read per request. */
  function requestGate(request) {
    let connection
    try {
      connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    } catch {
      connection = undefined
    }
    const gate = connection && connection.requestRejection
    if (typeof gate !== 'function') return undefined
    try {
      return gate.call(connection, request)
    } catch {
      return 403
    }
  }

  /** Rebinding fence for mutations, used only when the host publishes no gate. */
  function trustedRequest(request) {
    const host = request.headers.host
    if (host !== undefined && !LOOPBACK_HOST.test(host)) return false
    if (request.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = request.headers.origin
    if (origin === undefined) return true
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }

  async function handle(request, response) {
    const rejection = requestGate(request)
    if (typeof rejection === 'number' && rejection !== 0) {
      sendJson(response, rejection, {
        error: rejection === 401 ? '需要先登录 DSH / login required' : '请求被拒绝 / forbidden',
      })
      return
    }

    const method = String(request.method || 'GET').toUpperCase()
    const url = new URL(String(request.url || '/'), 'http://127.0.0.1')
    const route = url.pathname.slice(PREFIX.length) || '/'

    if (method === 'GET' && route === '/board') {
      sendJson(response, 200, view())
      return
    }

    const mutating = method === 'POST' || method === 'PATCH' || method === 'DELETE'
    if (mutating && !trustedRequest(request)) {
      sendJson(response, 403, { error: 'untrusted request' })
      return
    }

    if (method === 'POST' && route === '/note') {
      const body = await readJsonBody(request)
      if (!COLS.includes(body.col)) {
        sendJson(response, 400, { error: 'invalid column' })
        return
      }
      const text = cleanText(body.text)
      if (text.trim() === '') {
        sendJson(response, 400, { error: 'empty text' })
        return
      }
      const now = Date.now()
      const result = await mutate((board) => {
        const order = board.notes.filter((n) => n.col === body.col).length
        const note = {
          id: 'n_' + randomUUID().slice(0, 8),
          col: body.col,
          text,
          order,
          createdAt: now,
          updatedAt: now,
        }
        return { notes: [...board.notes, note] }
      })
      sendJson(response, 200, result)
      return
    }

    if (method === 'PATCH' && route.startsWith('/note/')) {
      const id = decodeURIComponent(route.slice('/note/'.length))
      const body = await readJsonBody(request)
      const text = cleanText(body.text)
      if (text.trim() === '') {
        sendJson(response, 400, { error: 'empty text' })
        return
      }
      const result = await mutate((board) => {
        let found = false
        const notes = board.notes.map((note) => {
          if (note.id !== id) return note
          found = true
          return { ...note, text, updatedAt: Date.now() }
        })
        if (!found) {
          const error = new Error('not found')
          error.status = 404
          throw error
        }
        return { notes }
      })
      sendJson(response, 200, result)
      return
    }

    if (method === 'DELETE' && route.startsWith('/note/')) {
      const id = decodeURIComponent(route.slice('/note/'.length))
      const result = await mutate((board) => {
        const target = board.notes.find((note) => note.id === id)
        if (!target) {
          const error = new Error('not found')
          error.status = 404
          throw error
        }
        return { notes: board.notes.filter((note) => note.id !== id), removed: target }
      })
      sendJson(response, 200, { ok: true, board: result.board, note: result.removed })
      return
    }

    if (method === 'POST' && route === '/restore') {
      const body = await readJsonBody(request)
      const note = normalizeNote(body.note, body.note && body.note.col)
      if (!note) {
        sendJson(response, 400, { error: 'invalid note' })
        return
      }
      const result = await mutate((board) => {
        if (board.notes.some((existing) => existing.id === note.id)) return { notes: board.notes }
        const bucket = board.notes.filter((n) => n.col === note.col)
        const index = Math.min(Math.max(0, note.order), bucket.length)
        const rest = board.notes.filter((n) => n.col !== note.col)
        const merged = []
        for (const col of COLS) {
          if (col === note.col) {
            const list = bucket.slice()
            list.splice(index, 0, note)
            list.forEach((n, i) => merged.push({ ...n, order: i }))
          } else {
            rest.filter((n) => n.col === col).forEach((n, i) => merged.push({ ...n, order: i }))
          }
        }
        return { notes: merged }
      })
      sendJson(response, 200, result)
      return
    }

    if (method === 'POST' && route === '/move') {
      const body = await readJsonBody(request)
      if (!COLS.includes(body.col)) {
        sendJson(response, 400, { error: 'invalid column' })
        return
      }
      const result = await mutate((board) => {
        const moving = board.notes.find((note) => note.id === body.id)
        if (!moving) {
          const error = new Error('not found')
          error.status = 404
          throw error
        }
        const target = body.col
        const rest = board.notes.filter((note) => note.id !== moving.id)
        const bucket = rest.filter((note) => note.col === target).sort((a, b) => a.order - b.order)
        const index = Math.min(Math.max(0, Number(body.index) || 0), bucket.length)
        const moved = { ...moving, col: target, updatedAt: Date.now() }
        bucket.splice(index, 0, moved)
        const merged = []
        for (const col of COLS) {
          if (col === target) {
            bucket.forEach((n, i) => merged.push({ ...n, order: i }))
          } else {
            rest.filter((n) => n.col === col).forEach((n, i) => merged.push({ ...n, order: i }))
          }
        }
        return { notes: merged }
      })
      sendJson(response, 200, result)
      return
    }

    sendJson(response, 404, { error: 'not found' })
  }

  function onRequest(request, response) {
    Promise.resolve(handle(request, response)).catch((error) => {
      const status = typeof error?.status === 'number' ? error.status : 500
      if (!response.headersSent) {
        sendJson(response, status, { error: status >= 500 ? 'internal error' : String(error.message || 'bad request') })
      } else if (!response.writableEnded) {
        try {
          response.end()
        } catch {
          /* socket already gone */
        }
      }
      if (status >= 500) log('error', (error && error.stack) || String(error))
    })
  }

  const dispose = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: onRequest })
  ctx.effect(() => () => {
    try {
      dispose()
    } catch (error) {
      log('warn', 'route disposal failed: ' + String(error))
    }
  })
}
