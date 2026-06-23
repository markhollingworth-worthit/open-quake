'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('openQuakePanel', {
  launch(action) { ipcRenderer.send('launch', action); },
  volume(value) { ipcRenderer.send('volume', value); },
  switchGrid(id) { ipcRenderer.send('switchGrid', id); },
  toggleRotation() { ipcRenderer.send('toggleRotation'); },
  openExternal(url) { ipcRenderer.send('openExternal', url); },
  introDone() { ipcRenderer.send('introDone'); },
  onGrid(callback) { return on('grid', callback); },
  onGridList(callback) { return on('gridList', callback); },
  onRotation(callback) { return on('rotation', callback); },
  onIntro(callback) { return on('intro', callback); },
  onTouch(callback) { return on('touch', callback); },
  onKnob(callback) { return on('knob', callback); },
});
