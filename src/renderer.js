document.getElementById('select-folder').onclick = async () => {
  console.log('select-folder button clicked');
  const folderPath = await window.electronAPI.selectFolder();
  console.log('Selected folder:', folderPath);
};

async function showProjects() {
  const projects = await window.electronAPI.getProjects();
  const projectsDiv = document.getElementById('projects');
  if (!projects.length) {
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

  // Attach delete and rename handlers first
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
  document.querySelectorAll('.rename-project').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const newName = await showRenamePrompt('');
      if (newName) {
        const result = await window.electronAPI.renameProject(btn.dataset.id, newName);
        if (result.success) {
          showProjects();
        } else {
          alert('Failed to rename project: ' + (result.error || 'Unknown error'));
        }
      }
    };
  });

  // Then attach the card click handler
  document.querySelectorAll('.project-card').forEach(card => {
    card.onclick = (e) => {
      // Prevent click if delete or rename button was clicked
      if (e.target.classList.contains('delete-project') || e.target.classList.contains('rename-project')) return;
      showTasks(card.dataset.id, card.textContent);
    };
  });
}

async function showTasks(projectId, projectName) {
  const tasks = await window.electronAPI.getTasks(projectId);
  const tasksDiv = document.getElementById('tasks');
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
}

function showRenamePrompt(defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');
    const ok = document.getElementById('modal-ok');
    const cancel = document.getElementById('modal-cancel');
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

showProjects();