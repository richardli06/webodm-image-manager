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
    </div>`
  ).join('');
  document.querySelectorAll('.project-card').forEach(card => {
    card.onclick = () => showTasks(card.dataset.id, card.textContent);
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

showProjects();