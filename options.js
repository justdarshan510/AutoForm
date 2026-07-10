// Options page controller

// Mock chrome extension storage for local preview (file:// protocol)
if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.storage = {
    local: {
      get: (keys, callback) => {
        const mockData = {
          profiles: [
            {
              id: 'prof_default',
              profileName: 'Default Profile (Demo)',
              firstName: 'John',
              lastName: 'Doe',
              fullName: 'John Doe',
              email: 'john@example.com',
              phone: '+1 555 123 4567',
              address: {
                street: '123 Main St',
                city: 'San Francisco',
                country: 'United States'
              }
            }
          ],
          currentProfileId: 'prof_default',
          apiSettings: { key: '' }
        };
        setTimeout(() => callback(mockData), 0);
      },
      set: (data, callback) => {
        console.log("Mock Storage Set:", data);
        if (callback) setTimeout(callback, 0);
      }
    }
  };
}

// Global state
let profiles = [];
let currentProfileId = null;
let apiSettings = { key: '' };

// DOM Elements
const navButtons = document.querySelectorAll('.nav-btn');
const tabSections = document.querySelectorAll('.tab-section');
const profileSelect = document.getElementById('profile-select');
const btnNewProfile = document.getElementById('btn-new-profile');
const btnDeleteProfile = document.getElementById('btn-delete-profile');
const profileForm = document.getElementById('profile-form');
const saveStatus = document.getElementById('save-status');

// Repeaters
const educationList = document.getElementById('education-list');
const btnAddEdu = document.getElementById('btn-add-edu');
const experienceList = document.getElementById('experience-list');
const btnAddExp = document.getElementById('btn-add-exp');
const projectsList = document.getElementById('projects-list');
const btnAddProj = document.getElementById('btn-add-proj');
const qaList = document.getElementById('qa-list');
const btnAddQa = document.getElementById('btn-add-qa');

// AI elements
const btnAiParse = document.getElementById('btn-ai-parse');
const aiResumeInput = document.getElementById('ai-resume-input');
const aiParseLoader = document.getElementById('ai-parse-loader');

// Files elements
const resumeFileInput = document.getElementById('doc-resume-file-input');
const resumeFileStatus = document.getElementById('resume-file-status');
const btnClearResumeFile = document.getElementById('btn-clear-resume-file');
const coverFileInput = document.getElementById('doc-cover-file-input');
const coverFileStatus = document.getElementById('cover-file-status');
const btnClearCoverFile = document.getElementById('btn-clear-cover-file');

// Settings elements
const apiKeyInput = document.getElementById('settings-api-key');
const btnToggleKeyVisibility = document.getElementById('btn-toggle-key-visibility');
const btnTestApi = document.getElementById('btn-test-api');
const apiTestStatus = document.getElementById('api-test-status');
const btnExportData = document.getElementById('btn-export-data');
const btnImportData = document.getElementById('btn-import-data');
const importFileInput = document.getElementById('import-file-input');
const backupStatus = document.getElementById('backup-status');

// Temporary file placeholders
let currentResumeFileData = null;
let currentCoverFileData = null;

// Initialize Options Page
document.addEventListener('DOMContentLoaded', async () => {
  await loadFromStorage();
  setupTabNavigation();
  setupProfileDropdown();
  setupRepeaterAdders();
  setupFileHandlers();
  setupSettingsHandlers();
  setupAiImportHandlers();
  
  // Form submission
  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveProfile();
  });
});

// Load all settings & profiles from storage
async function loadFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['profiles', 'currentProfileId', 'apiSettings'], (result) => {
      profiles = result.profiles || [];
      currentProfileId = result.currentProfileId || null;
      apiSettings = result.apiSettings || { key: '' };
      
      // Setup default if empty
      if (profiles.length === 0) {
        const defaultProfile = createEmptyProfile("Default Profile");
        profiles.push(defaultProfile);
        currentProfileId = defaultProfile.id;
      }
      
      if (!currentProfileId && profiles.length > 0) {
        currentProfileId = profiles[0].id;
      }
      
      // Populate fields
      apiKeyInput.value = apiSettings.key;
      resolve();
    });
  });
}

