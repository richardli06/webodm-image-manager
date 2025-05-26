const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getTasks: (projectId) => ipcRenderer.invoke('get-tasks', projectId),
  deleteProject: (projectId) => ipcRenderer.invoke('delete-project', projectId),
  renameProject: (args) => ipcRenderer.invoke('rename-project', args), // Pass the whole args object
  
  // Add progress listener
  onUploadProgress: (callback) => {
    ipcRenderer.on('upload-progress', (event, data) => callback(data));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners('upload-progress');
  },

  // Expose safe APIs here
  sendMessage: (message) => ipcRenderer.invoke('send-message', message)
});