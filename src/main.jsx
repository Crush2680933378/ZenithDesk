import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root'))

/**
 * 直接 npm run dev 用浏览器打开时没有 Electron 的 preload，
 * window.zenith 不存在 —— 与其白屏/卡在"载入界面"，不如说清楚怎么开。
 */
function NoBridgeNotice() {
  return (
    <div className="boot">
      <div style={{ maxWidth: 520, textAlign: 'left', lineHeight: 1.8 }}>
        <h2 style={{ margin: '0 0 12px', color: '#e6edf3' }}>这个页面需要 Electron 外壳</h2>
        <p style={{ margin: '0 0 12px' }}>
          ZenithDesk 的界面通过 <code>window.zenith</code>（preload 桥）访问网关与本地历史，
          浏览器里没有这个对象。
        </p>
        <p style={{ margin: '0 0 12px' }}>开发时请用一条命令启动（Vite 热更新 + Electron 窗口）：</p>
        <pre
          style={{
            background: '#0b0f14',
            border: '1px solid #232b36',
            borderRadius: 6,
            padding: '10px 12px',
            margin: 0,
          }}
        >
          npm run dev:app
        </pre>
        <p style={{ margin: '12px 0 0', color: '#8b949e', fontSize: 12 }}>
          只想看静态页面：<code>npm run start</code>（先构建再开 Electron）。
        </p>
      </div>
    </div>
  )
}

root.render(
  <React.StrictMode>{window.zenith ? <App /> : <NoBridgeNotice />}</React.StrictMode>,
)