function createEmptyProfile(name) {
  return {
    id: 'prof_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    profileName: name,
    firstName: '',
    lastName: '',
    fullName: '',
    email: '',
    phone: '',
    dob: '',
    gender: '',
    nationality: '',
    address: {
      street: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    },
    linkedin: '',
    github: '',
    portfolio: '',
    skills: '',
    languages: '',
    achievements: '',
    resumeText: '',
    resumeFile: null,  // { name: '', data: 'base64...', type: '' }
    coverFile: null,   // { name: '', data: 'base64...', type: '' }
    education: [],
    experience: [],
    projects: [],
    customQA: []
  };
}

// Tab navigation
function setupTabNavigation() {
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      navButtons.forEach(b => b.classList.remove('active'));
      tabSections.forEach(t => t.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

// Profile dropdown & profile selection
function setupProfileDropdown() {
  renderProfileDropdown();
  
  profileSelect.addEventListener('change', () => {
    currentProfileId = profileSelect.value;
    chrome.storage.local.set({ currentProfileId });
    populateProfileForm();
  });
  
  btnNewProfile.addEventListener('click', () => {
    const name = prompt("Enter a name for the new profile:");
    if (!name) return;
    const newProf = createEmptyProfile(name);
    profiles.push(newProf);
    currentProfileId = newProf.id;
    saveAllProfilesToStorage();
    renderProfileDropdown();
    populateProfileForm();
  });
  
  btnDeleteProfile.addEventListener('click', () => {
    if (profiles.length <= 1) {
      alert("You must keep at least one profile.");
      return;
    }
    if (!confirm("Are you sure you want to delete this profile? This cannot be undone.")) return;
    
    profiles = profiles.filter(p => p.id !== currentProfileId);
    currentProfileId = profiles[0].id;
    saveAllProfilesToStorage();
    renderProfileDropdown();
    populateProfileForm();
  });

  populateProfileForm();
}

function renderProfileDropdown() {
  profileSelect.innerHTML = '';
  profiles.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.profileName;
    if (p.id === currentProfileId) option.selected = true;
    profileSelect.appendChild(option);
  });
}

function populateProfileForm() {
  const profile = profiles.find(p => p.id === currentProfileId);
  if (!profile) return;
  
  // Direct text/select inputs
  document.getElementById('prof-name').value = profile.profileName || '';
  document.getElementById('pers-fname').value = profile.firstName || '';
  document.getElementById('pers-lname').value = profile.lastName || '';
  document.getElementById('pers-fullname').value = profile.fullName || '';
  document.getElementById('pers-email').value = profile.email || '';
  document.getElementById('pers-phone').value = profile.phone || '';
  document.getElementById('pers-dob').value = profile.dob || '';
  document.getElementById('pers-gender').value = profile.gender || '';
  document.getElementById('pers-nationality').value = profile.nationality || '';
  
  document.getElementById('addr-street').value = profile.address?.street || '';
  document.getElementById('addr-line2').value = profile.address?.line2 || '';
  document.getElementById('addr-city').value = profile.address?.city || '';
  document.getElementById('addr-state').value = profile.address?.state || '';
  document.getElementById('addr-zip').value = profile.address?.zip || '';
  document.getElementById('addr-country').value = profile.address?.country || '';
  
  document.getElementById('link-linkedin').value = profile.linkedin || '';
  document.getElementById('link-github').value = profile.github || '';
  document.getElementById('link-portfolio').value = profile.portfolio || '';
  
  document.getElementById('prof-skills').value = profile.skills || '';
  document.getElementById('prof-languages').value = profile.languages || '';
  document.getElementById('prof-achievements').value = profile.achievements || '';
  document.getElementById('doc-resume-text').value = profile.resumeText || '';
  
  // Files
  currentResumeFileData = profile.resumeFile || null;
  if (currentResumeFileData) {
    resumeFileStatus.textContent = `Attached: ${currentResumeFileData.name}`;
    btnClearResumeFile.classList.remove('hidden');
  } else {
    resumeFileStatus.textContent = "No resume file uploaded yet";
    btnClearResumeFile.classList.add('hidden');
    resumeFileInput.value = '';
  }
  
  currentCoverFileData = profile.coverFile || null;
  if (currentCoverFileData) {
    coverFileStatus.textContent = `Attached: ${currentCoverFileData.name}`;
    btnClearCoverFile.classList.remove('hidden');
  } else {
    coverFileStatus.textContent = "No cover letter file uploaded yet";
    btnClearCoverFile.classList.add('hidden');
    coverFileInput.value = '';
  }

  // Clear and rebuild repeaters
  educationList.innerHTML = '';
  (profile.education || []).forEach(edu => addEducationRow(edu));
  
  experienceList.innerHTML = '';
  (profile.experience || []).forEach(exp => addExperienceRow(exp));
  
  projectsList.innerHTML = '';
  (profile.projects || []).forEach(proj => addProjectRow(proj));
  
  qaList.innerHTML = '';
  (profile.customQA || []).forEach(qa => addQaRow(qa));
}

