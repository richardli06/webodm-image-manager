const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: (projectName) => ipcRenderer.invoke('select-folder', projectName), // Pass project name
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getTasks: (projectId) => ipcRenderer.invoke('get-tasks', projectId),
  deleteProject: (projectId) => ipcRenderer.invoke('delete-project', projectId),
  renameProject: (args) => ipcRenderer.invoke('rename-project', args),
  createProject: (projectName) => ipcRenderer.invoke('create-project', projectName),
  
  // Add the missing commit task methods
  commitTaskToMap: (projectId, projectName) => ipcRenderer.invoke('commit-task-to-map', projectId, projectName),
  
  // Add progress listeners
  onUploadProgress: (callback) => {
    ipcRenderer.on('upload-progress', (event, data) => callback(data));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners('upload-progress');
  },
  
  // Add commit progress listener
  onCommitProgress: (callback) => {
    ipcRenderer.on('commit-progress', (event, data) => callback(data));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners('commit-progress');
  },

  // Add WebODM progress listener
  onWebODMProgress: (callback) => {
    ipcRenderer.on('webodm-progress', (event, data) => callback(data));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners('webodm-progress');
  },

  // Expose safe APIs here
  sendMessage: (message) => ipcRenderer.invoke('send-message', message)
});