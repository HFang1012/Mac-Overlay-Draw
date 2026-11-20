const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scrawl', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args)),
});
