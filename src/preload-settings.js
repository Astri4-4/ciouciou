'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ciouciouSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  test: (values) => ipcRenderer.invoke('settings:test', values),
  save: (values) => ipcRenderer.invoke('settings:save', values),
});
