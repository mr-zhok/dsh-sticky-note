/**
 * Client half of the sticky-note plugin.
 *
 * Two registrations share one board:
 *  - `sidebar.panellist` — the "便签" row in the sidebar's global panel list;
 *  - `main` (keyed)     — the four-column board page the shell mounts while
 *                         that row is selected.
 *
 * The Host owns `$DSH_HOME/sticky-note/board.json`; this module only renders
 * snapshots returned by the HTTP routes under `/sticky-note`.
 */
window.__ModuleLoader__.load({
  id: '@zhang/dsh-sticky-note',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const PANEL_ID = 'sticky-note'
    const PANEL_ORDER = 30
    const API = '/sticky-note'
    const MAX_TEXT = 2000
    const UNDO_MS = 5000
    const SHAKE_MS = 200
    const CLICK_DELAY = 220

    const COLUMNS = [
      { id: 'stash', title: '暂存' },
      { id: 'todo', title: '待办' },
      { id: 'done', title: '已办' },
      { id: 'trash', title: '临时废弃' },
    ]

    const CSS = `
.dsn-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsn-head{height:56px;flex:0 0 56px;display:flex;align-items:center;gap:10px;padding:0 24px}
.dsn-title{font-size:15px;font-weight:600;letter-spacing:.3px}
.dsn-count{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsn-board{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:0 20px 20px}
.dsn-col{display:flex;flex-direction:column;min-height:0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dsn-col.drop{border-color:rgba(53,196,106,.45)}
.dsn-col-head{height:40px;flex:0 0 40px;display:flex;align-items:center;justify-content:center;gap:7px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsn-col-title{font-size:13.5px;letter-spacing:.5px}
.dsn-col-n{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsn-add{width:18px;height:18px;border-radius:50%;border:1.2px solid rgba(53,196,106,.85);background:rgba(53,196,106,.07);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;transition:background .15s}
.dsn-add:hover{background:rgba(53,196,106,.2)}
.dsn-add svg{width:9px;height:9px;stroke:#35c46a;stroke-width:2;fill:none}
.dsn-col-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px;scrollbar-width:none}
.dsn-col-body::-webkit-scrollbar{display:none}
.dsn-notes{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start}
.dsn-note{position:relative;height:162px;border-radius:2px;background:#FFF7BC;box-shadow:0 1px 1px rgba(0,0,0,.45),0 6px 14px rgba(0,0,0,.22);padding:10px 9px 8px;overflow:hidden;cursor:pointer;user-select:none}
.dsn-note-text{font-size:12.5px;line-height:19px;color:#4A4433;overflow-wrap:break-word;word-break:normal;letter-spacing:.1px;white-space:pre-wrap}
.dsn-fold{position:absolute;top:0;right:0;width:17px;height:17px;background:#E4D089;clip-path:polygon(100% 0,0 0,100% 100%)}
.dsn-del{position:absolute;right:4px;bottom:4px;width:18px;height:18px;border-radius:50%;border:1.7px solid #E0454B;background:#FFFDF2;display:none;align-items:center;justify-content:center;padding:0;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.18);z-index:2}
.dsn-del::after{content:"";display:block;width:9px;height:1.9px;border-radius:1px;background:#E0454B}
.dsn-note:hover .dsn-del{display:flex}
.dsn-note.selected{outline:2px solid rgba(53,196,106,.9);outline-offset:3px}
.dsn-note.shake{animation:dsn-shake 200ms ease-in-out}
@keyframes dsn-shake{0%{transform:rotate(0)}25%{transform:rotate(2deg)}50%{transform:rotate(-2deg)}75%{transform:rotate(1deg)}100%{transform:rotate(0)}}
.dsn-note.dragging{opacity:.35}
.dsn-slot{height:162px;border-radius:3px;border:1.5px dashed rgba(53,196,106,.55);background:rgba(53,196,106,.06)}
.dsn-error{padding:24px;font-size:13px;color:var(--dsw-alias-state-error-primary)}
.dsn-empty{padding:20px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:center}
.dsn-overlay{position:fixed;inset:0;z-index:1000;background:rgba(6,6,8,.52);display:flex;align-items:center;justify-content:center}
.dsn-dialog{width:670px;max-width:calc(100vw - 64px);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 28px 70px rgba(0,0,0,.6);padding:18px 20px 16px}
.dsn-dhead{display:flex;align-items:center;gap:8px}
.dsn-dtitle{font-size:14px;font-weight:600}
.dsn-x{margin-left:auto;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;line-height:1}
/* Sits right after the title, not at the far right: the × keeps the auto
   margin, so the two never collide. */
.dsn-edit{width:22px;height:22px;border-radius:6px;flex:0 0 22px;display:flex;align-items:center;justify-content:center;margin-left:2px;
  border:1px solid rgba(53,196,106,.5);background:rgba(53,196,106,.1);color:#5FD98A;cursor:pointer;padding:0;transition:background .15s,border-color .15s}
.dsn-edit:hover{background:rgba(53,196,106,.22);border-color:rgba(53,196,106,.8)}
.dsn-edit:focus-visible{outline:2px solid rgba(53,196,106,.75);outline-offset:2px}
.dsn-edit svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.dsn-dsub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:4px 0 14px}
.dsn-paper{display:block;width:100%;height:338px;box-sizing:border-box;background:#FFF7BC;border:1px solid #E4D089;border-radius:3px;padding:12px 14px;color:#4A4433;font-size:13px;line-height:22px;font-family:inherit;resize:none;outline:none;white-space:pre-wrap}
.dsn-paper::placeholder{color:#9D9166}
.dsn-paper.dsn-readonly{overflow-y:auto;white-space:pre-wrap;overflow-wrap:break-word;cursor:default;scrollbar-width:none}
.dsn-paper.dsn-readonly::-webkit-scrollbar{display:none}
.dsn-meta{display:flex;align-items:center;gap:8px;margin:2px 0 12px}
.dsn-tag{font-size:11px;color:#CFD6C0;background:rgba(255,247,188,.1);border:1px solid rgba(255,247,188,.18);border-radius:5px;padding:1px 7px}
.dsn-time{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dsn-foot{display:flex;align-items:center;gap:8px;margin-top:14px}
.dsn-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dsn-right{margin-left:auto;display:flex;gap:8px}
.dsn-btn{height:31px;padding:0 15px;border-radius:8px;font-size:13px;border:1px solid transparent;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center}
.dsn-btn.ghost{border-color:var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dsn-btn.primary{background:#35C46A;color:#06240F;font-weight:600}
.dsn-btn.danger{border-color:rgba(240,84,84,.35);background:rgba(240,84,84,.1);color:#F07373}
.dsn-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1100;display:flex;align-items:center;gap:14px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 14px;font-size:12.5px;box-shadow:0 10px 24px rgba(0,0,0,.4)}
.dsn-undo{border:0;background:none;color:#35C46A;font-weight:600;cursor:pointer;font-size:12.5px;font-family:inherit}
/* ---- floating ball ---- */
.dsn-sw{display:inline-flex;align-items:center;gap:7px;margin-left:10px;cursor:pointer;user-select:none}
.dsn-sw-track{width:32px;height:18px;border-radius:9px;background:#3a3a42;position:relative;transition:background .18s;flex:0 0 32px}
.dsn-sw-track::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#cfcfd6;transition:transform .18s,background .18s}
.dsn-sw.on .dsn-sw-track{background:#35C46A}
.dsn-sw.on .dsn-sw-track::after{transform:translateX(14px);background:#fff}
.dsn-sw-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsn-sw.on .dsn-sw-label{color:var(--dsw-alias-label-primary)}
.dsn-ball{position:fixed;width:56px;height:56px;border-radius:50%;z-index:900;cursor:grab;
  background:linear-gradient(135deg,#ff8a65 0%,#f0568b 52%,#a15cf0 100%);color:#fff;
  font-size:22px;font-weight:600;display:flex;align-items:center;justify-content:center;
  box-shadow:0 8px 22px rgba(240,86,139,.42),0 2px 4px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.35);
  user-select:none;touch-action:none;pointer-events:auto}
.dsn-ball:active{cursor:grabbing}
.dsn-ball::before{content:"";position:absolute;inset:5px;border-radius:50%;
  background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.45),transparent 62%);pointer-events:none}
.dsn-ball .ch{position:relative;text-shadow:0 1px 2px rgba(0,0,0,.28)}
.dsn-pop{position:fixed;z-index:901;width:372px;box-sizing:border-box;pointer-events:auto;background:var(--dsw-alias-bg-overlay);
  border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:10px 12px 12px;
  box-shadow:0 26px 64px rgba(0,0,0,.62),0 2px 6px rgba(0,0,0,.4)}
.dsn-pop-head{position:relative;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;
  height:32px;margin-bottom:9px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:7px}
.dsn-pop-group{display:flex;align-items:center;justify-content:center;gap:10px}
.dsn-nav{width:22px;height:22px;border-radius:6px;flex:0 0 22px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;padding:0}
.dsn-nav svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:1.8}
.dsn-nav.off{color:var(--dsw-alias-state-idle-primary);cursor:default}
.dsn-pop-title{display:flex;align-items:baseline;gap:6px}
.dsn-pop-title .t{font-size:13.5px;letter-spacing:.8px}
.dsn-pop-title .n{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dsn-pop-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;height:322px;overflow:hidden}
.dsn-pop-note{position:relative;height:156px;border-radius:2px;background:#FFF7BC;padding:8px 7px;cursor:pointer;
  box-shadow:0 1px 1px rgba(0,0,0,.4),0 5px 12px rgba(0,0,0,.22);overflow:hidden}
.dsn-pop-note .tx{font-size:11.5px;line-height:17px;color:#4A4433;overflow-wrap:break-word;
  display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}
.dsn-pop-note .fd{position:absolute;top:0;right:0;width:14px;height:14px;background:#E4D089;
  clip-path:polygon(100% 0,0 0,100% 100%)}
.dsn-pop-empty{grid-column:1 / -1;position:relative;height:322px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:13px;border:0;background:transparent;padding:0;margin:0;
  cursor:pointer;font-family:inherit;color:var(--dsw-alias-label-primary)}
.dsn-pop-empty::before{content:"";position:absolute;inset:0;border-radius:10px;
  border:1px dashed rgba(53,196,106,.3);transition:background .15s,border-color .15s}
.dsn-pop-empty:hover::before{background:rgba(53,196,106,.07);border-color:rgba(53,196,106,.5)}
.dsn-pop-empty .big{width:56px;height:56px;flex:0 0 56px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  border:1.5px dashed rgba(53,196,106,.7);background:rgba(53,196,106,.1);color:#5FD98A}
.dsn-pop-empty .big svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}
.dsn-pop-empty .t1{font-size:13px}
.dsn-pop-empty .t2{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:-7px}
.dsn-plus{justify-self:end;margin-right:5px;width:22px;height:22px;border-radius:6px;
  display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;
  border:1px solid rgba(53,196,106,.85);background:rgba(53,196,106,.14);color:#5FD98A;transition:background .15s}
.dsn-plus:hover{background:rgba(53,196,106,.28)}
.dsn-plus svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round}
.dsn-dots{display:flex;gap:4px;justify-content:center;margin-top:8px}
.dsn-dots i{width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.dsn-dots i.on{background:#35C46A;width:12px;border-radius:2px}
`

    // ---------------------------------------------------------------- store

    const store = {
      state: {
        status: 'loading',
        board: { version: 1, updatedAt: 0, notes: [], ui: { ballEnabled: false, ballX: null, ballY: null } },
        error: null,
      },
      listeners: new Set(),
      set(patch) {
        store.state = Object.assign({}, store.state, patch)
        for (const listener of store.listeners) listener()
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      get() {
        return store.state
      },
    }
    // Wave off `this` binding: React calls these as bare functions.
    const getSnapshot = () => store.get()
    const subscribeStore = (listener) => store.subscribe(listener)

    const DEFAULT_UI = { ballEnabled: false, ballX: null, ballY: null }

    /**
     * Ball settings always exist for the render tree: an older Host, a damaged
     * file or an empty first load must not be able to crash the panel.
     */
    function uiOf(board) {
      const ui = board && board.ui
      if (!ui || typeof ui !== 'object') return DEFAULT_UI
      return {
        ballEnabled: ui.ballEnabled === true,
        ballX: Number.isFinite(ui.ballX) ? ui.ballX : null,
        ballY: Number.isFinite(ui.ballY) ? ui.ballY : null,
      }
    }

    function api(path) {
      const relative = String(path).replace(/^\/+/, '')
      if (typeof document === 'undefined') return '/' + relative
      const url = new URL(relative, document.baseURI)
      return url.pathname + url.search
    }

    async function request(path, init) {
      const response = await fetch(api(path), Object.assign({ credentials: 'same-origin' }, init || {}))
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        throw new Error((payload && payload.error) || 'HTTP ' + response.status)
      }
      return payload
    }

    async function loadBoard() {
      store.set({ status: store.state.status === 'ready' ? 'ready' : 'loading', error: null })
      try {
        const payload = await request(API + '/board')
        store.set({ status: 'ready', board: payload.board, error: null })
      } catch (error) {
        store.set({ status: 'error', error: String(error.message || error) })
      }
    }

    function applyBoard(payload) {
      if (payload && payload.board) store.set({ status: 'ready', board: payload.board, error: null })
    }

    async function createNote(col, text) {
      const payload = await request(API + '/note', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ col, text }),
      })
      applyBoard(payload)
    }

    async function updateNote(id, text) {
      const payload = await request(API + '/note/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      applyBoard(payload)
    }

    async function deleteNote(id) {
      const payload = await request(API + '/note/' + encodeURIComponent(id), { method: 'DELETE' })
      applyBoard(payload)
      return payload
    }

    async function restoreNote(note) {
      const payload = await request(API + '/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      applyBoard(payload)
    }

    async function moveNote(id, col, index) {
      const payload = await request(API + '/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, col, index }),
      })
      applyBoard(payload)
    }

    /** Persist the floating-ball settings; `patch` wins over the stored values. */
    async function saveUi(patch) {
      const payload = await request(API + '/ui', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      applyBoard(payload)
    }

    // -------------------------------------------------------------- floating ball

    const BALL_SIZE = 56
    const BALL_MARGIN = 18
    const POP_WIDTH = 372
    const POP_GAP = 14
    const ROW_HEIGHT = 166

    /** Keep the ball inside the viewport after a drag or a window resize. */
    function clampBall(x, y) {
      if (typeof window === 'undefined') return { x, y }
      const maxX = Math.max(0, window.innerWidth - BALL_SIZE)
      const maxY = Math.max(0, window.innerHeight - BALL_SIZE)
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY),
      }
    }

    function defaultBall() {
      const width = typeof window === 'undefined' ? 1280 : window.innerWidth
      const height = typeof window === 'undefined' ? 800 : window.innerHeight
      return { x: width - BALL_SIZE - BALL_MARGIN, y: height - BALL_SIZE - BALL_MARGIN }
    }

    /**
     * The ball page: a small popover that shows one column at a time (2×2 cards,
     * wheel scrolls by rows, no scrollbar). Clicking a card opens the same detail
     * dialog the board uses.
     */
    function FloatingBall({ ui, notes, onSetUi }) {
      const [open, setOpen] = useState(false)
      const [detailId, setDetailId] = useState(null)
      const [addCol, setAddCol] = useState(null)
      const [colIndex, setColIndex] = useState(1)
      const [rowOffset, setRowOffset] = useState(0)
      const [pos, setPos] = useState(() => {
        const fallback = defaultBall()
        return {
          x: Number.isFinite(ui.ballX) ? ui.ballX : fallback.x,
          y: Number.isFinite(ui.ballY) ? ui.ballY : fallback.y,
        }
      })
      const dragRef = useRef(null)
      const movedRef = useRef(false)
      const popRef = useRef(null)
      const ballRef = useRef(null)
      // The header's ＋ is a control, not a drag handle: it must keep its click.
      const drag = useDraggable(open, { ref: popRef, resetKey: open, ignoreSelector: '.dsn-nav, .dsn-plus' })

      const col = COLUMNS[colIndex]
      const items = useMemo(
        () => notes.filter((note) => note.col === col.id).sort((a, b) => a.order - b.order),
        [notes, col.id],
      )
      const detailNote = detailId ? notes.find((note) => note.id === detailId) : null
      const rows = Math.max(1, Math.ceil(items.length / 2))
      const maxOffset = Math.max(0, rows - 2)
      // The stored offset may point past the last page after a delete; clamp it
      // for display so the grid never renders empty.
      const offset = Math.min(rowOffset, maxOffset)
      const visible = items.slice(offset * 2, offset * 2 + 4)

      // A stored position that no longer fits (window shrank) snaps back in.
      useEffect(() => {
        const onResize = () => {
          setPos((current) => clampBall(current.x, current.y))
        }
        window.addEventListener('resize', onResize)
        onResize()
        return () => window.removeEventListener('resize', onResize)
      }, [])

      // Wheel scrolls one row at a time and never shows a scrollbar.
      useEffect(() => {
        if (!open) return undefined
        const node = popRef.current
        if (!node) return undefined
        const onWheel = (event) => {
          event.preventDefault()
          const step = event.deltaY > 0 ? 1 : -1
          setRowOffset((current) => Math.min(maxOffset, Math.max(0, current + step)))
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [open, maxOffset])

      // Clicking anywhere outside the popover closes it; clicks inside do not.
      // While the add dialog is up it sits outside the popover, so ignore it.
      useEffect(() => {
        if (!open || addCol) return undefined
        const onDown = (event) => {
          const node = popRef.current
          if (node && node.contains(event.target)) return
          setOpen(false)
        }
        document.addEventListener('mousedown', onDown, true)
        return () => document.removeEventListener('mousedown', onDown, true)
      }, [open, addCol])

      // Esc unwinds one layer at a time: the add dialog first, then the popover.
      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (addCol) {
            setAddCol(null)
            return
          }
          setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open, addCol])

      // Reset the row window whenever the visible column changes.
      useEffect(() => {
        setRowOffset(0)
      }, [colIndex])

      const onPointerDown = useCallback((event) => {
        if (event.button !== 0) return
        movedRef.current = false
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          originX: pos.x,
          originY: pos.y,
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* capture is a nicety, not a requirement */
        }
      }, [pos])

      const onPointerMove = useCallback((event) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true
        setPos(clampBall(drag.originX + dx, drag.originY + dy))
      }, [])

      const onPointerUp = useCallback((event) => {
        const drag = dragRef.current
        dragRef.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* ignore */
        }
        if (!drag) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        const next = clampBall(drag.originX + dx, drag.originY + dy)
        if (movedRef.current) {
          // Dragged: remember the new spot and do not treat it as a click.
          saveUi({ ballX: next.x, ballY: next.y }).catch(() => {})
          if (Math.abs(next.x - drag.originX) > 1 || Math.abs(next.y - drag.originY) > 1) {
            setPos(next)
          }
          return
        }
        setOpen((current) => !current)
      }, [])

      const go = useCallback((delta) => {
        setColIndex((current) => Math.min(COLUMNS.length - 1, Math.max(0, current + delta)))
      }, [])

      /**
       * New notes are appended to the end of their column, so on a long column
       * the note just saved would land on a page the user cannot see. Jump the
       * window to the last page once the server confirms the add.
       */
      const saveNew = useCallback(async (colId, text) => {
        try {
          await createNote(colId, text)
        } catch {
          return
        }
        const count = store.get().board.notes.filter((note) => note.col === colId).length
        setRowOffset(Math.max(0, Math.ceil(count / 2) - 2))
      }, [])

      /** Save an edited note. Returns false when the write failed, so the
       *  dialog can stay in edit mode instead of silently dropping the text. */
      const saveEdit = useCallback(async (id, text) => {
        try {
          await updateNote(id, text)
          return true
        } catch {
          return false
        }
      }, [])

      if (!ui.ballEnabled) return null

      const canLeft = colIndex > 0
      const canRight = colIndex < COLUMNS.length - 1

      // Expand upward by default; flip below when the ball sits in the upper half.
      const popHeight = 400
      const placeAbove = pos.y + BALL_SIZE / 2 > (typeof window === 'undefined' ? 800 : window.innerHeight) / 2
      const top = placeAbove ? Math.max(8, pos.y - POP_GAP - popHeight) : pos.y + BALL_SIZE + POP_GAP
      const left = Math.max(8, Math.min(pos.x + BALL_SIZE - POP_WIDTH, (typeof window === 'undefined' ? 1280 : window.innerWidth) - POP_WIDTH - 8))

      return h(React.Fragment, null,
        open
          ? h('div', Object.assign({
            className: 'dsn-pop',
            style: Object.assign({ left, top }, drag.style),
            onMouseDown: (event) => event.stopPropagation(),
          }, drag.boxProps),
            h('div', Object.assign({ className: 'dsn-pop-head' }, drag.handleProps),
              // Grid `1fr auto 1fr` keeps the ‹ title › group exactly centred
              // while giving the ＋ a real cell: it is aligned by the same
              // `align-items:center` as the arrows, not by a hand-tuned offset.
              h('span', { className: 'dsn-pop-pad', 'aria-hidden': true }),
              h('span', { className: 'dsn-pop-group' },
                h('button', {
                  type: 'button',
                  className: 'dsn-nav' + (canLeft ? '' : ' off'),
                  'aria-label': '上一列',
                  disabled: !canLeft,
                  onClick: () => go(-1),
                }, h('svg', { viewBox: '0 0 12 12' }, h('path', { d: 'M7.5 2.5 4 6l3.5 3.5' }))),
                h('span', { className: 'dsn-pop-title' },
                  h('span', { className: 't' }, col.title),
                  h('span', { className: 'n' }, '(' + items.length + ')'),
                ),
                h('button', {
                  type: 'button',
                  className: 'dsn-nav' + (canRight ? '' : ' off'),
                  'aria-label': '下一列',
                  disabled: !canRight,
                  onClick: () => go(1),
                }, h('svg', { viewBox: '0 0 12 12' }, h('path', { d: 'M4.5 2.5 8 6l-3.5 3.5' }))),
              ),
              // Hidden on an empty column: there the whole blank area is the
              // button, and two identical ＋ on screen would just be a puzzle.
              items.length > 0
                ? h('button', {
                  type: 'button',
                  className: 'dsn-plus',
                  'aria-label': '在「' + col.title + '」添加便签',
                  onClick: () => setAddCol(col.id),
                }, h('svg', { viewBox: '0 0 12 12' }, h('path', { d: 'M6 2.4v7.2M2.4 6h7.2' })))
                : h('span', { className: 'dsn-pop-pad', 'aria-hidden': true }),
            ),
            h('div', { className: 'dsn-pop-grid' },
              visible.length === 0
                ? h('button', {
                  type: 'button',
                  className: 'dsn-pop-empty',
                  'aria-label': '在「' + col.title + '」添加便签',
                  onClick: () => setAddCol(col.id),
                },
                  h('span', { className: 'big' }, h('svg', { viewBox: '0 0 12 12' }, h('path', { d: 'M6 2v8M2 6h8' }))),
                  h('span', { className: 't1' }, '新建便签'),
                  h('span', { className: 't2' }, '这一列还没有便签'),
                )
                : visible.map((note) => h('div', {
                  key: note.id,
                  className: 'dsn-pop-note',
                  title: note.text,
                  onClick: () => {
                    setOpen(false)
                    setDetailId(note.id)
                  },
                },
                  h('div', { className: 'tx' }, note.text),
                  h('i', { className: 'fd' }),
                )),
            ),
            h('div', { className: 'dsn-dots' },
              COLUMNS.map((item, index) => h('i', { key: item.id, className: index === colIndex ? 'on' : '' })),
            ),
          )
          : null,
        // The ball hides while the matrix or the note detail is open: either
        // way the ball itself is not what the user is looking at.
        open || detailNote
          ? null
          : h('div', {
            className: 'dsn-ball',
            ref: ballRef,
            style: { left: pos.x, top: pos.y },
            role: 'button',
            tabIndex: 0,
            'aria-label': '便签悬浮球',
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setOpen(true)
              }
            },
          }, h('span', { className: 'ch' }, '签')),
        detailNote
          ? h(DetailDialog, {
            note: detailNote,
            readOnly: true,
            onClose: () => setDetailId(null),
            onSave: saveEdit,
          })
          : null,
        addCol
          ? h(AddDialog, {
            col: addCol,
            onClose: () => setAddCol(null),
            onSave: saveNew,
          })
          : null,
      )
    }

    // ------------------------------------------------------------ components

    /**
     * Card body. Fits the full text into the fixed card height; when it does
     * not fit, the last three characters give way to three dots ("..."), as
     * agreed in the design doc — not the CSS ellipsis, which keeps the user's
     * last characters and renders a single "…".
     */
    function NoteText({ text }) {
      const ref = useRef(null)
      const [shown, setShown] = useState(text)
      useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const full = String(text || '')
        el.textContent = full
        if (el.scrollHeight <= el.clientHeight) {
          setShown(full)
          return
        }
        let low = 0
        let high = full.length
        let best = 0
        while (low <= high) {
          const mid = (low + high) >> 1
          el.textContent = full.slice(0, mid)
          if (el.scrollHeight <= el.clientHeight) {
            best = mid
            low = mid + 1
          } else {
            high = mid - 1
          }
        }
        el.textContent = ''
        setShown(full.slice(0, Math.max(0, best - 3)) + '...')
      }, [text])
      return h('div', { className: 'dsn-note-text', ref }, shown)
    }

    function PanelIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M3 2.6h7.1L13.4 5.9v7.5H3z' }),
        h('path', { d: 'M10 2.7V6h3.2' }),
      )
    }

    function NoteCard({ note, selected, shaking, dragging, onClick, onDoubleClick, onDelete, onDragStart, onDragEnd }) {
      return h('article', {
        className: [
          'dsn-note',
          selected ? 'selected' : '',
          shaking ? 'shake' : '',
          dragging ? 'dragging' : '',
        ].filter(Boolean).join(' '),
        'data-note-id': note.id,
        draggable: true,
        onClick,
        onDoubleClick,
        onDragStart,
        onDragEnd,
        title: note.text,
      },
        h(NoteText, { text: note.text }),
        h('i', { className: 'dsn-fold' }),
        h('button', {
          type: 'button',
          className: 'dsn-del',
          'aria-label': '删除这张便签',
          onClick: (event) => {
            event.stopPropagation()
            onDelete()
          },
          onDoubleClick: (event) => event.stopPropagation(),
        }),
      )
    }

    function AddDialog({ col, onClose, onSave }) {
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const ref = useRef(null)
      const title = (COLUMNS.find((item) => item.id === col) || {}).title || ''
      const drag = useDraggable(true, { ignoreSelector: '.dsn-x' })

      useEffect(() => {
        if (ref.current) ref.current.focus()
      }, [])

      const submit = useCallback(async () => {
        const value = text.slice(0, MAX_TEXT)
        if (value.trim() === '' || busy) return
        setBusy(true)
        try {
          await onSave(col, value)
          onClose()
        } finally {
          setBusy(false)
        }
      }, [text, busy, col, onSave, onClose])

      return h('div', { className: 'dsn-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', Object.assign({
          className: 'dsn-dialog',
          role: 'dialog',
          'aria-modal': true,
          style: drag.style,
        }, drag.boxProps),
          h('div', Object.assign({ className: 'dsn-dhead' }, drag.handleProps),
            h('div', { className: 'dsn-dtitle' }, '添加便签'),
            h('button', { type: 'button', className: 'dsn-x', 'aria-label': '关闭', onClick: onClose }, '✕'),
          ),
          h('div', { className: 'dsn-dsub' }, '添加到 · ' + title),
          h('textarea', {
            ref,
            className: 'dsn-paper',
            value: text,
            maxLength: MAX_TEXT,
            placeholder: '写点什么…（最多 ' + MAX_TEXT + ' 字）',
            onChange: (event) => setText(event.target.value.slice(0, MAX_TEXT)),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                submit()
              }
            },
          }),
          h('div', { className: 'dsn-foot' },
            h('span', { className: 'dsn-hint' }, 'Ctrl + Enter 保存 · ' + text.length + ' / ' + MAX_TEXT),
            h('div', { className: 'dsn-right' },
              h('button', { type: 'button', className: 'dsn-btn ghost', onClick: onClose }, '取消'),
              h('button', { type: 'button', className: 'dsn-btn primary', disabled: busy, onClick: submit }, '保存'),
            ),
          ),
        ),
      )
    }

    /**
     * Drag a floating box by its header. Both dialogs and the ball popover share
     * this so there is exactly one implementation of the physics.
     *
     * `offset` starts at 0,0 (the box sits where CSS centers/anchors it) and the
     * returned style shifts it from there, clamped so the box cannot leave the
     * viewport. `handleProps` goes on the header; `style` goes on the box.
     */
    function useDraggable(isEnabled, options) {
      const opts = options || {}
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const dragRef = useRef(null)
      // Callers that need the node for their own hit-testing pass their ref in.
      const localRef = useRef(null)
      const boxRef = opts.ref || localRef

      // A reopened popover must sit where it was placed, not where it was dragged.
      const resetKey = opts.resetKey
      useEffect(() => {
        setOffset({ x: 0, y: 0 })
      }, [resetKey])

      const onPointerDown = useCallback((event) => {
        if (!isEnabled || event.button !== 0) return
        // Controls inside the header keep their own click behaviour. Pointer
        // capture would otherwise steal the pointerup and the click with it.
        const ignore = opts.ignoreSelector
        if (ignore && event.target.closest && event.target.closest(ignore)) return
        const box = boxRef.current
        if (!box) return
        const rect = box.getBoundingClientRect()
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          originX: offset.x,
          originY: offset.y,
          rect,
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* capture is a nicety; pointermove still reaches us */
        }
      }, [isEnabled, offset, opts.ignoreSelector])

      const onPointerMove = useCallback((event) => {
        const drag = dragRef.current
        if (!drag) return
        // Keep the box's real edges inside the viewport, whatever its size is.
        const minX = -drag.rect.left
        const maxX = window.innerWidth - drag.rect.right
        const minY = -drag.rect.top
        const maxY = window.innerHeight - drag.rect.bottom
        setOffset({
          x: Math.min(Math.max(minX, drag.originX + (event.clientX - drag.startX)), maxX),
          y: Math.min(Math.max(minY, drag.originY + (event.clientY - drag.startY)), maxY),
        })
      }, [])

      const onPointerUp = useCallback((event) => {
        if (!dragRef.current) return
        dragRef.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* ignore */
        }
      }, [])

      return {
        handleProps: {
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          style: { cursor: isEnabled ? 'move' : 'default', touchAction: 'none' },
        },
        boxProps: { ref: boxRef },
        style: offset.x === 0 && offset.y === 0
          ? undefined
          : { transform: 'translate(' + offset.x + 'px, ' + offset.y + 'px)' },
      }
    }

    /**
     * Note detail. Three shapes share one shell:
     *  - editable (the board's double-click): textarea + 删除 / 字数 / 关闭 / 保存;
     *  - read-only (opened from the floating ball): no footer, × is the only way out;
     *  - read-only that the user turns into an editor with the pencil: textarea +
     *    字数 / 保存 only — no 删除, no 关闭, and **saving returns to the read-only
     *    view instead of closing the dialog**.
     */
    function DetailDialog({ note, onClose, onSave, onDelete, readOnly }) {
      const [text, setText] = useState(note.text)
      const [busy, setBusy] = useState(false)
      // Only meaningful for the read-only variant: the pencil flips it on.
      const [editing, setEditing] = useState(false)
      const ref = useRef(null)
      const colTitle = (COLUMNS.find((item) => item.id === note.col) || {}).title || ''
      const dirty = text !== note.text
      const isEditing = readOnly ? editing : true
      // Controls inside the drag handle must opt out, or pointer capture eats
      // their click (see 4.13 / 7.x): .dsn-x and the pencil are both controls.
      const drag = useDraggable(true, { ignoreSelector: '.dsn-x, .dsn-edit' })

      // A save updates `note` from the store; drop the stale draft so the next
      // pencil click starts from the saved text, and the counter resets.
      useEffect(() => {
        setText(note.text)
      }, [note.text])

      useEffect(() => {
        if (isEditing && ref.current) ref.current.focus()
      }, [isEditing])

      const save = useCallback(async () => {
        const value = text.slice(0, MAX_TEXT)
        if (value.trim() === '' || busy) return
        setBusy(true)
        try {
          const ok = await onSave(note.id, value)
          if (ok === false) return // stay in edit mode; nothing was written
          if (readOnly) setEditing(false)
          else onClose()
        } finally {
          setBusy(false)
        }
      }, [text, busy, note.id, onSave, onClose, readOnly])

      const body = isEditing
        ? h('textarea', {
          ref,
          className: 'dsn-paper',
          value: text,
          maxLength: MAX_TEXT,
          onChange: (event) => setText(event.target.value.slice(0, MAX_TEXT)),
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              // In the ball's dialog Esc leaves edit mode first; the dialog
              // itself is closed with the ×, so a stray Esc never loses text.
              if (readOnly) {
                setText(note.text)
                setEditing(false)
              } else {
                onClose()
              }
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              save()
            }
          },
        })
        : h('div', { className: 'dsn-paper dsn-readonly', tabIndex: 0 }, note.text)

      let footer = null
      if (isEditing) {
        footer = readOnly
          // Ball editor: 字数 on the left, 保存 on the right. No 删除, no 关闭.
          ? h('div', { className: 'dsn-foot' },
            h('span', { className: 'dsn-hint' }, text.length + ' / ' + MAX_TEXT),
            h('div', { className: 'dsn-right' },
              h('button', { type: 'button', className: 'dsn-btn primary', disabled: busy || !dirty, onClick: save }, '保存'),
            ),
          )
          : h('div', { className: 'dsn-foot' },
            h('button', { type: 'button', className: 'dsn-btn danger', onClick: () => { onDelete(note.id); onClose() } }, '删除'),
            h('span', { className: 'dsn-hint', style: { marginLeft: 12 } }, text.length + ' / ' + MAX_TEXT),
            h('div', { className: 'dsn-right' },
              h('button', { type: 'button', className: 'dsn-btn ghost', onClick: onClose }, '关闭'),
              h('button', { type: 'button', className: 'dsn-btn primary', disabled: busy || !dirty, onClick: save }, '保存'),
            ),
          )
      }

      return h('div', { className: 'dsn-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', Object.assign({
          className: 'dsn-dialog',
          role: 'dialog',
          'aria-modal': true,
          style: drag.style,
        }, drag.boxProps),
          h('div', Object.assign({ className: 'dsn-dhead' }, drag.handleProps),
            h('div', { className: 'dsn-dtitle' }, '便签详情'),
            // The pencil only exists on the ball's read-only detail, and it
            // hides while editing (clicking it then would do nothing).
            readOnly && !editing
              ? h('button', {
                type: 'button',
                className: 'dsn-edit',
                'aria-label': '编辑便签',
                title: '编辑',
                onClick: () => setEditing(true),
              }, h('svg', { viewBox: '0 0 12 12' },
                h('path', { d: 'M8.2 1.8 10.2 3.8 4.4 9.6 1.9 10.1 2.4 7.6z' }),
                h('path', { d: 'M7.1 2.9 9.1 4.9' })))
              : null,
            h('button', { type: 'button', className: 'dsn-x', 'aria-label': '关闭', onClick: onClose }, '✕'),
          ),
          h('div', { className: 'dsn-meta' },
            h('span', { className: 'dsn-tag' }, colTitle),
            h('span', { className: 'dsn-time' }, '创建于 ' + formatTime(note.createdAt) + ' · 最后修改 ' + formatTime(note.updatedAt)),
          ),
          body,
          footer,
        ),
      )
    }

    function formatTime(ms) {
      const value = Number(ms)
      if (!Number.isFinite(value) || value <= 0) return '—'
      const date = new Date(value)
      const pad = (n) => String(n).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    // ----------------------------------------------------------------- panel

    function Panel() {
      const state = useSyncExternalStore(subscribeStore, getSnapshot)
      const [addCol, setAddCol] = useState(null)
      const [detailId, setDetailId] = useState(null)
      const [selectedId, setSelectedId] = useState(null)
      const [shakeId, setShakeId] = useState(null)
      const [dragId, setDragId] = useState(null)
      const [drop, setDrop] = useState(null)
      const [toast, setToast] = useState(null)
      const [notice, setNotice] = useState(null)
      const toastTimer = useRef(null)
      const clickTimer = useRef(null)
      const shakeTimer = useRef(null)

      const notes = state.board.notes
      const total = notes.length
      const detailNote = detailId ? notes.find((note) => note.id === detailId) : null

      useEffect(() => {
        loadBoard()
        return () => {
          clearTimeout(toastTimer.current)
          clearTimeout(clickTimer.current)
          clearTimeout(shakeTimer.current)
        }
      }, [])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (addCol) {
            setAddCol(null)
            return
          }
          if (detailId) {
            setDetailId(null)
            return
          }
          setSelectedId(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [detailId, addCol])

      const flash = useCallback((error) => {
        setNotice(error ? '操作失败：' + error : null)
        if (error) setTimeout(() => setNotice(null), 4000)
      }, [])

      const select = useCallback((id) => {
        setSelectedId(id)
        setShakeId(id)
        clearTimeout(shakeTimer.current)
        shakeTimer.current = setTimeout(() => setShakeId(null), SHAKE_MS + 40)
      }, [])

      const onCardClick = useCallback((event, note) => {
        event.stopPropagation()
        clearTimeout(clickTimer.current)
        clickTimer.current = setTimeout(() => select(note.id), CLICK_DELAY)
      }, [select])

      const onCardDoubleClick = useCallback((event, note) => {
        event.stopPropagation()
        clearTimeout(clickTimer.current)
        setSelectedId(null)
        setDetailId(note.id)
      }, [])

      const removeNote = useCallback(async (id) => {
        // Keep our own copy for the undo toast: the board is authoritative, but
        // the payload's `note` is only a convenience and must not be required.
        const snapshot = notes.find((note) => note.id === id) || null
        try {
          const payload = await deleteNote(id)
          setDetailId((current) => (current === id ? null : current))
          setSelectedId((current) => (current === id ? null : current))
          const removed = (payload && payload.note) || snapshot
          if (removed) {
            setToast(removed)
            clearTimeout(toastTimer.current)
            toastTimer.current = setTimeout(() => setToast(null), UNDO_MS)
          }
        } catch (error) {
          flash(String(error.message || error))
        }
      }, [notes, flash])

      const undoDelete = useCallback(async () => {
        if (!toast) return
        clearTimeout(toastTimer.current)
        const note = toast
        setToast(null)
        try {
          await restoreNote(note)
        } catch (error) {
          flash(String(error.message || error))
        }
      }, [toast, flash])

      const saveNew = useCallback(async (col, text) => {
        try {
          await createNote(col, text)
        } catch (error) {
          flash(String(error.message || error))
        }
      }, [flash])

      const saveEdit = useCallback(async (id, text) => {
        try {
          await updateNote(id, text)
        } catch (error) {
          flash(String(error.message || error))
        }
      }, [flash])

      const toggleBall = useCallback(async () => {
        try {
          await saveUi({ ballEnabled: !uiOf(state.board).ballEnabled })
        } catch (error) {
          flash(String(error.message || error))
        }
      }, [state.board.ui, flash])

      // ---- drag & drop

      const onDragStart = useCallback((event, note) => {
        try {
          event.dataTransfer.setData('text/plain', note.id)
          event.dataTransfer.effectAllowed = 'move'
        } catch {
          /* older browsers */
        }
        setDragId(note.id)
        setDrop(null)
      }, [])

      const onDragEnd = useCallback(() => {
        setDragId(null)
        setDrop(null)
      }, [])

      const onColumnDragOver = useCallback((event, col) => {
        event.preventDefault()
        try {
          event.dataTransfer.dropEffect = 'move'
        } catch {
          /* ignore */
        }
        const body = event.currentTarget
        const cards = Array.from(body.querySelectorAll('[data-note-id]'))
        let index = cards.length
        const element = document.elementFromPoint(event.clientX, event.clientY)
        const card = element && element.closest ? element.closest('[data-note-id]') : null
        if (card && body.contains(card)) {
          const at = cards.indexOf(card)
          const rect = card.getBoundingClientRect()
          if (at >= 0) index = event.clientY < rect.top + rect.height / 2 ? at : at + 1
        }
        setDrop({ col, index })
      }, [])

      const onColumnDrop = useCallback(async (event, col) => {
        event.preventDefault()
        const id = dragId
        const target = drop && drop.col === col ? drop.index : 0
        setDragId(null)
        setDrop(null)
        if (!id) return
        const note = notes.find((item) => item.id === id)
        if (!note) return
        let index = target
        if (note.col === col) {
          const source = notes.filter((item) => item.col === col).findIndex((item) => item.id === id)
          if (source >= 0 && target > source) index = target - 1
        }
        if (note.col === col) {
          const source = notes.filter((item) => item.col === col).findIndex((item) => item.id === id)
          if (source === index) return
        }
        try {
          await moveNote(id, col, index)
        } catch (error) {
          flash(String(error.message || error))
        }
      }, [dragId, drop, notes, flash])

      const columns = useMemo(() => COLUMNS.map((col) => ({
        ...col,
        items: notes.filter((note) => note.col === col.id).sort((a, b) => a.order - b.order),
      })), [notes])

      if (state.status === 'error') {
        return h('div', { className: 'dsn-root' },
          h('style', null, CSS),
          h('div', { className: 'dsn-error' }, '便签加载失败：' + state.error),
          h('div', { style: { padding: '0 24px' } },
            h('button', { type: 'button', className: 'dsn-btn ghost', onClick: loadBoard }, '重试'),
          ),
        )
      }

      return h('div', { className: 'dsn-root', 'data-dsh-plugin': PANEL_ID },
        h('style', null, CSS),
        h('div', { className: 'dsn-head' },
          h('span', { className: 'dsn-title' }, '便签'),
          h('span', { className: 'dsn-count' }, total + ' 张'),
          h('span', {
            className: 'dsn-sw' + (uiOf(state.board).ballEnabled ? ' on' : ''),
            role: 'switch',
            tabIndex: 0,
            'aria-checked': uiOf(state.board).ballEnabled ? 'true' : 'false',
            'aria-label': '悬浮球',
            onClick: (event) => {
              event.stopPropagation()
              toggleBall()
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggleBall()
              }
            },
          },
            h('span', { className: 'dsn-sw-track' }),
            h('span', { className: 'dsn-sw-label' }, '悬浮球'),
          ),
        ),
        h('div', { className: 'dsn-board', onClick: () => setSelectedId(null) },
          columns.map((col) => {
            const items = col.items
            const showSlot = dragId && drop && drop.col === col.id
            const slotIndex = showSlot ? drop.index : -1
            const children = []
            items.forEach((note, index) => {
              if (showSlot && index === slotIndex) children.push(h('div', { key: 'slot-' + index, className: 'dsn-slot' }))
              children.push(h(NoteCard, {
                key: note.id,
                note,
                selected: selectedId === note.id,
                shaking: shakeId === note.id,
                dragging: dragId === note.id,
                onClick: (event) => onCardClick(event, note),
                onDoubleClick: (event) => onCardDoubleClick(event, note),
                onDelete: () => removeNote(note.id),
                onDragStart: (event) => onDragStart(event, note),
                onDragEnd,
              }))
            })
            if (showSlot && slotIndex >= items.length) children.push(h('div', { key: 'slot-end', className: 'dsn-slot' }))

            return h('section', {
              key: col.id,
              className: 'dsn-col' + (dragId && drop && drop.col === col.id ? ' drop' : ''),
            },
              h('div', { className: 'dsn-col-head' },
                h('span', { className: 'dsn-col-title' }, col.title),
                h('span', { className: 'dsn-col-n' }, '(' + items.length + ')'),
                h('button', {
                  type: 'button',
                  className: 'dsn-add',
                  'aria-label': '在「' + col.title + '」添加便签',
                  onClick: (event) => {
                    event.stopPropagation()
                    setAddCol(col.id)
                  },
                }, h('svg', { viewBox: '0 0 10 10' }, h('path', { d: 'M5 1v8M1 5h8' }))),
              ),
              h('div', {
                className: 'dsn-col-body',
                onDragOver: (event) => onColumnDragOver(event, col.id),
                onDrop: (event) => onColumnDrop(event, col.id),
                onDragLeave: (event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setDrop((current) => (current && current.col === col.id ? null : current))
                  }
                },
              },
                items.length === 0 && !showSlot
                  ? h('div', { className: 'dsn-empty' }, '　')
                  : h('div', { className: 'dsn-notes' }, children),
              ),
            )
          }),
        ),
        notice ? h('div', { className: 'dsn-toast' }, notice) : null,
        toast ? h('div', { className: 'dsn-toast' },
          h('span', null, '已删除 1 张便签'),
          h('button', { type: 'button', className: 'dsn-undo', onClick: undoDelete }, '撤销'),
        ) : null,
        addCol ? h(AddDialog, {
          col: addCol,
          onClose: () => setAddCol(null),
          onSave: saveNew,
        }) : null,
        detailNote ? h(DetailDialog, {
          note: detailNote,
          onClose: () => setDetailId(null),
          onSave: saveEdit,
          onDelete: removeNote,
        }) : null,
      )
    }

    // ------------------------------------------------------ global ball overlay

    /**
     * Frame-wide host for the floating ball. Registered into `shell.overlay` so
     * the ball keeps floating on every page, not only on the sticky-note board.
     * It owns the board snapshot and drives the same routes the board uses.
     */
    function BallOverlay() {
      const state = useSyncExternalStore(subscribeStore, getSnapshot)

      useEffect(() => {
        if (store.get().status === 'loading') loadBoard()
      }, [])

      const notes = state.board.notes
      const ui = uiOf(state.board)

      const setUi = useCallback(async (patch) => {
        try {
          await saveUi(patch)
        } catch {
          /* the ball is decoration; a failed save must not break the page */
        }
      }, [])

      if (state.status !== 'ready' || !ui.ballEnabled) return null

      return h(React.Fragment, null,
        h('style', null, CSS),
        h(FloatingBall, {
          ui,
          notes,
          onSetUi: setUi,
        }),
      )
    }

    // ----------------------------------------------------------- registration

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: PANEL_ORDER,
          label: '便签',
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Panel))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: PANEL_ID + '-ball',
          order: 50,
        }, BallOverlay))
      },
    }
  },
})
