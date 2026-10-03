'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ciouciou', {
  onSnapshot: (callback) => ipcRenderer.on('snapshot', (_e, snapshot) => callback(snapshot)),
  setInteractive: (on) => ipcRenderer.send('island:interactive', on),
  setTheme: (theme) => ipcRenderer.send('theme:set', theme),
  onTheme: (callback) => ipcRenderer.on('theme', (_e, theme) => callback(theme)),
  open: (id) => ipcRenderer.send('open', id),
  refresh: () => ipcRenderer.send('refresh'),
  onEvent: (callback) => ipcRenderer.on('event', (_e, event) => callback(event)),
  onPosition: (callback) => ipcRenderer.on('island:position', (_e, position) => callback(position)),
  n8n: {
    run: (id) => ipcRenderer.invoke('n8n:run', id),
    edit: (id) => ipcRenderer.send('n8n:edit', id),
    openExecution: (workflowId, id) => ipcRenderer.send('n8n:execution', { workflowId, id }),
  },
  chat: {
    setOpen: (open) => ipcRenderer.send('chat:mode', open),
    onOpen: (callback) => ipcRenderer.on('chat:open', (_e, open) => callback(open)),
    models: () => ipcRenderer.invoke('chat:models'),
    send: (id, model, messages) => ipcRenderer.send('chat:send', { id, model, messages }),
    stop: () => ipcRenderer.send('chat:stop'),
    onDelta: (callback) => ipcRenderer.on('chat:delta', (_e, msg) => callback(msg)),
    onDone: (callback) => ipcRenderer.on('chat:done', (_e, msg) => callback(msg)),
    onError: (callback) => ipcRenderer.on('chat:error', (_e, msg) => callback(msg)),
  },
});
