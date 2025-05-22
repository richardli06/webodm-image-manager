const { app, BrowserWindow } = require('electron/main')
const { dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
require('dotenv').config();

let cachedToken = null;
let tokenExpiry = null;

async function getApiToken() {
  const username = process.env.WEBODM_USERNAME;
  const password = process.env.WEBODM_PASSWORD;

  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const tokenRes = await axios.post('http://localhost:8000/api/token-auth/', {
    username,
    password
  });
  cachedToken = tokenRes.data.token;

  const payload = JSON.parse(Buffer.from(cachedToken.split('.')[1], 'base64').toString());
  tokenExpiry = payload.exp * 1000;

  return cachedToken;
}

function startWebODMWithCompose() {
  const webodmDir = 'C:\\Users\\WH01\\webodm';

  exec('docker-compose up -d', { cwd: webodmDir }, (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to start WebODM with docker-compose:', err.message, stderr);
    } else {
      console.log('WebODM started with docker-compose:', stdout);
    }
  });
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile('index.html')
}

// --- IPC handlers ---
ipcMain.handle('select-folder', async () => {
  console.log('select-folder called');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled) return;

  const folderPath = filePaths[0];
  console.log('Selected folder:', folderPath);

  const jpgFiles = fs.readdirSync(folderPath)
    .filter(f => f.toLowerCase().endsWith('.jpg'))
    .map(f => path.join(folderPath, f));

  console.log('Found JPG files:', jpgFiles);

  if (jpgFiles.length < 2) {
    console.error('You need at least 2 JPG images to create a task in WebODM.');
    return;
  }

  console.log('Waiting for WebODM to be ready...');
  const waitForWebODM = async (retries = 20, delay = 3000) => {
    for (let i = 0; i < retries; i++) {
      try {
        await axios.get('http://localhost:8000/api/');
        return true;
      } catch (e) {
        console.error('WebODM not ready yet, retrying...', e.message, e.code, e.response && e.response.status);
        await new Promise(res => setTimeout(res, delay));
      }
    }
    return false;
  };
  const ready = await waitForWebODM();
  if (!ready) {
    console.error('WebODM did not become ready in time.');
    return;
  }

  let apiToken;
  try {
    apiToken = await getApiToken();
    console.log('Got API token:', apiToken);
  } catch (e) {
    console.error('Failed to get API token:', e.message, e.response && e.response.data);
    return;
  }

  let projectId;
  try {
    const projectRes = await axios.post(
      'http://localhost:8000/api/projects/',
      { name: 'Electron Project' },
      { headers: { Authorization: `JWT ${apiToken}` } }
    );
    projectId = projectRes.data.id;
    console.log('Created project with ID:', projectId);
  } catch (e) {
    console.error('Failed to create project:', e.message, e.response && e.response.data);
    return;
  }

  let taskId;
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('name', 'Electron Task');
    jpgFiles.forEach(file => {
      form.append('images', fs.createReadStream(file));
    });

    const taskRes = await axios.post(
      `http://localhost:8000/api/projects/${projectId}/tasks/`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `JWT ${apiToken}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    taskId = taskRes.data.id;
    console.log('Created task with ID:', taskId);
  } catch (e) {
    console.error('Failed to create task and upload images:', e.message, e.response && e.response.data);
    return;
  }

  console.log('Images sent to WebODM for processing!');
});

ipcMain.handle('get-projects', async () => {
  let apiToken;
  try {
    apiToken = await getApiToken();
  } catch (e) {
    console.error('Failed to get API token:', e.message, e.response && e.response.data);
    return [];
  }

  try {
    const projectsRes = await axios.get('http://localhost:8000/api/projects/', {
      headers: { Authorization: `JWT ${apiToken}` }
    });
    return projectsRes.data;
  } catch (e) {
    console.error('Failed to fetch projects:', e.message, e.response && e.response.data);
    return [];
  }
});

ipcMain.handle('get-tasks', async (event, projectId) => {
  let apiToken;
  try {
    apiToken = await getApiToken();
  } catch (e) {
    console.error('Failed to get API token:', e.message, e.response && e.response.data);
    return [];
  }

  try {
    const tasksRes = await axios.get(`http://localhost:8000/api/projects/${projectId}/tasks/`, {
      headers: { Authorization: `JWT ${apiToken}` }
    });
    return tasksRes.data;
  } catch (e) {
    console.error('Failed to fetch tasks:', e.message, e.response && e.response.data);
    return [];
  }
});

ipcMain.handle('delete-project', async (event, projectId) => {
  let apiToken;
  try {
    apiToken = await getApiToken();
  } catch (e) {
    console.error('Failed to get API token:', e.message, e.response && e.response.data);
    return { success: false, error: 'Auth failed' };
  }

  try {
    await axios.delete(`http://localhost:8000/api/projects/${projectId}/`, {
      headers: { Authorization: `JWT ${apiToken}` }
    });
    return { success: true };
  } catch (e) {
    console.error('Failed to delete project:', e.message, e.response && e.response.data);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('rename-project', async (event, { projectId, newName }) => {
  let apiToken;
  try {
    apiToken = await getApiToken();
  } catch (e) {
    console.error('Failed to get API token:', e.message, e.response && e.response.data);
    return { success: false, error: 'Auth failed' };
  }

  try {
    await axios.patch(
      `http://localhost:8000/api/projects/${projectId}/`,
      { name: newName },
      { headers: { Authorization: `JWT ${apiToken}` } }
    );
    return { success: true };
  } catch (e) {
    console.error('Failed to rename project:', e.message, e.response && e.response.data);
    return { success: false, error: e.message };
  }
});

// --- App lifecycle ---
app.whenReady().then(() => {
  startWebODMWithCompose();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});