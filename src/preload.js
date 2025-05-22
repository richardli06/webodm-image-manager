const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getTasks: (projectId) => ipcRenderer.invoke('get-tasks', projectId),
  deleteProject: (projectId) => ipcRenderer.invoke('delete-project', projectId),
  renameProject: (projectId, newName) => ipcRenderer.invoke('rename-project', { projectId, newName })
});