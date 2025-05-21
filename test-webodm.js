// test-webodm.js
require('dotenv').config();
const axios = require('axios');

const username = process.env.WEBODM_USERNAME;
const password = process.env.WEBODM_PASSWORD;

async function testWebODM() {
  try {
    // 1. Get API token
    const tokenRes = await axios.post('http://localhost:8000/api/token-auth/', {
      username,
      password
    });
    const apiToken = tokenRes.data.token;
    console.log('Got API token:', apiToken);

    // 2. Use JWT in Authorization header for project creation
    const projectRes = await axios.post(
      'http://localhost:8000/api/projects/',
      { name: 'Hello WebODM!' },
      {
        headers: {
          'Authorization': `JWT ${apiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const projectId = projectRes.data.id;
    console.log('Created project with ID:', projectId);

    // 3. (Optional) List projects to verify
    const projectsRes = await axios.get('http://localhost:8000/api/projects/', {
      headers: {
        'Authorization': `JWT ${apiToken}`
      }
    });
    console.log('Projects:', projectsRes.data);

  } catch (err) {
    console.error('Error:', err.message, err.code, err.response && err.response.status, err.response && err.response.data);
  }
}

testWebODM();