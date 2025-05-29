let currentProjects = []; // Store projects globally
let selectedProjectName = null;

/**
 * Populates the project dropdown with available projects
 */
async function populateProjectSelector() {
  const projectSelect = document.getElementById('projectSelect');
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  
  if (!projectSelect) return;
  
  try {
    // Show loading state
    projectSelect.innerHTML = '<option value="">Loading projects...</option>';
    projectSelect.disabled = true;
    if (selectFolderBtn) selectFolderBtn.disabled = true;
    
    // Fetch projects
    const projects = await window.electronAPI.getProjects();
    
    if (!projects || projects.length === 0) {
      projectSelect.innerHTML = '<option value="">No projects available</option>';
      return;
    }
    
    // Populate dropdown
    projectSelect.innerHTML = '<option value="">Select a project...</option>' +
      projects.map(project => 
        `<option value="${project.name}" data-id="${project.id}">${project.name} (ID: ${project.id})</option>`
      ).join('');
    
    projectSelect.disabled = false;
    
    // Enable upload button when a project is selected
    projectSelect.addEventListener('change', (e) => {
      selectedProjectName = e.target.value;
      if (selectFolderBtn) {
        selectFolderBtn.disabled = !selectedProjectName;
      }
    });
    
  } catch (error) {
    console.error('Error loading projects:', error);
    projectSelect.innerHTML = '<option value="">Error loading projects</option>';
  }
}

/**
 * Refreshes the project selector
 */
async function refreshProjectSelector() {
  console.log('Refreshing project selector...');
  await populateProjectSelector();
}

