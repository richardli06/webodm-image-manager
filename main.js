const { app, BrowserWindow } = require('electron/main');
const { dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { IMAGE_HANDLER_API_URL } = require('./lib/constant'); // <-- Use the constant from lib

/**
 * Tests the server connection and specific endpoints.
 * @returns {Promise<boolean>} True if the server is reachable, false otherwise.
 */
async function testServerConnection() {
  console.log('🔍 Testing server connection...');
  console.log('Server URL:', IMAGE_HANDLER_API_URL);
  
  try {
    // Test if server is running at all
    const response = await axios.get(`${IMAGE_HANDLER_API_URL}/`);
    console.log('✅ Server is running, status:', response.status);
  } catch (error) {
    console.error('❌ Server connection failed:', error.message);
    console.error('Make sure your image handler server is running on:', IMAGE_HANDLER_API_URL);
    return false;
  }

  // Test specific endpoints
  const endpoints = [
    '/api/push-images',
    '/push-images',
    '/api/get-projects',
    '/api/get-tasks'
  ];

  for (const endpoint of endpoints) {
    try {
      await axios.get(`${IMAGE_HANDLER_API_URL}${endpoint}`);
      console.log(`✅ ${endpoint} - exists`);
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`❌ ${endpoint} - does not exist (404)`);
      } else if (error.response?.status === 405) {
        console.log(`✅ ${endpoint} - exists (method not allowed for GET)`);
      } else {
        console.log(`⚠️ ${endpoint} - error: ${error.response?.status}`);
      }
    }
  }
  
  return true;
}

/**
 * Creates the main application window.
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,        // Disable node integration
      contextIsolation: true,        // Enable context isolation
      enableRemoteModule: false,     // Disable remote module
      sandbox: true,                 // Enable sandbox mode (optional but recommended)
      preload: path.join(__dirname, 'preload.js') // Use preload script for secure communication
    }
  });

  win.loadFile('index.html');
}

// --- IPC handlers ---

/**
 * Handles folder selection, reads JPG images, and sends them to the image request handler in batches.
 * @returns {Promise<Object>} Result object with success/data or error/details.
 */
