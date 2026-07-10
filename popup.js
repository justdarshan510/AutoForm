// Popup controller for ApplyPilot

let activeProfiles = [];
let currentProfileId = null;

// DOM Elements
const profileSelect = document.getElementById('popup-profile-select');
const statusBadge = document.getElementById('status-badge');
const currentStepVal = document.getElementById('current-step');
const confidenceVal = document.getElementById('confidence-score');
const statusMsg = document.getElementById('status-msg');
const errorCard = document.getElementById('error-card');
const errorText = document.getElementById('error-text');

// Controls panels
const btnStart = document.getElementById('btn-start');
const runningControls = document.getElementById('running-controls');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const pausedControls = document.getElementById('paused-controls');
const btnResume = document.getElementById('btn-resume');
const btnStopPaused = document.getElementById('btn-stop-paused');
const confirmControls = document.getElementById('confirm-controls');
const btnProceed = document.getElementById('btn-proceed');
const linkOptions = document.getElementById('link-options');

document.addEventListener('DOMContentLoaded', async () => {
  // Setup options link
  linkOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Load profiles from storage
  await loadProfiles();

  // Initial State Query from background
  queryState();

  // Start automation
  btnStart.addEventListener('click', async () => {
    const selectedProfileId = profileSelect.value;
    if (!selectedProfileId) {
      alert("Please create a profile first in settings.");
      return;
    }
    const tab = await getActiveTab();
    if (!tab) return;

    chrome.runtime.sendMessage({
      action: 'START_AUTOMATION',
      tabId: tab.id,
      profileId: selectedProfileId
    });
  });

  // Pause
  btnPause.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab) chrome.runtime.sendMessage({ action: 'PAUSE_AUTOMATION', tabId: tab.id });
  });

  // Resume
  btnResume.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab) chrome.runtime.sendMessage({ action: 'RESUME_AUTOMATION', tabId: tab.id });
  });

  // Stop
  const stopHandler = async () => {
    const tab = await getActiveTab();
    if (tab) chrome.runtime.sendMessage({ action: 'STOP_AUTOMATION', tabId: tab.id });
  };
  btnStop.addEventListener('click', stopHandler);
  btnStopPaused.addEventListener('click', stopHandler);

  // Proceed / Review confirmation
  btnProceed.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab) chrome.runtime.sendMessage({ action: 'PROCEED_AUTOMATION', tabId: tab.id });
  });

  // Sync profile selection change
  profileSelect.addEventListener('change', () => {
    currentProfileId = profileSelect.value;
    chrome.storage.local.set({ currentProfileId });
  });

  // Listen for real-time status updates from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'STATE_UPDATE') {
      updateUI(message.state);
    }
  });
});

async function loadProfiles() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['profiles', 'currentProfileId'], (result) => {
      activeProfiles = result.profiles || [];
      currentProfileId = result.currentProfileId || null;

      profileSelect.innerHTML = '';
      if (activeProfiles.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = "No profiles found. Go to settings.";
        profileSelect.appendChild(option);
      } else {
        activeProfiles.forEach(p => {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.profileName;
          if (p.id === currentProfileId) option.selected = true;
          profileSelect.appendChild(option);
        });
      }
      resolve();
    });
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function queryState() {
  const tab = await getActiveTab();
  if (!tab) return;

  chrome.runtime.sendMessage({
    action: 'QUERY_STATE',
    tabId: tab.id
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log("Could not contact background, state defaults to idle.");
      updateUI({ status: 'idle' });
      return;
    }
    if (response && response.state) {
      updateUI(response.state);
    }
  });
}

function updateUI(state) {
  const status = state?.status || 'idle';
  const currentStep = state?.currentStep || '-';
  const confidence = state?.confidence !== undefined ? `${state.confidence}%` : '-';
  const statusMessage = state?.message || 'Ready to fill.';
  const errorMsg = state?.errorMsg || '';

  // Update text values
  statusBadge.textContent = status.toUpperCase().replace('_', ' ');
  statusBadge.className = `badge status-${status}`;
  currentStepVal.textContent = currentStep;
  confidenceVal.textContent = confidence;
  statusMsg.textContent = statusMessage;

  // Toggle Error Alert Card
  if (status === 'error' && errorMsg) {
    errorCard.classList.remove('hidden');
    errorText.textContent = errorMsg;
  } else {
    errorCard.classList.add('hidden');
  }

  // Hide all control views first
  btnStart.classList.add('hidden');
  runningControls.classList.add('hidden');
  pausedControls.classList.add('hidden');
  confirmControls.classList.add('hidden');

  // Toggle button visibility based on status
  if (status === 'idle') {
    btnStart.classList.remove('hidden');
    profileSelect.disabled = false;
  } else if (status === 'scanning' || status === 'filling') {
    runningControls.classList.remove('hidden');
    profileSelect.disabled = true;
  } else if (status === 'paused' || status === 'error') {
    pausedControls.classList.remove('hidden');
    profileSelect.disabled = true;
  } else if (status === 'awaiting_confirm') {
    confirmControls.classList.remove('hidden');
    profileSelect.disabled = true;
  }
}