async function showProjects() {
  console.log('showProjects called');
  
  const projectsDiv = document.getElementById('projects');
  if (!projectsDiv) {
    console.error('Projects div not found! Available elements:', 
      Array.from(document.querySelectorAll('[id]')).map(el => el.id));
    return;
  }

  try {
    const projects = await window.electronAPI.getProjects();
    currentProjects = projects;
    console.log('Projects received:', projects);
    
    if (!projects || !projects.length) {
      projectsDiv.innerHTML = '<h2>Projects</h2><p>No projects found.</p>';
      return;
    }
    
    projectsDiv.innerHTML = '<h2>Projects</h2>' + projects.map(p =>
      `<div class="project-card" data-id="${p.id}">
        <strong>${p.name}</strong> (ID: ${p.id})
        <div class="project-buttons" style="float:right;">
          <button class="commit-task" data-id="${p.id}" data-name="${p.name}" title="Commit task to map">📋 Commit</button>
          <button class="rename-project" data-id="${p.id}" title="Rename project">✏️ Rename</button>
          <button class="delete-project" data-id="${p.id}" title="Delete project">🗑️ Delete</button>
        </div>
        <div style="clear:both;"></div>
      </div>`
    ).join('');

    // Add commit task handlers with mapserver selection
    document.querySelectorAll('.commit-task').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const projectId = btn.dataset.id;
        const projectName = btn.dataset.name;
        
        // Show mapserver selection modal
        const selectedMapServer = await showMapServerSelectionModal();
        if (!selectedMapServer) {
          return; // User cancelled
        }
        
        if (confirm(`Are you sure you want to commit the task for project "${projectName}" to the "${selectedMapServer.display}" mapserver?`)) {
          btn.disabled = true;
          btn.textContent = '⏳ Starting...';
          
          // Show progress container
          const progressContainer = document.getElementById('progressContainer');
          if (progressContainer) progressContainer.style.display = 'block';
          
          try {
            // Use the selected mapserver name
            const result = await window.electronAPI.commitTaskToMap(projectId, selectedMapServer.name);
            
            if (result.success) {
              // Show final success message
              const progressText = document.getElementById('progressText');
              const progressMessage = document.getElementById('progressMessage');
              const progressFill = document.getElementById('progressFill');
              
              if (progressFill) {
                progressFill.style.width = '100%';
                progressFill.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
              }
              if (progressText) progressText.textContent = 'Task committed successfully! (100%)';
              if (progressMessage) progressMessage.textContent = `Orthophoto and shapefile generated for ${selectedMapServer.display}`;
              
              setTimeout(() => {
                alert(`✅ Task committed successfully to ${selectedMapServer.display}!\n\nOrthophoto: ${result.data.orthophotoPath}\nShapefile: ${result.data.shapefilePath}`);
                if (progressContainer) progressContainer.style.display = 'none';
              }, 2000);
            } else {
              // Show error state
              const progressFill = document.getElementById('progressFill');
              const progressText = document.getElementById('progressText');
              const progressMessage = document.getElementById('progressMessage');
              
              if (progressFill) progressFill.style.background = '#dc3545';
              if (progressText) progressText.textContent = 'Task commit failed';
              if (progressMessage) progressMessage.textContent = result.error;
              
              setTimeout(() => {
                alert(`❌ Failed to commit task: ${result.error}`);
                if (progressContainer) progressContainer.style.display = 'none';
              }, 2000);
            }
          } catch (error) {
            console.error('Error committing task:', error);
            
            // Show error state
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            const progressMessage = document.getElementById('progressMessage');
            
            if (progressFill) progressFill.style.background = '#dc3545';
            if (progressText) progressText.textContent = 'Task commit error';
            if (progressMessage) progressMessage.textContent = error.message;
            
            setTimeout(() => {
              alert(`❌ Error committing task: ${error.message}`);
              if (progressContainer) progressContainer.style.display = 'none';
            }, 2000);
          } finally {
            btn.disabled = false;
            btn.textContent = '📋 Commit';
          }
        }
      };
    });
    
    // Attach delete handlers
    document.querySelectorAll('.delete-project').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this project?')) {
          const result = await window.electronAPI.deleteProject(btn.dataset.id);
          if (result.success) {
            showProjects();
            await populateProjectSelector(); // Refresh selector too
          } else {
            alert('Failed to delete project: ' + (result.error || 'Unknown error'));
          }
        }
      };
    });
    
    // Attach rename handlers
    document.querySelectorAll('.rename-project').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const currentProject = currentProjects.find(p => p.id == btn.dataset.id);
        const currentName = currentProject ? currentProject.name : '';
        const newName = await showRenamePrompt(currentName);
        if (newName && newName !== currentName) {
          console.log('Renaming project:', { projectId: btn.dataset.id, newName });
          const result = await window.electronAPI.renameProject({
            projectId: btn.dataset.id,
            newName: newName
          });
          if (result.success) {
            showProjects();
            await populateProjectSelector(); // Refresh selector too
          } else {
            alert('Failed to rename project: ' + (result.error || 'Unknown error'));
            console.error('Rename error details:', result);
          }
        }
      };
    });

    // Attach card click handlers
    document.querySelectorAll('.project-card').forEach(card => {
      card.onclick = (e) => {
        // Prevent click if any button was clicked
        if (e.target.tagName === 'BUTTON') return;
        const projectName = currentProjects.find(p => p.id == card.dataset.id)?.name || 'Unknown';
        showTasks(card.dataset.id, projectName);
      };
    });
  } catch (error) {
    console.error('Error in showProjects:', error);
    projectsDiv.innerHTML = `<h2>Projects</h2><p>Error loading projects: ${error.message}</p>`;
  }
}

async function showTasks(projectId, projectName) {
  const tasksDiv = document.getElementById('tasks');
  if (!tasksDiv) {
    console.error('Tasks div not found!');
    return;
  }

  try {
    const tasks = await window.electronAPI.getTasks(projectId);
    tasksDiv.style.display = 'block';
    tasksDiv.innerHTML = `<h2>Tasks for "${projectName}"</h2>` +
      (tasks.length === 0 ? '<p>No tasks found.</p>' :
        tasks.map(t =>
          `<div class="task-card">
            <strong>${t.name}</strong> (ID: ${t.id})<br>Status: ${t.status}
          </div>`
        ).join('')) +
      `<button id="back-to-projects">Back to Projects</button>`;
    document.getElementById('projects').style.display = 'none';
    document.getElementById('back-to-projects').onclick = () => {
      tasksDiv.style.display = 'none';
      document.getElementById('projects').style.display = 'block';
    };
  } catch (error) {
    console.error('Error in showTasks:', error);
  }
}

