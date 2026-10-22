// 渲染进程唯一的对外通道（contextIsolation 下只暴露这里列出的方法）
const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, cb) {
  const handler = (_event, data) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

contextBridge.exposeInMainWorld('zenith', {
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),

  // 只读接口
  models: (baseUrl) => ipcRenderer.invoke('api:models', baseUrl),
  status: (baseUrl) => ipcRenderer.invoke('api:status', baseUrl),
  metrics: (baseUrl) => ipcRenderer.invoke('api:metrics', baseUrl),

  // 会话历史（多会话 + 落盘，主进程持有存储）
  sessionsState: () => ipcRenderer.invoke('sessions:state'),
  sessionsGet: (id) => ipcRenderer.invoke('sessions:get', id),
  sessionsCreate: (title) => ipcRenderer.invoke('sessions:create', title),
  sessionsActivate: (id) => ipcRenderer.invoke('sessions:activate', id),
  sessionsRename: (id, title) => ipcRenderer.invoke('sessions:rename', { id, title }),
  sessionsSave: (payload) => ipcRenderer.invoke('sessions:save', payload),
  sessionsDelete: (id) => ipcRenderer.invoke('sessions:delete', id),

  // 本地引擎（把 Zenith 网关作为子进程拉起）
  gatewayStart: (cfg) => ipcRenderer.invoke('gateway:start', cfg),
  gatewayStop: () => ipcRenderer.invoke('gateway:stop'),
  gatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  gatewayPreview: () => ipcRenderer.invoke('gateway:preview'),
  gatewayReclaim: () => ipcRenderer.invoke('gateway:reclaim'),

  // GPU 状态（nvidia-smi；不可用则 available:false）
  gpu: () => ipcRenderer.invoke('sys:gpu'),

  // 选文件/目录
  pick: (kind) => ipcRenderer.invoke('dialog:pick', { kind }),

  // 流式对话
  chat: (payload) => ipcRenderer.invoke('chat:start', payload),
  cancel: (id) => ipcRenderer.invoke('chat:cancel', id),
  onChunk: (cb) => subscribe('chat:chunk', cb),
  onDone: (cb) => subscribe('chat:done', cb),
  onError: (cb) => subscribe('chat:error', cb),

  // 环境信息（界面底部显示）
  versions: () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
})
