const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: (projectName) => ipcRenderer.invoke('select-folder', projectName), // Pass project name
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getTasks: (projectId) => ipcRenderer.invoke('get-tasks', projectId),
  deleteProject: (projectId) => ipcRenderer.invoke('delete-project', projectId),
  renameProject: (args) => ipcRenderer.invoke('rename-project', args),
  createProject: (projectName) => ipcRenderer.invoke('create-project', projectName), // Add this line
  
  // Add progress listener
  onUploadProgress: (callback) => {
    ipcRenderer.on('upload-progress', (event, data) => callback(data));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners('upload-progress');
  },

  // Expose safe APIs here
  sendMessage: (message) => ipcRenderer.invoke('send-message', message)
});