function showRenamePrompt(defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');
    const ok = document.getElementById('modal-ok');
    const cancel = document.getElementById('modal-cancel');
    
    if (!overlay || !input || !ok || !cancel) {
      console.error('Modal elements not found!');
      resolve(null);
      return;
    }
    
    input.value = defaultValue || '';
    overlay.style.display = 'block';
    input.focus();

    function cleanup() {
      overlay.style.display = 'none';
      ok.onclick = null;
      cancel.onclick = null;
    }

    ok.onclick = () => {
      cleanup();
      resolve(input.value.trim());
    };
    cancel.onclick = () => {
      cleanup();
      resolve(null);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') ok.onclick();
      if (e.key === 'Escape') cancel.onclick();
    };
  });
}

function showCreateProjectPrompt() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');
    const ok = document.getElementById('modal-ok');
    const cancel = document.getElementById('modal-cancel');
    const title = document.getElementById('modal-title');
    
    if (!overlay || !input || !ok || !cancel || !title) {
      console.error('Modal elements not found!');
      resolve(null);
      return;
    }
    
    // Set up for create mode
    title.textContent = 'Create Project';
    input.value = '';
    input.placeholder = 'Enter new project name';
    overlay.style.display = 'block';
    input.focus();

    function cleanup() {
      overlay.style.display = 'none';
      ok.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
    }

    ok.onclick = () => {
      const val = input.value.trim();
      if (val.length < 3) {
        input.style.borderColor = '#dc3545';
        input.focus();
        return;
      }
      cleanup();
      resolve(val);
    };
    cancel.onclick = () => {
      cleanup();
      resolve(null);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') ok.onclick();
      if (e.key === 'Escape') cancel.onclick();
    };
  });
}

// Handle folder selection
if (selectFolderBtn) {
  selectFolderBtn.addEventListener('click', async () => {
    if (!selectedProjectName) {
      alert('Please select a project first!');
      return;
    }
    
    console.log('Select folder button clicked, project:', selectedProjectName);
    selectFolderBtn.disabled = true;
    if (progressContainer) progressContainer.style.display = 'block';
    if (uploadResult) uploadResult.innerHTML = '';

    try {
      // Pass the selected project name to the main process
      const result = await window.electronAPI.selectFolder(selectedProjectName);
      
      if (result.success) {
        if (uploadResult) uploadResult.innerHTML = `<div class="success">✅ ${result.summary || 'Upload completed!'}</div>`;
        // Refresh both project lists after successful upload
        await populateProjectSelector();
        await showProjects();
      } else {
        if (uploadResult) uploadResult.innerHTML = `<div class="error">❌ Error: ${result.error}</div>`;
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
      if (uploadResult) uploadResult.innerHTML = `<div class="error">❌ Error: ${error.message}</div>`;
    } finally {
      setTimeout(() => {
        selectFolderBtn.disabled = !selectedProjectName; // Re-enable if project is selected
        if (progressContainer) {
          setTimeout(() => progressContainer.style.display = 'none', 3000);
        }
      }, 1000);
    }
  });
}

// Keep only this progress handler (file-based progress)
window.electronAPI.onUploadProgress((data) => {
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const progressMessage = document.getElementById('progressMessage');
  
  if (progressContainer) progressContainer.style.display = 'block';
  
  // Update progress bar
  if (progressFill && data.progress !== undefined) {
    progressFill.style.width = `${data.progress}%`;
  }
  
  // Update text based on stage
  if (progressText) {
    if (data.stage === 'preparing') {
      progressText.textContent = `Preparing files... ${data.filesProcessed || 0}/${data.totalFiles || 0} processed (${data.progress || 0}%)`;
    } else if (data.stage === 'uploading') {
      if (data.bytesUploaded && data.bytesTotal) {
        const mbUploaded = (data.bytesUploaded / 1024 / 1024).toFixed(1);
        const mbTotal = (data.bytesTotal / 1024 / 1024).toFixed(1);
        progressText.textContent = `Uploading... ${mbUploaded}MB / ${mbTotal}MB (${data.progress || 0}%)`;
      } else {
        progressText.textContent = `Uploading ${data.totalFiles || 0} files (${data.progress || 0}%)`;
      }
    } else {
      progressText.textContent = `${data.filesUploaded || 0}/${data.totalFiles || 0} files uploaded (${data.progress || 0}%)`;
    }
  }
  
  if (progressMessage) {
    progressMessage.textContent = data.message || '';
  }
  
  // Change progress bar color based on stage
  if (progressFill) {
    if (data.stage === 'error') {
      progressFill.style.background = '#dc3545';
    } else if (data.stage === 'completed') {
      progressFill.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
    } else if (data.stage === 'preparing') {
      progressFill.style.background = 'linear-gradient(90deg, #ffc107, #fd7e14)';
    } else {
      progressFill.style.background = 'linear-gradient(90deg, #007bff, #17a2b8)';
    }
  }
  
  // Hide progress on completion or error
  if (data.stage === 'completed' || data.stage === 'error') {
    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
    }, 3000);
  }
});

