import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import electronSquirrelStartup from 'electron-squirrel-startup';
import { IMAGE_HANDLER_API_URL } from '../lib/constants.js'; // <-- .js extension
import { fileURLToPath } from 'node:url';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (electronSquirrelStartup) {
  app.quit();
}

/**
 * Creates the main application window.
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools.
  // win.webContents.openDevTools();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

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
