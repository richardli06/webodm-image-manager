const { app, BrowserWindow } = require('electron/main')
const { dialog, ipcMain, shell } = require('electron'); // Add at the top
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
require('dotenv').config();

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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

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

  // Wait for WebODM to be ready (use a public endpoint or just try to get the token)
  console.log('Waiting for WebODM to be ready...');
  const waitForWebODM = async (retries = 20, delay = 3000) => {
    for (let i = 0; i < retries; i++) {
      try {
        // Try a public endpoint, or just check if the server is up
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

  // Read credentials from .env
  const username = process.env.WEBODM_USERNAME;
  const password = process.env.WEBODM_PASSWORD;

  // Get API token using the credentials from .env
  let apiToken;
  try {
    const tokenRes = await axios.post('http://localhost:8000/api/token-auth/', {
      username,
      password
    });
    apiToken = tokenRes.data.token;
    console.log('Got API token:', apiToken);
  } catch (e) {
    console.error('Failed to get API token:', e.message, e.response && e.response.data);
    return;
  }

  // 1. Create a project
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

  // 2. Create a task and upload images in one step
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
  const username = process.env.WEBODM_USERNAME;
  const password = process.env.WEBODM_PASSWORD;

  // Get API token
  let apiToken;
  try {
    const tokenRes = await axios.post('http://localhost:8000/api/token-auth/', {
      username,
      password
    });
    apiToken = tokenRes.data.token;
  } catch (e) {
    console.error('Failed to get API token:', e.message, e.response && e.response.data);
    return [];
  }

  // Fetch projects
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

// Add a handler to fetch tasks for a project
ipcMain.handle('get-tasks', async (event, projectId) => {
  const username = process.env.WEBODM_USERNAME;
  const password = process.env.WEBODM_PASSWORD;

  let apiToken;
  try {
    const tokenRes = await axios.post('http://localhost:8000/api/token-auth/', {
      username,
      password
    });
    apiToken = tokenRes.data.token;
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