// Repeater Adders
function setupRepeaterAdders() {
  btnAddEdu.addEventListener('click', () => addEducationRow());
  btnAddExp.addEventListener('click', () => addExperienceRow());
  btnAddProj.addEventListener('click', () => addProjectRow());
  btnAddQa.addEventListener('click', () => addQaRow());
}

function addEducationRow(data = {}) {
  const div = document.createElement('div');
  div.className = 'repeater-item education-item';
  div.innerHTML = `
    <div class="repeater-item-header">
      <span class="repeater-item-title">School Entry</span>
      <button type="button" class="btn btn-danger btn-sm btn-remove-item">Remove</button>
    </div>
    <div class="grid-2">
      <div class="form-group">
        <label>School / University</label>
        <input type="text" class="edu-school" value="${data.school || ''}">
      </div>
      <div class="form-group">
        <label>Degree</label>
        <input type="text" class="edu-degree" value="${data.degree || ''}" placeholder="e.g. Bachelor of Science">
      </div>
      <div class="form-group">
        <label>Major / Field of Study</label>
        <input type="text" class="edu-major" value="${data.major || ''}" placeholder="e.g. Computer Science">
      </div>
      <div class="form-group">
        <label>GPA / Grade</label>
        <input type="text" class="edu-gpa" value="${data.gpa || ''}" placeholder="e.g. 3.8/4.0">
      </div>
      <div class="form-group">
        <label>Start Year</label>
        <input type="text" class="edu-start" value="${data.startYear || ''}" placeholder="e.g. 2021">
      </div>
      <div class="form-group">
        <label>End Year (or Expected)</label>
        <input type="text" class="edu-end" value="${data.endYear || ''}" placeholder="e.g. 2025">
      </div>
    </div>
  `;
  div.querySelector('.btn-remove-item').addEventListener('click', () => div.remove());
  educationList.appendChild(div);
}

function addExperienceRow(data = {}) {
  const div = document.createElement('div');
  div.className = 'repeater-item experience-item';
  div.innerHTML = `
    <div class="repeater-item-header">
      <span class="repeater-item-title">Job Entry</span>
      <button type="button" class="btn btn-danger btn-sm btn-remove-item">Remove</button>
    </div>
    <div class="grid-2">
      <div class="form-group">
        <label>Company</label>
        <input type="text" class="exp-company" value="${data.company || ''}">
      </div>
      <div class="form-group">
        <label>Job Title</label>
        <input type="text" class="exp-title" value="${data.title || ''}">
      </div>
      <div class="form-group">
        <label>Location</label>
        <input type="text" class="exp-location" value="${data.location || ''}" placeholder="e.g. San Francisco, CA">
      </div>
      <div class="form-group">
        <label>Start Date</label>
        <input type="text" class="exp-start" value="${data.startDate || ''}" placeholder="e.g. June 2022">
      </div>
      <div class="form-group">
        <label>End Date</label>
        <input type="text" class="exp-end" value="${data.endDate || ''}" placeholder="e.g. Present">
      </div>
      <div class="form-group grid-span-2">
        <label>Description / Achievements</label>
        <textarea class="exp-desc" placeholder="Responsibilities and accomplishments...">${data.description || ''}</textarea>
      </div>
    </div>
  `;
  div.querySelector('.btn-remove-item').addEventListener('click', () => div.remove());
  experienceList.appendChild(div);
}