ipcMain.handle('select-folder', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || !filePaths || !filePaths[0]) return { success: false, error: 'No folder selected' };

  const folderPath = filePaths[0];
  try {
    // 1. Get all JPG/JPEG files in the folder
    const files = fs.readdirSync(folderPath)
      .filter(f => /\.(jpe?g)$/i.test(f))
      .map(f => path.join(folderPath, f));

    if (files.length === 0) {
      return { success: false, error: 'No JPG images found in folder' };
    }

    console.log(`Found ${files.length} images. Starting batch upload...`);

    // 2. Upload in batches
    const batchSize = 15;
    const maxFileSize = 50 * 1024 * 1024;
    const totalBatches = Math.ceil(files.length / batchSize); // Define totalBatches here
    const results = [];
    let totalUploaded = 0;
    let totalSkipped = 0;

    // Send initial progress
    event.sender.send('upload-progress', {
      stage: 'starting',
      totalFiles: files.length,
      currentBatch: 0,
      totalBatches: totalBatches, // Use the defined variable
      filesUploaded: 0,
      message: `Found ${files.length} images. Preparing upload...`
    });

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const batchNumber = Math.floor(i/batchSize) + 1;
      
      // Send progress update
      event.sender.send('upload-progress', {
        stage: 'uploading',
        totalFiles: files.length,
        currentBatch: batchNumber,
        totalBatches: totalBatches, // Use the defined variable
        filesUploaded: totalUploaded,
        message: `Uploading batch ${batchNumber}/${totalBatches} (${batch.length} files)...`
      });

      const form = new FormData();
      form.append('project_name', 'gefarm');
      
      let batchFilesAdded = 0;
      for (const filePath of batch) {
        const stats = fs.statSync(filePath);
        if (stats.size > maxFileSize) {
          console.warn(`Skipping large file: ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
          totalSkipped++;
          continue;
        }
        
        form.append('images', fs.createReadStream(filePath), {
          filename: path.basename(filePath),
          contentType: 'image/jpeg'
        });
        batchFilesAdded++;
      }

      if (batchFilesAdded === 0) {
        console.log(`Batch ${batchNumber} skipped - no valid files`);
        continue;
      }

      try {
        console.log(`📤 Uploading batch ${batchNumber} to: ${IMAGE_HANDLER_API_URL}/api/push-images`);
        console.log(`📊 Form contains ${batchFilesAdded} files`);
        
        const res = await axios.post(
          `${IMAGE_HANDLER_API_URL}/api/push-images`,
          form,
          { 
            headers: form.getHeaders(),
            timeout: 300000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );
        
        console.log(`✅ Batch ${batchNumber} uploaded successfully (${batchFilesAdded} files)`);
        results.push({
          batch: batchNumber,
          success: true,
          filesUploaded: batchFilesAdded,
          data: res.data
        });
        totalUploaded += batchFilesAdded;

        // Send success update
        event.sender.send('upload-progress', {
          stage: 'uploading',
          totalFiles: files.length,
          currentBatch: batchNumber,
          totalBatches: totalBatches,
          filesUploaded: totalUploaded,
          message: `Batch ${batchNumber}/${totalBatches} completed (${batchFilesAdded} files uploaded)`
        });

      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed:`);
        console.error('📍 URL:', batchError.config?.url);
        console.error('🔢 Status:', batchError.response?.status);
        console.error('📝 Status Text:', batchError.response?.statusText);
        console.error('💬 Error Message:', batchError.message);
        console.error('📄 Response Data:', batchError.response?.data);
        
        // Check if it's a connection error
        if (batchError.code === 'ECONNREFUSED') {
          console.error('🚨 Connection refused - is your server running?');
        } else if (batchError.response?.status === 404) {
          console.error('🚨 Endpoint not found - check your server routes');
        }
        
        results.push({
          batch: batchNumber,
          success: false,
          error: `Status ${batchError.response?.status}: ${batchError.message}`,
          filesAttempted: batchFilesAdded,
          details: batchError.response?.data
        });

        // Send error update
        event.sender.send('upload-progress', {
          stage: 'error',
          totalFiles: files.length,
          currentBatch: batchNumber,
          totalBatches: totalBatches,
          filesUploaded: totalUploaded,
          message: `Batch ${batchNumber} failed: ${batchError.response?.status || 'Connection error'}`
        });
      }

      // Small delay between batches
      if (i + batchSize < files.length) {
        event.sender.send('upload-progress', {
          stage: 'waiting',
          totalFiles: files.length,
          currentBatch: batchNumber,
          totalBatches: totalBatches,
          filesUploaded: totalUploaded,
          message: 'Waiting before next batch...'
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const successfulBatches = results.filter(r => r.success).length;
    const failedBatches = results.filter(r => !r.success).length;

    // Send completion update
    event.sender.send('upload-progress', {
      stage: 'completed',
      totalFiles: files.length,
      currentBatch: totalBatches,
      totalBatches: totalBatches,
      filesUploaded: totalUploaded,
      message: `Upload complete: ${totalUploaded}/${files.length} files uploaded`
    });

    return { 
      success: successfulBatches > 0,
      data: {
        totalFiles: files.length,
        totalUploaded,
        totalSkipped,
        successfulBatches,
        failedBatches,
        results
      },
      summary: `Uploaded ${totalUploaded}/${files.length} files in ${successfulBatches}/${totalBatches} batches`
    };

  } catch (err) {
    console.error('Failed to process folder:', err.message);
    event.sender.send('upload-progress', {
      stage: 'error',
      message: `Error: ${err.message}`
    });
    return {
      success: false,
      error: err.message,
      details: err.response?.data
    };
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
app.whenReady().then(async () => {
  createWindow();
  await testServerConnection();
});

/**
 * Quits the app when all windows are closed (except on macOS).
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});