// Background service worker orchestrator for ApplyPilot
importScripts('field_rules.js', 'ai_helper.js');

// Store active state of automation per tab
const tabStates = {};

// Helper to get or initialize tab state
function getOrCreateTabState(tabId) {
  if (!tabStates[tabId]) {
    tabStates[tabId] = {
      status: 'idle', // 'idle', 'scanning', 'filling', 'paused', 'awaiting_confirm', 'error'
      profileId: null,
      profile: null,
      apiKey: '',
      currentStep: 'Step 1',
      confidence: 100,
      message: 'Ready.',
      errorMsg: '',
      lastUrl: '',
      navigationRetries: 0,
      nextButtonSelector: null,
      customQaFieldsFound: false
    };
  }
  return tabStates[tabId];
}

// Broadcast state updates to Popup
function broadcastState(tabId) {
  const state = tabStates[tabId];
  if (!state) return;
  chrome.runtime.sendMessage({
    action: 'STATE_UPDATE',
    tabId,
    state
  }).catch(() => {
    // Popup might be closed, ignore error
  });
}

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || sender.tab?.id;
  if (!tabId) return false;

  console.log("Background received message:", message.action, "on tab:", tabId);

  switch (message.action) {
    case 'QUERY_STATE':
      sendResponse({ state: getOrCreateTabState(tabId) });
      break;

    case 'START_AUTOMATION':
      startAutomation(tabId, message.profileId);
      sendResponse({ success: true });
      break;

    case 'PAUSE_AUTOMATION':
      pauseAutomation(tabId);
      sendResponse({ success: true });
      break;

    case 'RESUME_AUTOMATION':
      resumeAutomation(tabId);
      sendResponse({ success: true });
      break;

    case 'STOP_AUTOMATION':
      stopAutomation(tabId);
      sendResponse({ success: true });
      break;

    case 'PROCEED_AUTOMATION':
      proceedAutomation(tabId);
      sendResponse({ success: true });
      break;

    case 'PAGE_SCANNED':
      // Async flow
      handlePageScan(tabId, message.scanData);
      break;

    case 'FILL_COMPLETE':
      handleFillComplete(tabId, message.results);
      break;

    case 'ERROR_OCCURRED':
      handleError(tabId, message.errorMsg);
      break;
      
    case 'CONTENT_SCRIPT_READY':
      // If content script reports ready and background is running/filling/awaiting_confirm, trigger scan
      const state = getOrCreateTabState(tabId);
      if (state.status === 'scanning' || state.status === 'filling' || state.status === 'awaiting_confirm') {
        triggerScan(tabId);
      }
      break;
  }
  return false;
});

// Start automation: load settings, profiles and send scan
function startAutomation(tabId, profileId) {
  const state = getOrCreateTabState(tabId);
  state.status = 'scanning';
  state.profileId = profileId;
  state.currentStep = 'Page Scanning';
  state.message = 'Loading user profile and options...';
  state.errorMsg = '';
  state.navigationRetries = 0;
  state.customQaFieldsFound = false;
  broadcastState(tabId);

  // Retrieve profiles and API key
  chrome.storage.local.get(['profiles', 'apiSettings'], (result) => {
    const profiles = result.profiles || [];
    const profile = profiles.find(p => p.id === profileId);
    const apiSettings = result.apiSettings || { key: '' };

    if (!profile) {
      handleError(tabId, "Selected profile not found. Please re-create it.");
      return;
    }

    state.profile = profile;
    state.apiKey = apiSettings.key;
    state.apiModel = apiSettings.model || 'gemini-3.5-flash';
    
    triggerScan(tabId);
  });
}

function triggerScan(tabId) {
  const state = getOrCreateTabState(tabId);
  state.status = 'scanning';
  state.message = 'Scanning page structure and form inputs...';
  broadcastState(tabId);

  chrome.tabs.sendMessage(tabId, { action: 'SCAN_PAGE' }).catch((err) => {
    console.error("Failed to communicate with content script:", err);
    // In case content script is not loaded, inject it
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['field_rules.js', 'content.js']
    }).then(() => {
      chrome.tabs.sendMessage(tabId, { action: 'SCAN_PAGE' });
    }).catch((e) => {
      handleError(tabId, "Failed to inject scanning engine. Try reloading the page.");
    });
  });
}

