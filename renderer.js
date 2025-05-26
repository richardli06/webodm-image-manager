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
    currentProjects = projects; // Store for later use
    console.log('Projects received:', projects);
    
    if (!projects || !projects.length) {
      projectsDiv.innerHTML = '<h2>Projects</h2><p>No projects found.</p>';
      return;
    }
    
    projectsDiv.innerHTML = '<h2>Projects</h2>' + projects.map(p =>
      `<div class="project-card" data-id="${p.id}">
        <strong>${p.name}</strong> (ID: ${p.id})
        <button class="rename-project" data-id="${p.id}" style="float:right;margin-left:10px;">Rename</button>
        <button class="delete-project" data-id="${p.id}" style="float:right;margin-left:10px;">Delete</button>
      </div>`
    ).join('');

    // Attach delete handlers
    document.querySelectorAll('.delete-project').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this project?')) {
          const result = await window.electronAPI.deleteProject(btn.dataset.id);
          if (result.success) {
            showProjects();
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
        // Prevent click if delete or rename button was clicked
        if (e.target.classList.contains('delete-project') || e.target.classList.contains('rename-project')) return;
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

function updateProgress(data) {
  console.log('Progress update:', data);
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const progressMessage = document.getElementById('progressMessage');
  
  if (!progressFill || !progressText || !progressMessage) return;
  
  const { stage, totalFiles, currentBatch, totalBatches, filesUploaded, message } = data;
  
  // Calculate progress percentage
  let progressPercent = 0;
  if (totalBatches > 0) {
    progressPercent = Math.round((currentBatch / totalBatches) * 100);
  }
  
  // Update progress bar
  progressFill.style.width = `${progressPercent}%`;
  
  // Update text
  if (totalFiles && totalBatches) {
    progressText.textContent = `Batch ${currentBatch || 0}/${totalBatches} - ${filesUploaded || 0}/${totalFiles} files uploaded (${progressPercent}%)`;
  } else {
    progressText.textContent = message || 'Processing...';
  }
  
  // Update message
  progressMessage.textContent = message || '';
  
  // Change color based on stage
  if (stage === 'error') {
    progressFill.style.background = '#dc3545';
  } else if (stage === 'completed') {
    progressFill.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
    progressFill.style.width = '100%';
  } else {
    progressFill.style.background = 'linear-gradient(90deg, #007bff, #17a2b8)';
  }
}

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

  // Handle folder selection (updated to use selected project)
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

      // Set up progress listener
      if (window.electronAPI?.onUploadProgress) {
        progressCleanup = window.electronAPI.onUploadProgress(updateProgress);
      }

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
        if (progressCleanup) progressCleanup();
        setTimeout(() => {
          selectFolderBtn.disabled = !selectedProjectName; // Re-enable if project is selected
          if (progressContainer) {
            setTimeout(() => progressContainer.style.display = 'none', 3000);
          }
        }, 1000);
      }
    });
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
});