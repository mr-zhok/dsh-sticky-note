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
.dsn-dsub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:4px 0 14px}
.dsn-paper{display:block;width:100%;height:338px;box-sizing:border-box;background:#FFF7BC;border:1px solid #E4D089;border-radius:3px;padding:12px 14px;color:#4A4433;font-size:13px;line-height:22px;font-family:inherit;resize:none;outline:none;white-space:pre-wrap}
.dsn-paper::placeholder{color:#9D9166}
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
`

    // ---------------------------------------------------------------- store

    const store = {
      state: { status: 'loading', board: { version: 1, updatedAt: 0, notes: [] }, error: null },
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
        h('div', { className: 'dsn-dialog', role: 'dialog', 'aria-modal': true },
          h('div', { className: 'dsn-dhead' },
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

    function DetailDialog({ note, onClose, onSave, onDelete }) {
      const [text, setText] = useState(note.text)
      const [busy, setBusy] = useState(false)
      const ref = useRef(null)
      const colTitle = (COLUMNS.find((item) => item.id === note.col) || {}).title || ''
      const dirty = text !== note.text

      useEffect(() => {
        if (ref.current) ref.current.focus()
      }, [])

      const save = useCallback(async () => {
        const value = text.slice(0, MAX_TEXT)
        if (value.trim() === '' || busy) return
        setBusy(true)
        try {
          await onSave(note.id, value)
          onClose()
        } finally {
          setBusy(false)
        }
      }, [text, busy, note.id, onSave, onClose])

      return h('div', { className: 'dsn-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'dsn-dialog', role: 'dialog', 'aria-modal': true },
          h('div', { className: 'dsn-dhead' },
            h('div', { className: 'dsn-dtitle' }, '便签详情'),
            h('button', { type: 'button', className: 'dsn-x', 'aria-label': '关闭', onClick: onClose }, '✕'),
          ),
          h('div', { className: 'dsn-meta' },
            h('span', { className: 'dsn-tag' }, colTitle),
            h('span', { className: 'dsn-time' }, '创建于 ' + formatTime(note.createdAt) + ' · 最后修改 ' + formatTime(note.updatedAt)),
          ),
          h('textarea', {
            ref,
            className: 'dsn-paper',
            value: text,
            maxLength: MAX_TEXT,
            onChange: (event) => setText(event.target.value.slice(0, MAX_TEXT)),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                save()
              }
            },
          }),
          h('div', { className: 'dsn-foot' },
            h('button', { type: 'button', className: 'dsn-btn danger', onClick: () => { onDelete(note.id); onClose() } }, '删除'),
            h('span', { className: 'dsn-hint', style: { marginLeft: 12 } }, text.length + ' / ' + MAX_TEXT),
            h('div', { className: 'dsn-right' },
              h('button', { type: 'button', className: 'dsn-btn ghost', onClick: onClose }, '关闭'),
              h('button', { type: 'button', className: 'dsn-btn primary', disabled: busy || !dirty, onClick: save }, '保存'),
            ),
          ),
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
      },
    }
  },
})