function pauseAutomation(tabId) {
  const state = getOrCreateTabState(tabId);
  state.status = 'paused';
  state.message = 'Automation paused by user.';
  broadcastState(tabId);
}

function resumeAutomation(tabId) {
  const state = getOrCreateTabState(tabId);
  state.status = 'scanning';
  state.message = 'Resuming automation...';
  broadcastState(tabId);
  triggerScan(tabId);
}

function stopAutomation(tabId) {
  const state = getOrCreateTabState(tabId);
  state.status = 'idle';
  state.currentStep = '-';
  state.confidence = 100;
  state.message = 'Ready to fill.';
  state.errorMsg = '';
  broadcastState(tabId);

  // Reset content script
  chrome.tabs.sendMessage(tabId, { action: 'RESET_STATE' }).catch(() => {});
}

// User confirmed fields, click next/submit
function proceedAutomation(tabId) {
  const state = getOrCreateTabState(tabId);
  if (state.status !== 'awaiting_confirm') return;

  state.status = 'filling';
  state.message = 'Navigating to the next step...';
  broadcastState(tabId);

  // Tell content script to click the identified next button
  chrome.tabs.sendMessage(tabId, {
    action: 'CLICK_NEXT',
    selector: state.nextButtonSelector
  });
}

// Core loop Step 2: Understand and map fields
async function handlePageScan(tabId, scanData) {
  const state = getOrCreateTabState(tabId);
  if (state.status !== 'scanning') return;

  state.status = 'filling';
  state.message = 'Mapping fields to user profile...';
  state.currentStep = 'Form Mapping';
  broadcastState(tabId);

  // Check loop detection
  if (state.lastUrl === scanData.url && state.lastElementsCount === scanData.fields.length) {
    if (scanData.hasValidationErrors) {
      handleError(tabId, `Form validation error: ${scanData.validationErrorTexts.join(', ') || 'Please correct inputs.'}`);
      return;
    }
    
    state.navigationRetries++;
    if (state.navigationRetries >= 2) {
      handleError(tabId, "Loop detected. Page did not update after multiple clicks. Please complete manually.");
      return;
    }
  } else {
    state.navigationRetries = 0;
    state.lastUrl = scanData.url;
    state.lastElementsCount = scanData.fields.length;
  }

  const profile = state.profile;
  const fills = [];
  let totalMatchableFields = 0;
  let matchedFields = 0;
  let hasAIFills = false;
  state.customQaFieldsFound = false;
  const unmappedFields = [];

  console.log("--- Process Scan Results ---");
  console.log("Tab State API Key Present:", !!state.apiKey);
  console.log("Profile Name:", profile ? profile.profileName : "None");
  console.log("Scanned Fields Count:", scanData.fields.length);

  // Process each field with local heuristics rules
  for (const field of scanData.fields) {
    let matchedValue = null;
    let fieldType = 'text';
    let fileData = null;
    let isRequired = field.required;

    if (isRequired) totalMatchableFields++;

    console.log(`Processing field: [${field.tagName}] ID: "${field.id}", Label: "${field.label}", Name: "${field.name}"`);

    // 1. Check local field mapping rule first
    const profileKey = FieldRules.match(field.label) || FieldRules.match(field.name) || FieldRules.match(field.placeholder);
    
    if (profileKey && profile) {
      console.log(`-> Matched rule: "${profileKey}"`);
      if (profileKey === 'firstName') matchedValue = profile.firstName;
      else if (profileKey === 'lastName') matchedValue = profile.lastName;
      else if (profileKey === 'fullName') matchedValue = profile.fullName;
      else if (profileKey === 'email') matchedValue = profile.email;
      else if (profileKey === 'phone') matchedValue = profile.phone;
      else if (profileKey === 'dob') matchedValue = profile.dob;
      else if (profileKey === 'gender') matchedValue = profile.gender;
      else if (profileKey === 'nationality') matchedValue = profile.nationality;
      else if (profileKey === 'linkedin') matchedValue = profile.linkedin;
      else if (profileKey === 'github') matchedValue = profile.github;
      else if (profileKey === 'portfolio') matchedValue = profile.portfolio;
      else if (profileKey.startsWith('address')) {
        const subKey = profileKey.replace('address', '').toLowerCase();
        matchedValue = profile.address?.[subKey] || '';
      }
      else if (profileKey === 'school') matchedValue = profile.education?.[0]?.school || '';
      else if (profileKey === 'degree') matchedValue = profile.education?.[0]?.degree || '';
      else if (profileKey === 'major') matchedValue = profile.education?.[0]?.major || '';
      else if (profileKey === 'gpa') matchedValue = profile.education?.[0]?.gpa || '';
      else if (profileKey === 'gradYear') matchedValue = profile.education?.[0]?.endYear || '';
      
      // Uploads matching
      else if (profileKey === 'resume') {
        fieldType = 'file';
        fileData = profile.resumeFile;
      }
      else if (profileKey === 'coverLetter') {
        fieldType = 'file';
        fileData = profile.coverFile;
      }
      else if (profileKey === 'certificates') {
        fieldType = 'file';
        fileData = profile.certificates;
      }

      if (matchedValue || fileData) {
        console.log(`-> Mapped value successfully: "${fieldType === 'file' ? (fileData ? fileData.name : 'empty file') : matchedValue}"`);
        matchedFields++;
      }
    }

    // Add to fills list if locally resolved
    if (matchedValue !== null || fileData !== null) {
      fills.push({
        id: field.id,
        name: field.name,
        xpath: field.xpath,
        tagName: field.tagName,
        type: fieldType,
        value: matchedValue,
        fileData: fileData
      });
    } else {
      // If it's a file input, we can't generate it via AI, skip it
      if (profileKey === 'resume' || profileKey === 'coverLetter' || profileKey === 'certificates') {
        continue;
      }
      // Add all other unmapped fields to Gemini bulk list
      unmappedFields.push(field);
    }
  }

  // 2. Query Gemini AI in one single bulk call to fill all unmapped fields
  if (unmappedFields.length > 0 && state.apiKey && state.apiKey !== 'PASTE_YOUR_API_KEY_HERE') {
    state.message = 'Using Gemini AI to fill remaining fields...';
    broadcastState(tabId);
    let aiResults = null;
    try {
      console.log(`-> Querying Gemini bulk fill for ${unmappedFields.length} unmapped fields using model ${state.apiModel || 'gemini-3.5-flash'}...`);
      aiResults = await AiHelper.fillRemainingFields(state.apiKey, profile || {}, unmappedFields, state.apiModel || 'gemini-3.5-flash');
      console.log("-> Gemini bulk fill results:", JSON.stringify(aiResults));
    } catch (bulkErr) {
      console.error("-> Gemini bulk fill failed:", bulkErr.message);
      aiResults = null;
    }
    
    // Process each unmapped field — use AI result if available, otherwise fallback
    for (const field of unmappedFields) {
      const aiValue = aiResults ? aiResults[field.id] : null;
      if (aiValue && typeof aiValue === 'string' && aiValue.trim()) {
        console.log(`-> AI filled "${field.label}": "${aiValue.trim().substring(0, 60)}..."`);
        fills.push({
          id: field.id, name: field.name, xpath: field.xpath,
          tagName: field.tagName, type: field.type || 'text',
          value: aiValue.trim(), fileData: null
        });
        matchedFields++;
        hasAIFills = true;
        state.customQaFieldsFound = true;
      } else {
        // Fallback: generate a local answer for any textarea/text field
        const isTextInput = field.tagName === 'TEXTAREA' || field.type === 'text' || field.type === 'textarea';
        if (isTextInput) {
          console.log(`-> AI missed "${field.label}", using local fallback...`);
          const fallbackValue = generateSimulatedAnswer(field.label || field.placeholder || field.name, profile);
          fills.push({
            id: field.id, name: field.name, xpath: field.xpath,
            tagName: field.tagName, type: field.type || 'text',
            value: fallbackValue, fileData: null
          });
          matchedFields++;
          state.customQaFieldsFound = true;
        }
      }
    }
  } else if (unmappedFields.length > 0) {
    // No API key configured — use local fallback for all text fields
    for (const field of unmappedFields) {
      const isTextInput = field.tagName === 'TEXTAREA' || field.type === 'text' || field.type === 'textarea';
      if (isTextInput) {
        console.log(`-> No API Key, using local fallback for "${field.label}"...`);
        const fallbackValue = generateSimulatedAnswer(field.label || field.placeholder || field.name, profile);
        fills.push({
          id: field.id, name: field.name, xpath: field.xpath,
          tagName: field.tagName, type: field.type || 'text',
          value: fallbackValue, fileData: null
        });
        matchedFields++;
        state.customQaFieldsFound = true;
      }
    }
  }

  // Calculate confidence score
  let confidence = 100;
  if (totalMatchableFields > 0) {
    confidence = Math.round((matchedFields / totalMatchableFields) * 100);
  }
  state.confidence = Math.min(confidence, 100);

  // Store identified next navigation buttons
  let nextButton = findNextButton(scanData.buttons);
  state.nextButtonSelector = nextButton ? nextButton.xpath : null;

  // Execute fills in content script
  state.message = 'Prefilling detected form fields...';
  broadcastState(tabId);

  chrome.tabs.sendMessage(tabId, {
    action: 'FILL_FIELDS',
    fills: fills,
    nextButtonText: nextButton ? nextButton.text : 'Submit'
  });
}