function addProjectRow(data = {}) {
  const div = document.createElement('div');
  div.className = 'repeater-item project-item';
  div.innerHTML = `
    <div class="repeater-item-header">
      <span class="repeater-item-title">Project Entry</span>
      <button type="button" class="btn btn-danger btn-sm btn-remove-item">Remove</button>
    </div>
    <div class="grid-2">
      <div class="form-group">
        <label>Project Title</label>
        <input type="text" class="proj-title" value="${data.title || ''}">
      </div>
      <div class="form-group">
        <label>Project Link / Repository</label>
        <input type="url" class="proj-link" value="${data.link || ''}" placeholder="https://github.com/...">
      </div>
      <div class="form-group grid-span-2">
        <label>Technologies Used (comma separated)</label>
        <input type="text" class="proj-tech" value="${(data.technologies || []).join(', ')}" placeholder="React, Node.js, Webpack">
      </div>
      <div class="form-group grid-span-2">
        <label>Project Description</label>
        <textarea class="proj-desc" placeholder="Summarize your work and outcomes...">${data.description || ''}</textarea>
      </div>
    </div>
  `;
  div.querySelector('.btn-remove-item').addEventListener('click', () => div.remove());
  projectsList.appendChild(div);
}

function addQaRow(data = {}) {
  const div = document.createElement('div');
  div.className = 'repeater-item qa-item';
  div.innerHTML = `
    <div class="repeater-item-header">
      <span class="repeater-item-title">Question & Answer Pair</span>
      <button type="button" class="btn btn-danger btn-sm btn-remove-item">Remove</button>
    </div>
    <div class="form-group">
      <label>Question Context or Keywords (e.g. "Why join", "Weaknesses")</label>
      <input type="text" class="qa-key" value="${data.question || ''}" placeholder="e.g. Why should we hire you?">
    </div>
    <div class="form-group" style="margin-top:0.75rem;">
      <label>Predefined Answer Text</label>
      <textarea class="qa-val" placeholder="Your pre-written response...">${data.answer || ''}</textarea>
    </div>
  `;
  div.querySelector('.btn-remove-item').addEventListener('click', () => div.remove());
  qaList.appendChild(div);
}

// File uploads -> Base64
function setupFileHandlers() {
  resumeFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      currentResumeFileData = {
        name: file.name,
        data: reader.result,
        type: file.type
      };
      resumeFileStatus.textContent = `Attached: ${file.name}`;
      btnClearResumeFile.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  
  btnClearResumeFile.addEventListener('click', () => {
    currentResumeFileData = null;
    resumeFileStatus.textContent = "No resume file uploaded yet";
    btnClearResumeFile.classList.add('hidden');
    resumeFileInput.value = '';
  });

  coverFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      currentCoverFileData = {
        name: file.name,
        data: reader.result,
        type: file.type
      };
      coverFileStatus.textContent = `Attached: ${file.name}`;
      btnClearCoverFile.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });
  
  btnClearCoverFile.addEventListener('click', () => {
    currentCoverFileData = null;
    coverFileStatus.textContent = "No cover letter file uploaded yet";
    btnClearCoverFile.classList.add('hidden');
    coverFileInput.value = '';
  });
}

// AI Resume Parser
function setupAiImportHandlers() {
  btnAiParse.addEventListener('click', async () => {
    const text = aiResumeInput.value.trim();
    if (!text) {
      alert("Please paste some resume text first.");
      return;
    }
    
    if (!apiSettings.key) {
      alert("Please set and save your Gemini API Key in the Settings tab first.");
      return;
    }
    
    btnAiParse.disabled = true;
    aiParseLoader.classList.remove('hidden');
    
    try {
      const parsedData = await AiHelper.parseResume(apiSettings.key, text);
      if (parsedData) {
        mergeParsedDataIntoUI(parsedData, text);
        alert("Autofill Complete! Review the imported fields below and click 'Save Profile'.");
      }
    } catch (err) {
      console.error(err);
      alert(`AI parsing failed: ${err.message}`);
    } finally {
      btnAiParse.disabled = false;
      aiParseLoader.classList.add('hidden');
    }
  });
}

