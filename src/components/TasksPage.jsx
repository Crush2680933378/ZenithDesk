import { useState } from 'react'
import { normLang, t } from '../i18n.js'

/** 自动化任务：定时让助手做某件事（顾客侧只负责定义与开关） */
export default function TasksPage({ tasks, onChange, lang: langProp }) {
  const lang = normLang(langProp)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('每天 09:00')
  const [prompt, setPrompt] = useState('')

  const add = () => {
    if (!name.trim() || !prompt.trim()) return
    onChange([
      ...tasks,
      {
        id: `t${Date.now()}`,
        name: name.trim(),
        schedule: schedule.trim() || '每天 09:00',
        prompt: prompt.trim(),
        enabled: true,
      },
    ])
    setName('')
    setPrompt('')
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t(lang, '自动化任务', 'Automation')}</h2>
        <span className="page-sub">
          {t(lang, `${tasks.filter((x) => x.enabled).length} 个运行中`, `${tasks.filter((x) => x.enabled).length} active`)}
        </span>
      </div>

      <div className="page-list">
        {tasks.map((task) => (
          <div key={task.id} className="card">
            <div className="card-main">
              <div className="card-title">
                {task.name}
                <span className="card-ver">{task.schedule}</span>
              </div>
              <div className="card-desc">{task.prompt}</div>
            </div>
            <button
              className={`switch-pill ${task.enabled ? 'on' : ''}`}
              onClick={() =>
                onChange(tasks.map((x) => (x.id === task.id ? { ...x, enabled: !x.enabled } : x)))
              }
            >
              {task.enabled ? t(lang, '运行中', 'on') : t(lang, '已暂停', 'paused')}
            </button>
            <button
              className="card-del"
              title={t(lang, '删除', 'delete')}
              onClick={() => onChange(tasks.filter((x) => x.id !== task.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="task-new">
        <div className="dsh-section">{t(lang, '新建任务', 'New task')}</div>
        <div className="task-form">
          <input
            className="input"
            placeholder={t(lang, '任务名称', 'task name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            placeholder={t(lang, '频率，如 每天 09:00', 'schedule, e.g. daily 09:00')}
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
        </div>
        <textarea
          className="input task-prompt"
          rows={2}
          placeholder={t(lang, '到点让助手做什么…', 'what should the assistant do…')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="task-actions">
          <button className="btn btn-primary" onClick={add}>
            {t(lang, '创建任务', 'Create')}
          </button>
        </div>
      </div>
    </div>
  )
}