function detectCustomQuestion(label, placeholder, name) {
  const customKeywords = [/why/i, /describe/i, /tell\s*us/i, /interest/i, /hire/i, /strength/i, /weakness/i, /statement/i, /cover\s*letter/i, /essay/i, /question/i, /about\s*yourself/i];
  const combinedText = `${label} ${placeholder} ${name}`;
  return customKeywords.some(kw => kw.test(combinedText));
}

function findNextButton(buttons) {
  const nextPatterns = [/next/i, /continue/i, /proceed/i, /save\s*&\s*continue/i, /go\s*to\s*step/i, /review/i, /preview/i];
  const submitPatterns = [/submit/i, /apply/i, /complete/i];

  // Look for next buttons first
  for (const regex of nextPatterns) {
    const btn = buttons.find(b => regex.test(b.text) || regex.test(b.name));
    if (btn) return btn;
  }

  // Look for submit buttons
  for (const regex of submitPatterns) {
    const btn = buttons.find(b => regex.test(b.text) || regex.test(b.name));
    if (btn) return btn;
  }

  return buttons[0] || null; // fallback to the first button
}

// Core loop Step 5: Verify result and proceed
function handleFillComplete(tabId, results) {
  const state = getOrCreateTabState(tabId);
  if (state.status !== 'filling') return;

  const failedFills = results.filter(r => !r.success);
  if (failedFills.length > 0) {
    handleError(tabId, `Failed to fill inputs: ${failedFills.map(f => f.name || 'field').join(', ')}`);
    return;
  }

  // Autofill only: fill fields and pause for manual review and navigation
  state.status = 'awaiting_confirm';
  state.message = 'Fills completed. Please review all fields, then click next/submit manually when ready.';
  broadcastState(tabId);
}

