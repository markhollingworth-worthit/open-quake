'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('openQuakeConfig', {
  getConfig() { return ipcRenderer.invoke('getConfig'); },
  getApps() { return ipcRenderer.invoke('getApps'); },
  saveConfig(config) { ipcRenderer.send('saveConfigFromEditor', config); },
  pickProgram() { return ipcRenderer.invoke('pickProgram'); },
  pickImage() { return ipcRenderer.invoke('pickImage'); },
  getAppIcon(value) { return ipcRenderer.invoke('getAppIcon', value); },
  fetchIconUrl(url) { return ipcRenderer.invoke('fetchIconUrl', url); },
  getLighting() { return ipcRenderer.invoke('getLighting'); },
  setLighting(lighting) { ipcRenderer.send('setLighting', lighting); },
  saveLightingToDevice() { return ipcRenderer.invoke('saveLightingToDevice'); },
  pathToFileURL(filePath) {
    try { return pathToFileURL(filePath).href; }
    catch (e) { return ''; }
  },
});
