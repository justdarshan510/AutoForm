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
      // If content script reports ready and background is running/filling, trigger scan
      const state = getOrCreateTabState(tabId);
      if (state.status === 'scanning' || state.status === 'filling') {
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

  // Process each field
  for (const field of scanData.fields) {
    let matchedValue = null;
    let fieldType = 'text';
    let fileData = null;
    let isRequired = field.required;

    if (isRequired) totalMatchableFields++;

    // 1. Check local field mapping rule first
    const profileKey = FieldRules.match(field.label) || FieldRules.match(field.name) || FieldRules.match(field.placeholder);
    
    if (profileKey) {
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
        fileData = profile.certificates; // Falls back to resume if cover/certificates not set
      }

      if (matchedValue || fileData) {
        matchedFields++;
      }
    }

    // 2. If it's a textarea or text input and it looks like a custom question (e.g. essay questions)
    if (!matchedValue && fieldType !== 'file' && (field.tagName === 'TEXTAREA' || field.type === 'text')) {
      const isCustomQuestion = detectCustomQuestion(field.label, field.placeholder, field.name);
      if (isCustomQuestion) {
        state.customQaFieldsFound = true;
        // Check if we have a matching custom Q&A already saved
        const savedQA = (profile.customQA || []).find(q => 
          field.label.toLowerCase().includes(q.question.toLowerCase()) || 
          q.question.toLowerCase().includes(field.label.toLowerCase())
        );

        if (savedQA) {
          matchedValue = savedQA.answer;
          matchedFields++;
        } else if (state.apiKey) {
          // Generate using Gemini API
          state.message = 'Generating custom answer using Gemini AI...';
          broadcastState(tabId);
          try {
            const contextText = `Applying for a job page. Resume Text reference: ${profile.resumeText || ''}`;
            matchedValue = await AiHelper.generateAnswer(state.apiKey, profile, field.label || field.placeholder || field.name, contextText);
            hasAIFills = true;
            matchedFields++;
          } catch (apiErr) {
            console.error("AI Generation failed:", apiErr);
            // Don't crash, let it be filled manually
          }
        }
      }
    }

    // Add to fills list if we resolved a value
    if (matchedValue !== null || fileData !== null) {
      fills.push({
        id: field.id,
        name: field.name,
        xpath: field.xpath,
        tagName: field.tagName,
        type: fieldType,
        value: matchedValue,
        fileData: fileData // { name, data, type }
      });
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

  // Always pause at review pages or when custom AI answers were generated
  // Also stop automation for user review if we are at a "Submit" page
  const isSubmitStep = state.nextButtonSelector && /submit|apply|complete/i.test(state.nextButtonSelector);

  if (state.customQaFieldsFound || isSubmitStep || state.confidence < 80) {
    state.status = 'awaiting_confirm';
    state.message = isSubmitStep 
      ? 'Final submission page reached. Please review all fields, then click "Verify & Continue" to submit.'
      : 'AI answered custom questions or confidence is low. Review entries, then click "Verify & Continue" to navigate.';
    broadcastState(tabId);
  } else {
    // High-confidence intermediate step, click next automatically
    state.status = 'filling';
    state.message = 'Fills completed. Navigating automatically...';
    broadcastState(tabId);

    // Let the user see the prefill for 1.2 seconds before navigating
    setTimeout(() => {
      // Check if status is still filling (user didn't click Pause during timeout)
      if (tabStates[tabId]?.status === 'filling') {
        chrome.tabs.sendMessage(tabId, {
          action: 'CLICK_NEXT',
          selector: state.nextButtonSelector
        });
      }
    }, 1200);
  }
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
