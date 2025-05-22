const { app, BrowserWindow } = require('electron/main');
const { dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { IMAGE_HANDLER_API_URL } = require('./lib/constant'); // <-- Use the constant from lib

/**
 * Creates the main application window.
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

// --- IPC handlers ---

/**
 * Handles folder selection, reads JPG images, and sends them to the image request handler.
 * @returns {Promise<Object>} Result object with success/data or error/details.
 */
ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled) return;

  const folderPath = filePaths[0];
  const jpgFiles = fs.readdirSync(folderPath)
    .filter(f => f.toLowerCase().endsWith('.jpg'))
    .map(f => path.join(folderPath, f));

  if (jpgFiles.length < 2) {
    return { error: 'You need at least 2 JPG images to create a task.' };
  }

  // Read images as base64
  const imagesBase64 = jpgFiles.map(file =>
    fs.readFileSync(file, { encoding: 'base64' })
  );

  // Prompt for project name or use a default
  const projectName = 'Electron Project';

  try {
    const res = await axios.post(
      `${IMAGE_HANDLER_API_URL}/api/push-images`,
      {
        images: imagesBase64,
        project_name: projectName
      }
    );
    return { success: true, data: res.data };
  } catch (e) {
    return { error: e.message, details: e.response && e.response.data };
  }
});

/**
 * Fetches all projects from the image request handler.
 * @returns {Promise<Array>} Array of project objects or empty array on error.
 */
ipcMain.handle('get-projects', async () => {
  try {
    const res = await axios.get(`${IMAGE_HANDLER_API_URL}/api/get-projects`);
    return res.data.results || res.data; // .results if paginated, else array
  } catch (e) {
    console.error('Failed to fetch projects:', e.message, e.response && e.response.data);
    return [];
  }
});

/**
 * Fetches all tasks for a given project from the image request handler.
 * @param {Electron.IpcMainInvokeEvent} event - The IPC event.
 * @param {string} projectId - The project ID.
 * @returns {Promise<Array>} Array of task objects or empty array on error.
 */
ipcMain.handle('get-tasks', async (event, projectId) => {
  try {
    const res = await axios.get(`${IMAGE_HANDLER_API_URL}/api/get-tasks`, {
      params: { project_id: projectId }
    });
    return res.data.results || res.data; // .results if paginated, else array
  } catch (e) {
    console.error('Failed to fetch tasks:', e.message, e.response && e.response.data);
    return [];
  }
});

/**
 * Deletes a project via the image request handler.
 * @param {Electron.IpcMainInvokeEvent} event - The IPC event.
 * @param {string} projectId - The project ID.
 * @returns {Promise<Object>} Result object with success/data or error.
 */
ipcMain.handle('delete-project', async (event, projectId) => {
  try {
    const res = await axios.post(`${IMAGE_HANDLER_API_URL}/api/delete-project`, {
      project_id: projectId
    });
    return { success: true, data: res.data };
  } catch (e) {
    console.error('Failed to delete project:', e.message, e.response && e.response.data);
    return { success: false, error: e.message };
  }
});

/**
 * Renames a project via the image request handler.
 * @param {Electron.IpcMainInvokeEvent} event - The IPC event.
 * @param {Object} args - Arguments object.
 * @param {string} args.projectId - The project ID.
 * @param {string} args.newName - The new project name.
 * @returns {Promise<Object>} Result object with success/data or error.
 */
ipcMain.handle('rename-project', async (event, { projectId, newName }) => {
  try {
    const res = await axios.post(`${IMAGE_HANDLER_API_URL}/api/rename-project`, {
      project_id: projectId,
      new_name: newName
    });
    return { success: true, data: res.data };
  } catch (e) {
    console.error('Failed to rename project:', e.message, e.response && e.response.data);
    return { success: false, error: e.message };
  }
});

// --- App lifecycle ---

/**
 * Initializes the Electron app and creates the main window.
 */
app.whenReady().then(() => {
  createWindow();
});

/**
 * Quits the app when all windows are closed (except on macOS).
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});