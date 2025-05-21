const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getTasks: (projectId) => ipcRenderer.invoke('get-tasks', projectId)
});