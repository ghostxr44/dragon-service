const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizeChange: (callback) => {
    ipcRenderer.on('maximize-change', (_, isMaximized) => callback(isMaximized));
  },
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  getPathForFile: (file) => {
    try {
      return webUtils ? webUtils.getPathForFile(file) : (file.path || '');
    } catch(e) {
      return file.path || '';
    }
  }
});