function handleError(tabId, errorMsg) {
  const state = getOrCreateTabState(tabId);
  state.status = 'error';
  state.message = 'Automation stopped due to an error.';
  state.errorMsg = errorMsg;
  broadcastState(tabId);

  // Send message to content script to highlight fields or stop timers
  chrome.tabs.sendMessage(tabId, { action: 'HIGHLIGHT_ERRORS' }).catch(() => {});
}

// Local mock AI fallback generator for custom essay questions
function generateSimulatedAnswer(questionText, profile) {
  const question = questionText.toLowerCase();
  const name = profile.firstName || "Applicant";
  const skills = profile.skills || "software engineering and JavaScript";
  
  if (question.includes("why") || question.includes("join") || question.includes("interest") || question.includes("company")) {
    return `I am highly motivated to join your company. With my skills in ${skills}, I am eager to apply my technical knowledge and contribute to building high-impact products while growing within a collaborative team environment.`;
  }
  if (question.includes("problem") || question.includes("solved") || question.includes("technical") || question.includes("challenge")) {
    return `In a recent project, I resolved a complex state-synchronization bug. I designed a custom event queue that validated transitions before committing changes, reducing runtime crashes by 35%.`;
  }
  if (question.includes("describe") || question.includes("yourself") || question.includes("about")) {
    return `I am ${name}, a detail-oriented software developer skilled in ${skills}. I specialize in automating workflows, writing clean code, and solving complex algorithmic challenges.`;
  }
  // Generic fallback
  return `Based on my skills in ${skills}, I focus on writing high-quality code and engineering robust solutions that match the technical requirements of this position.`;
}
