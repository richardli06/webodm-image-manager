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
ipcMain.handle('select-folder', async (event, projectName) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || !filePaths || !filePaths[0]) return { success: false, error: 'No folder selected' };

  // Validate project name
  if (!projectName) {
    return { success: false, error: 'No project selected' };
  }

  const folderPath = filePaths[0];
  try {
    // 1. Get all JPG/JPEG files in the folder
    const files = fs.readdirSync(folderPath)
      .filter(f => /\.(jpe?g)$/i.test(f))
      .map(f => path.join(folderPath, f));

    if (files.length === 0) {
      return { success: false, error: 'No JPG images found in folder' };
    }

    console.log(`Found ${files.length} images. Starting batch upload to project: ${projectName}`);

    // 2. Upload in batches
    const batchSize = 1000; // Changed from 15 to 1000
    const maxFileSize = 50 * 1024 * 1024;
    const totalBatches = Math.ceil(files.length / batchSize);
    const results = [];
    let totalUploaded = 0;
    let totalSkipped = 0;

    // Send initial progress
    event.sender.send('upload-progress', {
      stage: 'starting',
      totalFiles: files.length,
      currentBatch: 0,
      totalBatches: totalBatches,
      filesUploaded: 0,
      progress: 0,
      message: `Found ${files.length} images. Preparing upload to "${projectName}"...`
    });

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const batchNumber = Math.floor(i/batchSize) + 1;
      
      // Send progress update
      event.sender.send('upload-progress', {
        stage: 'preparing',
        totalFiles: files.length,
        currentBatch: batchNumber,
        totalBatches: totalBatches,
        filesUploaded: totalUploaded,
        progress: Math.round((totalUploaded / files.length) * 100),
        message: `Preparing batch ${batchNumber}/${totalBatches} for "${projectName}" (${batch.length} files)...`
      });

      const form = new FormData();
      form.append('project_name', projectName);
      
      let batchFilesAdded = 0;
      let filesProcessed = 0;
      
      for (const filePath of batch) {
        const stats = fs.statSync(filePath);
        if (stats.size > maxFileSize) {
          console.warn(`Skipping large file: ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
          totalSkipped++;
          filesProcessed++;
          continue;
        }
        
        form.append('images', fs.createReadStream(filePath), {
          filename: path.basename(filePath),
          contentType: 'image/jpeg'
        });
        batchFilesAdded++;
        filesProcessed++;
        
        // Send progress update every 25 files during preparation
        if (filesProcessed % 25 === 0) {
          const preparationProgress = Math.round(((i + filesProcessed) / files.length) * 50); // 50% for preparation
          event.sender.send('upload-progress', {
            stage: 'preparing',
            totalFiles: files.length,
            currentBatch: batchNumber,
            totalBatches: totalBatches,
            filesUploaded: totalUploaded,
            filesProcessed: i + filesProcessed,
            progress: preparationProgress,
            message: `Preparing files for upload... ${filesProcessed}/${batch.length} files processed`
          });
        }
      }

      if (batchFilesAdded === 0) {
        console.log(`Batch ${batchNumber} skipped - no valid files`);
        continue;
      }

      // Send upload starting progress
      event.sender.send('upload-progress', {
        stage: 'uploading',
        totalFiles: files.length,
        currentBatch: batchNumber,
        totalBatches: totalBatches,
        filesUploaded: totalUploaded,
        progress: 50, // 50% when starting upload
        message: `Uploading batch ${batchNumber}/${totalBatches} to "${projectName}" (${batchFilesAdded} files)...`
      });

      try {
        console.log(`📤 Uploading batch ${batchNumber} to project "${projectName}": ${IMAGE_HANDLER_API_URL}/api/push-images`);
        console.log(`📊 Form contains ${batchFilesAdded} files`);
        
        const res = await axios.post(
          `${IMAGE_HANDLER_API_URL}/api/push-images`,
          form,
          { 
            headers: form.getHeaders(),
            timeout: 600000, // Increased to 10 minutes for large batches
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            onUploadProgress: (progressEvent) => {
              // Calculate upload progress (50% to 100%)
              const uploadPercent = progressEvent.loaded / progressEvent.total;
              const totalProgress = 50 + (uploadPercent * 50); // 50% + upload progress
              
              event.sender.send('upload-progress', {
                stage: 'uploading',
                totalFiles: files.length,
                currentBatch: batchNumber,
                totalBatches: totalBatches,
                filesUploaded: totalUploaded,
                progress: Math.round(totalProgress),
                bytesUploaded: progressEvent.loaded,
                bytesTotal: progressEvent.total,
                message: `Uploading to "${projectName}"... ${Math.round(uploadPercent * 100)}% of batch ${batchNumber}`
              });
            }
          }
        );
        
        console.log(`✅ Batch ${batchNumber} uploaded successfully to "${projectName}" (${batchFilesAdded} files)`);
        results.push({
          batch: batchNumber,
          success: true,
          filesUploaded: batchFilesAdded,
          data: res.data
        });
        totalUploaded += batchFilesAdded;

        // Send success update with final progress
        event.sender.send('upload-progress', {
          stage: 'completed',
          totalFiles: files.length,
          currentBatch: batchNumber,
          totalBatches: totalBatches,
          filesUploaded: totalUploaded,
          progress: 100,
          message: `Batch ${batchNumber}/${totalBatches} completed - uploaded ${batchFilesAdded} files to "${projectName}" (${totalUploaded}/${files.length} total)`
        });

      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed for project "${projectName}":`);
        console.error('📍 URL:', batchError.config?.url);
        console.error('🔢 Status:', batchError.response?.status);
        console.error('📝 Status Text:', batchError.response?.statusText);
        console.error('💬 Error Message:', batchError.message);
        console.error('📄 Response Data:', batchError.response?.data);
        
        results.push({
          batch: batchNumber,
          success: false,
          error: `Status ${batchError.response?.status}: ${batchError.message}`,
          filesAttempted: batchFilesAdded,
          details: batchError.response?.data
        });

        // Send error update with current progress
        event.sender.send('upload-progress', {
          stage: 'error',
          totalFiles: files.length,
          currentBatch: batchNumber,
          totalBatches: totalBatches,
          filesUploaded: totalUploaded,
          progress: Math.round((totalUploaded / files.length) * 100),
          message: `Batch ${batchNumber} failed uploading to "${projectName}": ${batchError.response?.status || 'Connection error'} (${totalUploaded}/${files.length} uploaded)`
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
          progress: Math.round((totalUploaded / files.length) * 100),
          message: `Waiting before next batch... (${totalUploaded}/${files.length} files uploaded)`
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const successfulBatches = results.filter(r => r.success).length;
    const failedBatches = results.filter(r => !r.success).length;

    // Send completion update with final progress
    event.sender.send('upload-progress', {
      stage: 'completed',
      totalFiles: files.length,
      currentBatch: totalBatches,
      totalBatches: totalBatches,
      filesUploaded: totalUploaded,
      progress: Math.round((totalUploaded / files.length) * 100),
      message: `Upload complete: ${totalUploaded}/${files.length} files uploaded to "${projectName}"`
    });

    // START WEBODM MONITORING if upload was successful
    if (successfulBatches > 0) {
      const lastSuccessfulResult = results.filter(r => r.success).pop();
      console.log('Last successful result:', JSON.stringify(lastSuccessfulResult, null, 2));
      
      if (lastSuccessfulResult && lastSuccessfulResult.data) {
        let taskId = null;
        let projectId = null;
        
        // Try to extract task ID and project ID from different possible locations
        if (lastSuccessfulResult.data.task && lastSuccessfulResult.data.task.id) {
          taskId = lastSuccessfulResult.data.task.id;
          projectId = lastSuccessfulResult.data.task.project_id || lastSuccessfulResult.data.task.project;
        } else if (lastSuccessfulResult.data.task_id) {
          taskId = lastSuccessfulResult.data.task_id;
          projectId = lastSuccessfulResult.data.project_id;
        } else if (lastSuccessfulResult.data.id) {
          taskId = lastSuccessfulResult.data.id;
          projectId = lastSuccessfulResult.data.project_id || lastSuccessfulResult.data.project;
        }
        
        // Also try to get project ID from the upload response
        if (!projectId && lastSuccessfulResult.data.project) {
          if (typeof lastSuccessfulResult.data.project === 'object') {
            projectId = lastSuccessfulResult.data.project.id;
          } else {
            projectId = lastSuccessfulResult.data.project;
          }
        }
        
        if (taskId && projectId) {
          console.log(`🔄 Starting WebODM progress monitoring for task ${taskId} in project ${projectId}`);
          
          // Start polling WebODM progress in background with both IDs
          pollWebODMProgress(taskId, projectId, event.sender).catch(error => {
            console.error('Error in WebODM progress polling:', error);
            event.sender.send('webodm-progress', {
              stage: 'error',
              progress: 0,
              taskId: taskId,
              projectId: projectId,
              message: `Monitoring error: ${error.message}`
            });
          });
        } else {
          console.log('⚠️ Missing task ID or project ID in upload response, cannot monitor WebODM progress');
          console.log('Available data keys:', Object.keys(lastSuccessfulResult.data));
          console.log('taskId:', taskId, 'projectId:', projectId);
          
          // Send a message to the user about manual checking
          event.sender.send('webodm-progress', {
            stage: 'warning',
            progress: 10,
            status: 'MANUAL_CHECK',
            message: 'Upload complete! Please check WebODM dashboard manually for progress.',
            webodmUrl: 'http://localhost:8000'
          });
        }
      }
    }

    return { 
      success: successfulBatches > 0,
      data: {
        totalFiles: files.length,
        totalUploaded,
        totalSkipped,
        successfulBatches,
        failedBatches,
        results,
        projectName
      },
      summary: `Uploaded ${totalUploaded}/${files.length} files to "${projectName}" in ${successfulBatches}/${totalBatches} batches`
    };

  } catch (err) {
    console.error('Failed to process folder:', err.message);
    event.sender.send('upload-progress', {
      stage: 'error',
      message: `Error uploading to "${projectName}": ${err.message}`
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

/**
 * Creates a new project via the image request handler.
 * @param {Electron.IpcMainInvokeEvent} event - The IPC event.
 * @param {string} projectName - The new project name.
 * @returns {Promise<Object>} Result object with success/data or error.
 */
ipcMain.handle('create-project', async (event, projectName) => {
  try {
    console.log('Creating new project:', projectName);
    const res = await axios.post(`${IMAGE_HANDLER_API_URL}/api/create-project`, {
      name: projectName
    });
    console.log('Project created successfully:', res.data);
    return { success: true, data: res.data };
  } catch (e) {
    console.error('Failed to create project:', e.message, e.response && e.response.data);
    return { 
      success: false, 
      error: e.response?.data?.error || e.message,
      details: e.response?.data
    };
  }
});

/**
 * Commits a task to the map via the image request handler.
 * @param {Electron.IpcMainInvokeEvent} event - The IPC event.
 * @param {string} projectId - The project ID.
 * @param {string} projectName - The project name.
 * @returns {Promise<Object>} Result object with success/data or error.
 */
ipcMain.handle('commit-task-to-map', async (event, projectId, projectName) => {
  try {
    console.log(`🗺️ Committing task to map for project: ${projectName} (ID: ${projectId})`);
    
    // Send initial progress
    event.sender.send('commit-progress', {
      stage: 'starting',
      progress: 0,
      message: `Starting commit process for project "${projectName}"...`
    });

    // Get the task ID for this project first
    event.sender.send('commit-progress', {
      stage: 'fetching',
      progress: 5,
      message: 'Getting task information from WebODM...'
    });

    // Get tasks for the project to find the task ID
    const tasksResponse = await axios.get(`${IMAGE_HANDLER_API_URL}/api/get-tasks/${projectId}`, {
      timeout: 30000
    });

    const tasks = tasksResponse.data;
    if (!tasks || tasks.length === 0) {
      throw new Error('No tasks found for this project');
    }

    // Get the most recent task
    const task = tasks[tasks.length - 1];
    const taskId = task.id;

    event.sender.send('commit-progress', {
      stage: 'monitoring',
      progress: 10,
      message: `Monitoring task ${taskId} processing...`
    });

    // Poll task status until completion
    let taskComplete = false;
    let pollCount = 0;
    const maxPolls = 240; // 20 minutes max (5 second intervals)

    while (!taskComplete && pollCount < maxPolls) {
      try {
        const taskStatusResponse = await axios.get(`${IMAGE_HANDLER_API_URL}/api/get-task-status/${taskId}`, {
          timeout: 30000
        });
        
        const taskData = taskStatusResponse.data;
        const status = taskData.status;
        const progress = taskData.progress || 0;
        const processingNode = taskData.processing_node || 'Unknown';

        // Map WebODM status to progress stages
        let stage = 'processing';
        let progressPercent = Math.min(10 + (progress * 0.7), 80); // 10% to 80% based on task progress
        let message = `WebODM processing: ${status}`;

        // Detailed status messages based on WebODM progress
        if (progress === 0) {
          message = `Task queued on ${processingNode}...`;
        } else if (progress < 10) {
          message = `Starting image processing... (${progress}%)`;
        } else if (progress < 30) {
          message = `Detecting features in images... (${progress}%)`;
        } else if (progress < 50) {
          message = `Matching features between images... (${progress}%)`;
        } else if (progress < 70) {
          message = `Building sparse point cloud... (${progress}%)`;
        } else if (progress < 85) {
          message = `Generating dense point cloud... (${progress}%)`;
        } else if (progress < 95) {
          message = `Creating mesh and textures... (${progress}%)`;
        } else if (progress < 100) {
          message = `Generating orthophoto and outputs... (${progress}%)`;
        }

        // Send progress update
        event.sender.send('commit-progress', {
          stage: stage,
          progress: progressPercent,
          taskStatus: status,
          taskProgress: progress,
          message: message
        });

        if (status === 'COMPLETED') {
          taskComplete = true;
          
          // Start the commit process
          event.sender.send('commit-progress', {
            stage: 'committing',
            progress: 85,
            message: 'Task completed! Starting commit to map...'
          });
          
        } else if (status === 'FAILED' || status === 'CANCELED') {
          throw new Error(`Task ${status}: ${taskData.last_error || 'Unknown error'}`);
        }
        
        pollCount++;
        
        // Wait 5 seconds before next poll
        if (!taskComplete) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
      } catch (pollError) {
        console.error('Error polling task status:', pollError.message);
        // Continue polling unless it's a critical error
        pollCount++;
        if (pollCount > 5) {
          event.sender.send('commit-progress', {
            stage: 'warning',
            progress: Math.min(10 + (pollCount * 2), 80),
            message: `Connection issues, retrying... (${pollCount}/${maxPolls})`
          });
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    if (!taskComplete) {
      throw new Error('Task processing timeout - task may still be running');
    }

    // Now commit the completed task
    event.sender.send('commit-progress', {
      stage: 'downloading',
      progress: 90,
      message: 'Downloading orthophoto and generating shapefile...'
    });

    const response = await axios.post(`${IMAGE_HANDLER_API_URL}/api/commit-task-to-map`, {
      project_id: projectId,
      project_name: projectName,
      task_id: taskId
    }, {
      timeout: 300000, // 5 minutes for file operations
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Final completion
    event.sender.send('commit-progress', {
      stage: 'completed',
      progress: 100,
      message: 'Task committed successfully!'
    });

    console.log('✅ Task committed to map successfully:', response.data);
    
    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    console.error('❌ Failed to commit task to map:', error.message);
    console.error('📄 Response data:', error.response?.data);
    
    // Send error progress
    event.sender.send('commit-progress', {
      stage: 'error',
      progress: 0,
      message: `Error: ${error.message}`
    });
    
    return {
      success: false,
      error: error.response?.data?.error || error.message,
      details: error.response?.data
    };
  }
});

/**
 * Polls WebODM task progress and sends updates to renderer
 * @param {string} taskId - WebODM task ID
 * @param {string} projectId - WebODM project ID
 * @param {Electron.WebContents} sender - Renderer process sender
 * @param {string} pollUrl - Optional poll URL from upload response
 * @returns {Promise<void>}
 */
async function pollWebODMProgress(taskId, projectId, sender, pollUrl = null) {
  let isComplete = false;
  let pollCount = 0;
  const maxPolls = 720; // Increased to 60 minutes (5 second intervals)
  let taskFound = false;

  console.log(`Starting WebODM progress monitoring for task: ${taskId} in project: ${projectId}`);
  
  // Send initial message
  sender.send('webodm-progress', {
    stage: 'initializing',
    progress: 1,
    status: 'INITIALIZING',
    taskId: taskId,
    projectId: projectId,
    message: 'Task created! WebODM is processing uploaded images...'
  });

  while (!isComplete && pollCount < maxPolls) {
    try {
      // Use the new API endpoint with both task_id and project_id
      const response = await axios.get(`${IMAGE_HANDLER_API_URL}/api/task-progress?task_id=${taskId}&project_id=${projectId}`, {
        timeout: 15000
      });
      
      // Task found! Switch to processing mode
      if (!taskFound) {
        taskFound = true;
        const waitTime = Math.floor(pollCount * 5 / 60);
        console.log(`✅ Task ${taskId} found in WebODM after ${waitTime} minutes`);
        
        sender.send('webodm-progress', {
          stage: 'found',
          progress: 15,
          status: 'FOUND',
          taskId: taskId,
          projectId: projectId,
          message: `Task initialized! Starting WebODM processing...`
        });
      }
      
      const taskData = response.data;
      const overallProgress = taskData.progress || 0;
      const status = taskData.status;
      const stage = taskData.stage || 'Processing';
      const uploadProgress = taskData.upload_progress || 0;
      const resizeProgress = taskData.resize_progress || 0;
      const runningProgress = taskData.running_progress || 0;
      
      console.log(`📊 Task ${taskId} - Status: ${status}, Stage: ${stage}, Progress: ${overallProgress}%`);
      console.log(`📊 Detailed: Upload: ${uploadProgress}%, Resize: ${resizeProgress}%, Running: ${runningProgress}%`);
      
      // Handle different WebODM states using the new status codes
      if (status === 10) { // QUEUED
        sender.send('webodm-progress', {
          stage: 'queued',
          progress: Math.min(15 + (pollCount * 0.1), 25),
          status: 'QUEUED',
          taskId: taskId,
          projectId: projectId,
          message: `Task queued for processing...`,
          details: {
            upload: uploadProgress,
            resize: resizeProgress,
            running: runningProgress
          }
        });
      } else if (status === 20) { // RUNNING
        // Use the calculated overall progress from the API
        const displayProgress = Math.max(25, overallProgress);
        
        let detailedMessage = stage;
        if (uploadProgress < 100) {
          detailedMessage = `Uploading images... (${uploadProgress}%)`;
        } else if (resizeProgress < 100) {
          detailedMessage = `Resizing images... (${resizeProgress}%)`;
        } else {
          detailedMessage = `Processing orthophoto... (${runningProgress}%)`;
        }
        
        sender.send('webodm-progress', {
          stage: 'processing',
          progress: displayProgress,
          status: 'RUNNING',
          taskId: taskId,
          projectId: projectId,
          message: detailedMessage,
          details: {
            upload: uploadProgress,
            resize: resizeProgress,
            running: runningProgress
          }
        });
      } else if (status === 40) { // COMPLETED
        isComplete = true;
        sender.send('webodm-progress', {
          stage: 'completed',
          progress: 100,
          status: 'COMPLETED',
          taskId: taskId,
          projectId: projectId,
          message: 'WebODM processing completed! Orthophoto is ready.',
          details: {
            upload: 100,
            resize: 100,
            running: 100
          }
        });
        console.log(`✅ Task ${taskId} completed successfully`);
      } else if (status === 30 || status === 50) { // FAILED or CANCELED
        isComplete = true;
        const statusText = status === 30 ? 'FAILED' : 'CANCELED';
        sender.send('webodm-progress', {
          stage: 'error',
          progress: 0,
          status: statusText,
          taskId: taskId,
          projectId: projectId,
          message: `Task ${statusText}: ${taskData.last_error || 'Unknown error'}`,
          error: taskData.last_error
        });
        console.log(`❌ Task ${taskId} ${statusText.toLowerCase()} with error: ${taskData.last_error}`);
      } else {
        // Unknown status, treat as processing
        sender.send('webodm-progress', {
          stage: 'processing',
          progress: Math.max(20, overallProgress || 0),
          status: 'UNKNOWN',
          taskId: taskId,
          projectId: projectId,
          message: `WebODM status: ${status} - ${stage} (${overallProgress}%)`,
          details: {
            upload: uploadProgress,
            resize: resizeProgress,
            running: runningProgress
          }
        });
      }

      pollCount++;
      
      if (!isComplete) {
        // Use consistent 5-second intervals once task is found
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
    } catch (error) {
      console.error(`❌ Polling error (attempt ${pollCount + 1}):`, error.response?.status, error.message);
      console.error(`❌ Error details:`, error.response?.data);
      
      // Handle different error types
      if (error.response?.status === 400) {
        // Missing parameters
        sender.send('webodm-progress', {
          stage: 'error',
          progress: 0,
          status: 'ERROR',
          taskId: taskId,
          projectId: projectId,
          message: 'API configuration error - missing required parameters'
        });
        console.error('❌ Missing task_id or project_id parameters');
        break;
      } else if (error.response?.status === 404) {
        // Task not found
        const waitTimeMinutes = Math.floor(pollCount * 5 / 60);
        const waitTimeSeconds = (pollCount * 5) % 60;
        
        if (pollCount < 36) { // 0-3 minutes
          sender.send('webodm-progress', {
            stage: 'initializing',
            progress: Math.min(1 + (pollCount * 0.15), 6),
            status: 'INITIALIZING',
            taskId: taskId,
            projectId: projectId,
            message: `WebODM is processing uploaded images... (${waitTimeMinutes}m ${waitTimeSeconds}s)`
          });
        } else if (pollCount < 120) { // 3-10 minutes
          sender.send('webodm-progress', {
            stage: 'processing',
            progress: Math.min(6 + ((pollCount - 36) * 0.1), 12),
            status: 'PROCESSING',
            taskId: taskId,
            projectId: projectId,
            message: `Large image set - WebODM processing takes time... (${waitTimeMinutes}m ${waitTimeSeconds}s)`
          });
        } else { // 10+ minutes
          sender.send('webodm-progress', {
            stage: 'long-processing',
            progress: Math.min(12 + ((pollCount - 120) * 0.05), 20),
            status: 'PROCESSING',
            taskId: taskId,
            projectId: projectId,
            message: `Extended processing time - task may still be initializing... (${waitTimeMinutes}m ${waitTimeSeconds}s)`
          });
        }
      } else if (error.response?.status === 500) {
        // Server error
        const waitTimeMinutes = Math.floor(pollCount * 5 / 60);
        sender.send('webodm-progress', {
          stage: 'retry',
          progress: Math.min(5 + (pollCount * 0.1), 20),
          status: 'SERVER_ERROR',
          taskId: taskId,
          projectId: projectId,
          message: `Server error, retrying... (${waitTimeMinutes}m elapsed)`
        });
      } else {
        // Other errors - connection issues, etc.
        const waitTimeMinutes = Math.floor(pollCount * 5 / 60);
        sender.send('webodm-progress', {
          stage: 'retry',
          progress: Math.min(5 + (pollCount * 0.1), 20),
          status: 'RETRY',
          taskId: taskId,
          projectId: projectId,
          message: `Connection issues, retrying... (${waitTimeMinutes}m elapsed)`
        });
      }
      
      pollCount++;
      
      // Progressive delay - longer waits as time goes on
      let delay = 5000; // Default 5 seconds
      if (pollCount > 60) delay = 10000; // 10 seconds after 5 minutes
      if (pollCount > 240) delay = 15000; // 15 seconds after 20 minutes
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // If we exit the loop without completion
  if (!isComplete) {
    const finalMessage = taskFound 
      ? 'Monitoring timeout - task may still be processing. Check WebODM dashboard for current status.'
      : 'Task initialization timeout - WebODM may still be processing the uploaded images. Check WebODM dashboard.';
      
    console.log(`⚠️ Task ${taskId} monitoring timeout after ${Math.floor(maxPolls * 5 / 60)} minutes`);
    sender.send('webodm-progress', {
      stage: 'timeout',
      progress: taskFound ? 95 : 50,
      status: 'TIMEOUT',
      taskId: taskId,
      projectId: projectId,
      message: finalMessage,
      webodmUrl: 'http://localhost:8000',
      taskId: taskId
    });
  }
}

/**
 * Gets a user-friendly message for WebODM processing status
 * @param {string} status - WebODM task status
 * @param {number} progress - Progress percentage
 * @returns {string} User-friendly message
 */
function getWebODMStatusMessage(status, progress) {
  if (status === null || status === 'QUEUED') {
    return 'Task queued, waiting for processing node assignment...';
  } else if (progress === 0 && status === 'RUNNING') {
    return 'Processing node assigned, starting image analysis...';
  } else if (progress < 10) {
    return `Starting image processing... (${progress}%)`;
  } else if (progress < 30) {
    return `Detecting features in images... (${progress}%)`;
  } else if (progress < 50) {
    return `Matching features between images... (${progress}%)`;
  } else if (progress < 70) {
    return `Building sparse point cloud... (${progress}%)`;
  } else if (progress < 85) {
    return `Generating dense point cloud... (${progress}%)`;
  } else if (progress < 95) {
    return `Creating mesh and textures... (${progress}%)`;
  } else if (progress < 100) {
    return `Generating orthophoto and outputs... (${progress}%)`;
  } else {
    return `Processing complete! (${progress}%)`;
  }
}

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