import { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel.jsx'
import SessionList from './components/SessionList.jsx'
import PluginsPage from './components/PluginsPage.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
import TasksPage from './components/TasksPage.jsx'
import TracePanel from './components/TracePanel.jsx'
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
  const [page, setPage] = useState('chat') // chat | trace | plugins | tasks
  const [ui, setUi] = useState({ workspaces: [], plugins: [], tasks: [] })
  const [showSettings, setShowSettings] = useState(false)

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

      const u = await api.uiState()
      if (!cancelled && u) setUi(u)

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

  const patchUi = async (patch) => {
    const next = await api.uiSet(patch)
    if (next) setUi(next)
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
    window.__zenithSetView = setPage
    window.__zenithOpenSettings = () => setShowSettings(true)
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
      <aside className="sidebar dsh">
        <div className="dsh-brand">
          <span className="dsh-brand-mark">天顶</span>
          <span className="dsh-brand-badge">ZENITHDESK</span>
        </div>

        <button className="dsh-new" onClick={createSession}>
          <span className="dsh-new-plus">＋</span>
          {t(lang, '新会话', 'New session')}
        </button>

        <nav className="dsh-nav">
          <button
            className={`dsh-nav-item ${page === 'chat' || page === 'trace' ? 'active' : ''}`}
            onClick={() => setPage('chat')}
          >
            {t(lang, '对话', 'Conversations')}
            <span className="tab-count" style={{ marginLeft: 'auto' }}>{sessions.length}</span>
          </button>
          <button
            className={`dsh-nav-item ${page === 'plugins' ? 'active' : ''}`}
            onClick={() => setPage('plugins')}
          >
            {t(lang, '插件', 'Plugins')}
            <span className="tab-count" style={{ marginLeft: 'auto' }}>
              {ui.plugins?.filter((p) => p.enabled).length || 0}
            </span>
          </button>
          <button
            className={`dsh-nav-item ${page === 'tasks' ? 'active' : ''}`}
            onClick={() => setPage('tasks')}
          >
            {t(lang, '自动化任务', 'Automation')}
            <span className="tab-count" style={{ marginLeft: 'auto' }}>
              {ui.tasks?.filter((x) => x.enabled).length || 0}
            </span>
          </button>
        </nav>

        <div className="dsh-workspace">
          <div className="dsh-section">
            {ui.workspaces?.find((w) => w.id === ui.activeWorkspace)?.name ||
              t(lang, '工作区', 'Workspace')}
          </div>
          <SessionList
            sessions={sessions}
            activeId={activeId}
            onSelect={(id) => {
              selectSession(id)
              setPage('chat')
            }}
            onCreate={createSession}
            onDelete={deleteSession}
            onRename={renameSession}
            lang={lang}
          />
        </div>

        <div className="dsh-sidebar-foot">
          <button className="dsh-nav-item" onClick={() => setShowSettings(true)}>
            ⚙ {t(lang, '设置', 'Settings')}
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="dsh-head">
          <span className="dsh-title" title={activeTitle}>
            {page === 'plugins'
              ? t(lang, '插件', 'Plugins')
              : page === 'tasks'
                ? t(lang, '自动化任务', 'Automation')
                : activeTitle}
          </span>

          <span className={`dsh-pill ${connected ? 'dsh-pill-ok' : ''}`}>
            {connected ? t(lang, '已连接', 'online') : t(lang, '未连接', 'offline')}
          </span>

          {(page === 'chat' || page === 'trace') && (
            <div className="dsh-tabs">
              <button
                className={`dsh-tab ${page === 'chat' ? 'active' : ''}`}
                onClick={() => setPage('chat')}
              >
                {t(lang, '对话', 'Chat')}
              </button>
              <button
                className={`dsh-tab ${page === 'trace' ? 'active' : ''}`}
                onClick={() => setPage('trace')}
              >
                {t(lang, '轨迹', 'Trace')}
              </button>
            </div>
          )}
        </div>

        {page === 'plugins' ? (
          <PluginsPage
            plugins={ui.plugins || []}
            lang={lang}
            onToggle={(id, enabled) =>
              patchUi({
                plugins: (ui.plugins || []).map((p) => (p.id === id ? { ...p, enabled } : p)),
              })
            }
          />
        ) : page === 'tasks' ? (
          <TasksPage tasks={ui.tasks || []} onChange={(tasks) => patchUi({ tasks })} lang={lang} />
        ) : page === 'trace' ? (
          <TracePanel messages={messages} lang={lang} />
        ) : (
          <ChatPanel
            messages={messages}
            streamingId={streamingId}
            onSend={send}
            onCancel={cancel}
            disabled={!connected}
            lang={lang}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
      </main>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
          connected={connected}
          connError={connError}
        />
      )}
    </div>
  )
}