// Enhanced commit progress handler with WebODM stages
window.electronAPI.onCommitProgress((event, data) => {
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const progressMessage = document.getElementById('progressMessage');
  
  if (progressContainer) progressContainer.style.display = 'block';
  
  // Update progress bar
  if (progressFill && data.progress !== undefined) {
    progressFill.style.width = `${data.progress}%`;
  }
  
  // Update text with detailed WebODM information
  if (progressText) {
    if (data.taskProgress !== undefined) {
      progressText.textContent = `WebODM Processing: ${data.taskProgress}% complete (Overall: ${data.progress || 0}%)`;
    } else {
      progressText.textContent = `Task Progress: ${data.progress || 0}%`;
    }
  }
  
  if (progressMessage) {
    progressMessage.textContent = data.message || '';
  }
  
  // Change progress bar color based on stage
  if (progressFill) {
    switch (data.stage) {
      case 'error':
        progressFill.style.background = '#dc3545';
        break;
      case 'completed':
        progressFill.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
        break;
      case 'downloading':
      case 'committing':
        progressFill.style.background = 'linear-gradient(90deg, #ffc107, #fd7e14)';
        break;
      case 'processing':
      case 'monitoring':
        progressFill.style.background = 'linear-gradient(90deg, #007bff, #17a2b8)';
        break;
      case 'warning':
        progressFill.style.background = 'linear-gradient(90deg, #fd7e14, #dc3545)';
        break;
      default:
        progressFill.style.background = 'linear-gradient(90deg, #6c757d, #495057)';
    }
  }
});