function mergeParsedDataIntoUI(data, originalText) {
  if (data.firstName) document.getElementById('pers-fname').value = data.firstName;
  if (data.lastName) document.getElementById('pers-lname').value = data.lastName;
  if (data.fullName) document.getElementById('pers-fullname').value = data.fullName;
  if (data.email) document.getElementById('pers-email').value = data.email;
  if (data.phone) document.getElementById('pers-phone').value = data.phone;
  if (data.dob) document.getElementById('pers-dob').value = data.dob;
  if (data.gender) document.getElementById('pers-gender').value = data.gender;
  if (data.nationality) document.getElementById('pers-nationality').value = data.nationality;
  
  if (data.address) {
    if (data.address.street) document.getElementById('addr-street').value = data.address.street;
    if (data.address.line2) document.getElementById('addr-line2').value = data.address.line2;
    if (data.address.city) document.getElementById('addr-city').value = data.address.city;
    if (data.address.state) document.getElementById('addr-state').value = data.address.state;
    if (data.address.zip) document.getElementById('addr-zip').value = data.address.zip;
    if (data.address.country) document.getElementById('addr-country').value = data.address.country;
  }
  
  if (data.github) document.getElementById('link-github').value = data.github;
  if (data.linkedin) document.getElementById('link-linkedin').value = data.linkedin;
  if (data.portfolio) document.getElementById('link-portfolio').value = data.portfolio;
  
  if (data.skills) {
    document.getElementById('prof-skills').value = Array.isArray(data.skills) ? data.skills.join(', ') : data.skills;
  }
  if (data.languages) {
    document.getElementById('prof-languages').value = Array.isArray(data.languages) ? data.languages.join(', ') : data.languages;
  }
  if (data.achievements) {
    document.getElementById('prof-achievements').value = Array.isArray(data.achievements) ? data.achievements.join('\n') : data.achievements;
  }
  
  document.getElementById('doc-resume-text').value = originalText;
  
  // Education List
  if (data.education && data.education.length > 0) {
    educationList.innerHTML = '';
    data.education.forEach(edu => addEducationRow(edu));
  }
  
  // Experience List
  if (data.experience && data.experience.length > 0) {
    experienceList.innerHTML = '';
    data.experience.forEach(exp => addExperienceRow(exp));
  }
  
  // Projects List
  if (data.projects && data.projects.length > 0) {
    projectsList.innerHTML = '';
    data.projects.forEach(proj => addProjectRow(proj));
  }
}

// Save active profile
function saveProfile() {
  const profileIndex = profiles.findIndex(p => p.id === currentProfileId);
  if (profileIndex === -1) return;
  
  const updatedProfile = {
    id: currentProfileId,
    profileName: document.getElementById('prof-name').value,
    firstName: document.getElementById('pers-fname').value,
    lastName: document.getElementById('pers-lname').value,
    fullName: document.getElementById('pers-fullname').value,
    email: document.getElementById('pers-email').value,
    phone: document.getElementById('pers-phone').value,
    dob: document.getElementById('pers-dob').value,
    gender: document.getElementById('pers-gender').value,
    nationality: document.getElementById('pers-nationality').value,
    address: {
      street: document.getElementById('addr-street').value,
      line2: document.getElementById('addr-line2').value,
      city: document.getElementById('addr-city').value,
      state: document.getElementById('addr-state').value,
      zip: document.getElementById('addr-zip').value,
      country: document.getElementById('addr-country').value
    },
    linkedin: document.getElementById('link-linkedin').value,
    github: document.getElementById('link-github').value,
    portfolio: document.getElementById('link-portfolio').value,
    skills: document.getElementById('prof-skills').value,
    languages: document.getElementById('prof-languages').value,
    achievements: document.getElementById('prof-achievements').value,
    resumeText: document.getElementById('doc-resume-text').value,
    resumeFile: currentResumeFileData,
    coverFile: currentCoverFileData,
    education: gatherEducationData(),
    experience: gatherExperienceData(),
    projects: gatherProjectsData(),
    customQA: gatherQaData()
  };
  
  profiles[profileIndex] = updatedProfile;
  saveAllProfilesToStorage();
  renderProfileDropdown();
  
  // Show save status
  saveStatus.classList.remove('hidden');
  setTimeout(() => saveStatus.classList.add('hidden'), 2000);
}

