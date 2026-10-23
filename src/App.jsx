import { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel.jsx'
import ModelView from './components/ModelView.jsx'
import SessionList from './components/SessionList.jsx'
import StatusPanel from './components/StatusPanel.jsx'
import { parseMetrics } from './metrics.js'
import { normLang, t } from './i18n.js'

const api = window.zenith

/// 落盘/比对只关心这些稳定字段（pending 之类的瞬时态不入库）
const stable = (list) =>
  list
    .filter((m) => m && m.role)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content || '',
      reasoning: m.reasoning || '',
      meta: m.meta || null,
      error: m.error || null,
    }))

const snapshotOf = (list) => JSON.stringify(stable(list))

export default function App() {
  const [booted, setBooted] = useState(false)
  const [settings, setSettings] = useState(null)
  const [urlDraft, setUrlDraft] = useState('')
  const [models, setModels] = useState([])
  const [status, setStatus] = useState(null)
  const [metrics, setMetrics] = useState({})
  const [gpu, setGpu] = useState({ available: false })
  const [connError, setConnError] = useState('')

  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [streamingId, setStreamingId] = useState(null)
  const [tab, setTab] = useState('sessions') // 侧栏：sessions | status
  const [view, setView] = useState('chat')    // 主区：chat | model

  const currentRef = useRef(null)
  const loadedRef = useRef({ id: null, snapshot: '[]' })
  const sessionsRef = useRef([])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const lang = normLang(settings?.termLang)
  const baseUrl = settings?.baseUrl || ''
  const connected = !connError && !!status

  /* ---------- 启动：设置 + 会话 ---------- */
  const applyState = useCallback((state, id) => {
    if (state?.sessions) setSessions(state.sessions)
    if (id !== undefined) setActiveId(id)
  }, [])

  const loadMessages = useCallback((id, list) => {
    const next = list || []
    setMessages(next)
    loadedRef.current = { id, snapshot: snapshotOf(next) }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await api.getSettings()
      if (cancelled) return
      setSettings(s)
      setUrlDraft(s.baseUrl)

      const st = await api.sessionsState()
      if (cancelled) return

      if (!st.sessions || st.sessions.length === 0) {
        const created = await api.sessionsCreate()
        if (cancelled) return
        applyState(created.state, created.session.id)
        loadMessages(created.session.id, created.session.messages)
      } else {
        applyState(st)
        const id = st.activeId || st.sessions[0].id
        const full = await api.sessionsGet(id)
        if (cancelled) return
        setActiveId(id)
        loadMessages(id, full?.messages)
        api.sessionsActivate(id).then((next) => applyState(next))
      }
      setBooted(true)
    })()
    return () => {
      cancelled = true
    }
  }, [applyState, loadMessages])

  /* ---------- 网关轮询 ---------- */
  const refresh = useCallback(async (url) => {
    if (!url) return
    try {
      const [m, st, mt, g] = await Promise.all([
        api.models(url),
        api.status(url),
        api.metrics(url),
        api.gpu().catch(() => ({ available: false })),
      ])
      setModels(m.data || [])
      setStatus(st)
      setMetrics(parseMetrics(mt))
      setGpu(g || { available: false })
      setConnError('')
    } catch (e) {
      setConnError(String(e?.message || e))
    }
  }, [])

  useEffect(() => {
    if (!baseUrl) return
    refresh(baseUrl)
    const timer = setInterval(() => refresh(baseUrl), 3000)
    return () => clearInterval(timer)
  }, [baseUrl, refresh])

  /* ---------- 流式事件 ---------- */
  useEffect(() => {
    const offChunk = api.onChunk(({ id, kind, text }) => {
      const field = kind === 'reasoning' ? 'reasoning' : 'content'
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, [field]: (m[field] || '') + text } : m)),
      )
    })

    const offDone = api.onDone(({ id, usage, finishReason }) => {
      const elapsed =
        currentRef.current?.id === id ? Date.now() - currentRef.current.startedAt : 0
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                pending: false,
                meta: {
                  model: m.model || settings?.model || '—',
                  prompt: usage?.prompt_tokens ?? 0,
                  completion: usage?.completion_tokens ?? 0,
                  finish: finishReason || 'stop',
                  elapsed,
                },
              }
            : m,
        ),
      )
      setStreamingId((cur) => (cur === id ? null : cur))
    })

    const offError = api.onError(({ id, message }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, pending: false, error: message } : m)),
      )
      setStreamingId((cur) => (cur === id ? null : cur))
    })

    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [settings?.model])

  /* ---------- 历史落盘（防抖 + 有变化才写） ---------- */
  useEffect(() => {
    if (!booted || !activeId || streamingId) return
    const snap = snapshotOf(messages)
    if (snap === loadedRef.current.snapshot) return

    const timer = setTimeout(async () => {
      const firstUser = messages.find((m) => m.role === 'user')
      const cur = sessionsRef.current.find((s) => s.id === activeId)
      const needAutoTitle = (!cur?.title || cur.title === '新会话') && firstUser
      const res = await api.sessionsSave({
        id: activeId,
        title: needAutoTitle ? firstUser.content.slice(0, 24) : undefined,
        model: settings?.model || '',
        messages,
      })
      loadedRef.current = { id: activeId, snapshot: snap }
      if (res?.state) applyState(res.state)
    }, 500)

    return () => clearTimeout(timer)
  }, [messages, activeId, booted, streamingId, settings?.model, applyState])

  /* ---------- 动作 ---------- */
  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    setUrlDraft(next.baseUrl)
    await api.setSettings(next)
    refresh(next.baseUrl)
  }

  const selectSession = async (id) => {
    if (id === activeId) return
    if (streamingId) api.cancel(streamingId)
    const full = await api.sessionsGet(id)
    setActiveId(id)
    loadMessages(id, full?.messages)
    const next = await api.sessionsActivate(id)
    applyState(next, id)
  }

  const createSession = async () => {
    if (streamingId) api.cancel(streamingId)
    const created = await api.sessionsCreate()
    applyState(created.state, created.session.id)
    loadMessages(created.session.id, [])
    setTab('sessions')
  }

  const deleteSession = async (id) => {
    const cur = sessionsRef.current.find((s) => s.id === id)
    if (!window.confirm(`删除会话「${cur?.title || '未命名'}」？历史不可恢复。`)) return
    if (streamingId) api.cancel(streamingId)
    const next = await api.sessionsDelete(id)
    applyState(next)
    if (id === activeId) {
      const nid = next.activeId || next.sessions[0]?.id || null
      if (nid) {
        const full = await api.sessionsGet(nid)
        setActiveId(nid)
        loadMessages(nid, full?.messages)
      } else {
        setActiveId(null)
        loadMessages(null, [])
      }
    }
  }

  const renameSession = async (id, title) => {
    const next = await api.sessionsRename(id, title)
    applyState(next)
  }

  const send = async (text) => {
    if (!settings) return
    if (!activeId) {
      const created = await api.sessionsCreate()
      applyState(created.state, created.session.id)
      setActiveId(created.session.id)
      loadMessages(created.session.id, [])
    }

    const id = crypto.randomUUID()
    const model = settings.model || models[0]?.id || ''
    const history = stable(messages)
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }))

    setMessages((prev) => [
      ...prev,
      { id: `${id}-u`, role: 'user', content: text },
      { id, role: 'assistant', content: '', reasoning: '', pending: true, model },
    ])
    setStreamingId(id)
    currentRef.current = { id, startedAt: Date.now() }

    const body = {
      model: model || undefined,
      messages: [...history, { role: 'user', content: text }],
      stream: true,
      temperature: Number(settings.temperature),

      thinking: Number(settings.thinking),
    }
    // >0 才限制；0 = 不限制（不传该字段，由后端跑到 EOS / 上下文满）
    if (Number(settings.maxTokens) > 0) body.max_tokens = Number(settings.maxTokens)
    if (settings.systemPrompt?.trim()) {
      body.messages.unshift({ role: 'system', content: settings.systemPrompt.trim() })
    }

    try {
      await api.chat({ id, baseUrl, body })
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, pending: false, error: String(e) } : m)),
      )
      setStreamingId(null)
    }
  }

  const cancel = () => {
    if (streamingId) api.cancel(streamingId)
  }

  // 冒烟/自动化钩子：让主进程能驱动真实发送与新建会话（仅测试用）
  useEffect(() => {
    window.__zenithDemo = send
    window.__zenithNewSession = createSession
    window.__zenithSetTab = setTab
    window.__zenithSetView = setView
    window.__zenithStartEngine = async () => {
      const r = await api.gatewayStart()
      if (r?.ok) {
        await new Promise((res) => setTimeout(res, 800))
        await refresh(settings?.baseUrl)
      }
      return r
    }
    return () => {
      delete window.__zenithDemo
      delete window.__zenithNewSession
    }
  }, [send])

  if (!settings || !booted) {
    return <div className="boot">载入界面…</div>
  }

  const versions = api.versions ? api.versions() : {}
  const activeTitle = sessions.find((s) => s.id === activeId)?.title || '新会话'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">天顶</span>
          <span className="brand-name">ZenithDesk</span>
        </div>

        <div className="conn">
          <input
            className="input input-url"
            value={urlDraft}
            spellCheck={false}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveSettings({ baseUrl: urlDraft })}
            placeholder="http://127.0.0.1:8090"
          />
          <button className="btn" onClick={() => saveSettings({ baseUrl: urlDraft })}>
            {t(lang, '连接', 'Connect')}
          </button>
          <span className={`badge ${connected ? 'badge-ok' : 'badge-bad'}`}>
            {connected
              ? t(lang, '已连接', 'online')
              : connError
                ? t(lang, '连接失败', 'offline')
                : t(lang, '未连接', 'not connected')}
          </span>
        </div>

        <div className="controls" />
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="tabs">
            <button
              className={`tab ${tab === 'sessions' ? 'active' : ''}`}
              onClick={() => setTab('sessions')}
            >
              {t(lang, '会话', 'sessions')} <span className="tab-count">{sessions.length}</span>
            </button>

            <button
              className={`tab ${tab === 'status' ? 'active' : ''}`}
              onClick={() => setTab('status')}
            >
              {t(lang, '状态', 'status')}
            </button>
          </div>

          {tab === 'sessions' ? (
            <SessionList
              sessions={sessions}
              activeId={activeId}
              onSelect={selectSession}
              onCreate={createSession}
              onDelete={deleteSession}
              onRename={renameSession}
              lang={lang}
            />
          ) : (
            <>
              {connError && <div className="alert">{connError}</div>}
              <StatusPanel
                status={status}
                metrics={metrics}
                models={models}
                connected={connected}
                lang={lang}
              />
            </>
          )}
        </aside>

        <main className="main">
          <div className="view-bar">
            <button className={`vtab ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
              {t(lang, '对话', 'chat')}
            </button>
            <button className={`vtab ${view === 'model' ? 'active' : ''}`} onClick={() => setView('model')}>
              {t(lang, '模型运行', 'model runtime')}
            </button>
            {view === 'chat' && (
              <>
                <span className="chat-title" title={activeTitle}>
                  {activeTitle}
                </span>
                <span className="chat-sub">
                  {t(lang, `${stable(messages).length} 条消息 · 自动落盘`, `${stable(messages).length} messages · autosaved`)}
                </span>
              </>
            )}
          </div>
          {view === 'chat' ? (
            <ChatPanel
              messages={messages}
              streamingId={streamingId}
              onSend={send}
              onCancel={cancel}
              disabled={!connected}
              lang={lang}
              models={models}
              settings={settings}
              onSave={saveSettings}
              status={status}
              metrics={metrics}
              gpu={gpu}
            />
          ) : (
            <ModelView settings={settings} onSave={saveSettings} onStarted={() => refresh(settings.baseUrl)} />
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>Electron {versions.electron || '?'}</span>
        <span>Chromium {versions.chrome || '?'}</span>
        <span>Node {versions.node || '?'}</span>
        <span className="spacer" />
        <span>{baseUrl || t(lang, '未设置网关', 'no gateway')}</span>
      </footer>
    </div>
  )
}