// Add WebODM progress handler
window.electronAPI.onWebODMProgress((data) => {
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const progressMessage = document.getElementById('progressMessage');
  
  if (progressContainer) progressContainer.style.display = 'block';
  
  // Update progress bar
  if (progressFill && data.progress !== undefined) {
    progressFill.style.width = `${data.progress}%`;
  }
  
  // Update text with WebODM-specific information
  if (progressText) {
    progressText.textContent = `WebODM Processing: ${data.progress || 0}%`;
  }
  
  if (progressMessage) {
    progressMessage.textContent = data.message || '';
  }
  
  // Style progress bar based on WebODM stage
  if (progressFill) {
    switch (data.stage) {
      case 'processing':
        progressFill.style.background = 'linear-gradient(90deg, #007bff, #17a2b8)';
        progressContainer.setAttribute('data-stage', 'processing');
        break;
      case 'completed':
        progressFill.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
        progressContainer.setAttribute('data-stage', 'completed');
        break;
      case 'error':
        progressFill.style.background = 'linear-gradient(90deg, #dc3545, #c82333)';
        progressContainer.setAttribute('data-stage', 'error');
        break;
      default:
        progressFill.style.background = 'linear-gradient(90deg, #6c757d, #495057)';
    }
  }
  
  // Auto-hide progress on completion or error after delay
  if (data.stage === 'completed' || data.stage === 'error') {
    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
    }, 5000);
  }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded');
  
  // Get UI elements
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  const refreshProjectsBtn = document.getElementById('refreshProjectsBtn');
  const refreshProjectSelect = document.getElementById('refreshProjectSelect');
  const uploadResult = document.getElementById('uploadResult');
  const progressContainer = document.getElementById('progressContainer');

  let progressCleanup = null;

  // Initialize project selector
  populateProjectSelector();

  // Handle project selector refresh
  if (refreshProjectSelect) {
    refreshProjectSelect.addEventListener('click', refreshProjectSelector);
  }

  // Handle refresh projects (update to also refresh selector)
  if (refreshProjectsBtn) {
    refreshProjectsBtn.addEventListener('click', async () => {
      console.log('Refresh projects clicked');
      await showProjects();
      await populateProjectSelector();
    });
  }

  // Initialize projects
  setTimeout(showProjects, 100);

  const createProjectBtn = document.getElementById('createProjectBtn');
  if (createProjectBtn) {
    createProjectBtn.addEventListener('click', async () => {
      const projectName = await showCreateProjectPrompt();
      if (projectName) {
        const result = await window.electronAPI.createProject(projectName);
        if (result.success) {
          await showProjects();
          await populateProjectSelector();
        } else {
          alert('Failed to create project: ' + (result.error || 'Unknown error'));
        }
      }
    });
  }
});

// Add this function to get mapservers from your JSON file
function populateMapServerSelector() {
  // Simple hardcoded list matching your map_mappings.json
  const mapServers = [
    { name: 'gefarm', display: 'GE Farm (Local Demo)' },
    { name: 'test_map', display: 'Test Map (Local Demo)' }
  ];
  return mapServers;
}

// Add this function to show the mapserver selection modal
function showMapServerSelectionModal() {
  return new Promise((resolve) => {
    const mapServers = populateMapServerSelector();
    
    // Create modal HTML
    const modalHTML = `
      <div id="mapserver-modal-overlay" style="
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.4);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div class="modal-content" style="
          background: white;
          padding: 20px;
          border-radius: 8px;
          min-width: 400px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        ">
          <h3>Select MapServer Destination</h3>
          <p>Choose which mapserver to deploy the orthophoto and shapefile to:</p>
          <select id="mapserver-select" style="
            width: 100%;
            padding: 8px;
            margin: 10px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
          ">
            <option value="">-- Select MapServer --</option>
            ${mapServers.map(ms => `<option value="${ms.name}">${ms.display}</option>`).join('')}
          </select>
          <div class="modal-buttons" style="
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 15px;
          ">
            <button id="mapserver-cancel" style="
              padding: 8px 16px;
              background: #6c757d;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">Cancel</button>
            <button id="mapserver-ok" style="
              padding: 8px 16px;
              background: #007bff;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">Commit</button>
          </div>
        </div>
      </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const overlay = document.getElementById('mapserver-modal-overlay');
    const select = document.getElementById('mapserver-select');
    const okBtn = document.getElementById('mapserver-ok');
    const cancelBtn = document.getElementById('mapserver-cancel');
    
    function cleanup() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }
    
    okBtn.onclick = () => {
      const selectedValue = select.value;
      if (!selectedValue) {
        select.style.borderColor = '#dc3545';
        return;
      }
      
      const selectedMapServer = mapServers.find(ms => ms.name === selectedValue);
      cleanup();
      resolve(selectedMapServer);
    };
    
    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };
    
    // Reset border color when user selects something
    select.onchange = () => {
      select.style.borderColor = '#ddd';
    };
  });
}