function gatherEducationData() {
  const list = [];
  document.querySelectorAll('.education-item').forEach(row => {
    list.push({
      school: row.querySelector('.edu-school').value,
      degree: row.querySelector('.edu-degree').value,
      major: row.querySelector('.edu-major').value,
      gpa: row.querySelector('.edu-gpa').value,
      startYear: row.querySelector('.edu-start').value,
      endYear: row.querySelector('.edu-end').value
    });
  });
  return list;
}

function gatherExperienceData() {
  const list = [];
  document.querySelectorAll('.experience-item').forEach(row => {
    list.push({
      company: row.querySelector('.exp-company').value,
      title: row.querySelector('.exp-title').value,
      location: row.querySelector('.exp-location').value,
      startDate: row.querySelector('.exp-start').value,
      endDate: row.querySelector('.exp-end').value,
      description: row.querySelector('.exp-desc').value
    });
  });
  return list;
}

function gatherProjectsData() {
  const list = [];
  document.querySelectorAll('.project-item').forEach(row => {
    const techText = row.querySelector('.proj-tech').value;
    const techArray = techText.split(',').map(s => s.trim()).filter(s => s);
    list.push({
      title: row.querySelector('.proj-title').value,
      link: row.querySelector('.proj-link').value,
      technologies: techArray,
      description: row.querySelector('.proj-desc').value
    });
  });
  return list;
}

function gatherQaData() {
  const list = [];
  document.querySelectorAll('.qa-item').forEach(row => {
    list.push({
      question: row.querySelector('.qa-key').value,
      answer: row.querySelector('.qa-val').value
    });
  });
  return list;
}

function saveAllProfilesToStorage() {
  chrome.storage.local.set({ profiles, currentProfileId });
}

// Settings tab actions
function setupSettingsHandlers() {
  // Save API key automatically as the user types/pastes it
  apiKeyInput.addEventListener('input', () => {
    apiSettings.key = apiKeyInput.value.trim();
    chrome.storage.local.set({ apiSettings });
  });

  // Toggle key visibility
  btnToggleKeyVisibility.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      btnToggleKeyVisibility.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      btnToggleKeyVisibility.textContent = 'Show';
    }
  });
  
  // Test connection
  btnTestApi.addEventListener('click', async () => {
    const testKey = apiKeyInput.value.trim();
    if (!testKey) {
      apiTestStatus.textContent = "Please input a key first";
      apiTestStatus.className = "api-test-status error";
      return;
    }
    
    btnTestApi.disabled = true;
    apiTestStatus.textContent = "Connecting to Gemini API...";
    apiTestStatus.className = "api-test-status";
    
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${testKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Respond with the word 'SUCCESS' only." }] }]
        })
      });
      
      if (!response.ok) throw new Error("Verification failed");
      const data = await response.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      if (txt.includes('SUCCESS')) {
        apiTestStatus.textContent = "Connection Successful! Gemini API is active.";
        apiTestStatus.className = "api-test-status success";
        
        // Save the key
        apiSettings.key = testKey;
        chrome.storage.local.set({ apiSettings });
      } else {
        throw new Error("Invalid response contents");
      }
    } catch (err) {
      console.error(err);
      apiTestStatus.textContent = "Connection Failed. Verify key and network connection.";
      apiTestStatus.className = "api-test-status error";
    } finally {
      btnTestApi.disabled = false;
    }
  });

  // Backup handlers
  btnExportData.addEventListener('click', () => {
    chrome.storage.local.get(null, (allData) => {
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `applypilot_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      backupStatus.textContent = "Backup downloaded.";
      backupStatus.className = "backup-status success";
    });
  });

  btnImportData.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (!data.profiles || !Array.isArray(data.profiles)) {
          throw new Error("Invalid backup file: profiles array missing");
        }
        await new Promise((resolve) => chrome.storage.local.set(data, resolve));
        backupStatus.textContent = "Backup imported successfully. Reloading...";
        backupStatus.className = "backup-status success";
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        alert("Import failed: " + err.message);
        backupStatus.textContent = "Import failed.";
        backupStatus.className = "backup-status error";
      }
    };
    reader.readAsText(file);
  });
}
