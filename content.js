// Content script running in the webpage DOM context

console.log("ApplyPilot Content Script loaded.");

// Send check-in to background script on load
chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY' }).catch(() => {});

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received action:", message.action);

  if (message.action === 'SCAN_PAGE') {
    scanPageAndSend();
  }

  else if (message.action === 'FILL_FIELDS') {
    executeFills(message.fills).then(results => {
      chrome.runtime.sendMessage({
        action: 'FILL_COMPLETE',
        results: results
      });
    });
  }

  else if (message.action === 'CLICK_NEXT') {
    clickButton(message.selector);
  }

  else if (message.action === 'HIGHLIGHT_ERRORS') {
    highlightValidationErrors();
  }

  else if (message.action === 'RESET_STATE') {
    removeHighlights();
  }
  
  return false;
});

// Helper to generate unique XPath for elements
function getElementXPath(element) {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  if (element === document.body) {
    return '/html/body';
  }
  let ix = 0;
  const siblings = element.parentNode ? element.parentNode.childNodes : [];
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      return getElementXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
    }
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
  return null;
}

// Find element using XPath
function getElementByXPath(xpath) {
  try {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch (err) {
    console.error("XPath evaluation failed:", xpath, err);
    return null;
  }
}

// Helper to find label text associated with an element
function getElementLabel(element) {
  // 1. Check direct ID label
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label && label.textContent.trim()) {
      return label.textContent.trim();
    }
  }

  // 2. Check parent label wrap
  let parent = element.parentElement;
  while (parent) {
    if (parent.tagName === 'LABEL') {
      return parent.textContent.trim();
    }
    parent = parent.parentElement;
  }

  // 3. Check aria-label / aria-labelledby
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl && labelEl.textContent.trim()) {
      return labelEl.textContent.trim();
    }
  }

  // 4. Check preceding text element (common in table row formats)
  const prevEl = element.previousElementSibling;
  if (prevEl && (prevEl.tagName === 'SPAN' || prevEl.tagName === 'DIV' || prevEl.tagName === 'P') && prevEl.textContent.trim()) {
    return prevEl.textContent.trim();
  }

  // 5. Fallback to placeholder or name attribute
  if (element.placeholder && element.placeholder.trim()) {
    return element.placeholder.trim();
  }
  if (element.name && element.name.trim()) {
    return element.name.trim();
  }

  // 6. Check closest sibling header/span text
  let sibling = element.previousSibling;
  while (sibling) {
    if (sibling.nodeType === Node.ELEMENT_NODE && sibling.textContent.trim()) {
      return sibling.textContent.trim();
    }
    sibling = sibling.previousSibling;
  }

  return '';
}

// Check if element is visible on the screen
function isElementVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    rect.width > 0 &&
    rect.height > 0
  );
}

// Scan page structure
function scanPageAndSend() {
  const fields = [];
  const buttons = [];
  
  // Find all inputs, select, textarea
  const inputElements = document.querySelectorAll('input, select, textarea');
  inputElements.forEach(el => {
    if (!isElementVisible(el)) return;
    
    // Ignore hidden inputs, submit buttons, reset buttons
    if (el.tagName === 'INPUT' && (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'image' || el.type === 'reset')) {
      return;
    }

    const label = getElementLabel(el);
    const required = el.required || el.getAttribute('aria-required') === 'true' || label.includes('*');

    fields.push({
      id: el.id,
      name: el.name || '',
      placeholder: el.placeholder || '',
      label: label.replace('*', '').trim(),
      type: el.type || 'text',
      tagName: el.tagName,
      required: required,
      xpath: getElementXPath(el)
    });
  });

  // Find all buttons, anchors behaving as buttons
  const buttonElements = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a.button');
  buttonElements.forEach(el => {
    if (!isElementVisible(el)) return;

    const btnText = el.tagName === 'INPUT' ? el.value : el.textContent.trim();
    if (!btnText) return;

    buttons.push({
      id: el.id || '',
      name: el.name || '',
      text: btnText,
      xpath: getElementXPath(el)
    });
  });

  // Check for validation errors
  const validationErrorTexts = [];
  const errorElements = document.querySelectorAll('.error, .invalid, [aria-invalid="true"], .error-message, .validation-error, [class*="error" i]');
  errorElements.forEach(el => {
    if (isElementVisible(el) && el.textContent.trim()) {
      // Filter out container elements, only take leaf error text
      if (el.childElementCount === 0) {
        validationErrorTexts.push(el.textContent.trim());
      }
    }
  });

  chrome.runtime.sendMessage({
    action: 'PAGE_SCANNED',
    scanData: {
      url: window.location.href,
      fields: fields,
      buttons: buttons,
      hasValidationErrors: validationErrorTexts.length > 0,
      validationErrorTexts: [...new Set(validationErrorTexts)] // deduplicate
    }
  });
}

// React/Vue aware element setter
function setNativeValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }
}

// Fill fields
async function executeFills(fills) {
  const results = [];

  for (const fill of fills) {
    const el = getElementByXPath(fill.xpath);
    if (!el) {
      results.push({ xpath: fill.xpath, name: fill.name, success: false, error: 'Element not found' });
      continue;
    }

    try {
      if (fill.type === 'file' && fill.fileData) {
        // Handle file uploads (Base64 conversion to File object)
        injectFileElement(el, fill.fileData);
        results.push({ xpath: fill.xpath, name: fill.name, success: true });
      } 
      
      else if (el.tagName === 'SELECT') {
        // Dropdown selection matching
        selectDropdownOption(el, fill.value);
        results.push({ xpath: fill.xpath, name: fill.name, success: true });
      } 
      
      else if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
        // Checkboxes and radio buttons
        const shouldCheck = fill.value === true || fill.value === 'true' || fill.value === 'Yes' || fill.value === '1';
        el.checked = shouldCheck;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ xpath: fill.xpath, name: fill.name, success: true });
      } 
      
      else {
        // Standard inputs and textareas
        setNativeValue(el, fill.value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        results.push({ xpath: fill.xpath, name: fill.name, success: true });
      }

      // Add a subtle glowing effect to filled inputs
      el.style.border = '2px solid #a78bfa';
      el.style.boxShadow = '0 0 8px #c084fc';
      el.classList.add('applypilot-filled');
    } catch (err) {
      console.error("Failed to fill field:", fill.name, err);
      results.push({ xpath: fill.xpath, name: fill.name, success: false, error: err.message });
    }
  }

  return results;
}

// Select dropdown option
function selectDropdownOption(selectEl, value) {
  if (!value) return;
  const normalizedVal = value.toString().trim().toLowerCase();
  
  // Try mapping by option value or option visible text
  let bestOptionValue = '';
  for (let i = 0; i < selectEl.options.length; i++) {
    const opt = selectEl.options[i];
    const optVal = opt.value.trim().toLowerCase();
    const optText = opt.text.trim().toLowerCase();
    
    if (optVal === normalizedVal || optText === normalizedVal || optText.includes(normalizedVal) || normalizedVal.includes(optText)) {
      bestOptionValue = opt.value;
      break;
    }
  }

  if (bestOptionValue) {
    selectEl.value = bestOptionValue;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // If no match, select the second option as fallback (often the first is placeholder)
    if (selectEl.options.length > 1) {
      selectEl.selectedIndex = 1;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

// Inject Base64 file data into File Input
function injectFileElement(inputEl, fileObj) {
  const { name, data, type } = fileObj;
  
  // Extract base64 part
  const parts = data.split(',');
  const byteString = atob(parts[1] || parts[0]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: type });
  const file = new File([blob], name, { type: type });

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  inputEl.files = dataTransfer.files;
  
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// Click navigation button
function clickButton(xpath) {
  if (!xpath) return;
  const el = getElementByXPath(xpath);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      el.click();
    }, 500);
  } else {
    console.error("Button element to click not found at xpath:", xpath);
  }
}

// Highlight error borders
function highlightValidationErrors() {
  const errorElements = document.querySelectorAll('.error, .invalid, [aria-invalid="true"], [class*="error" i]');
  errorElements.forEach(el => {
    if (isElementVisible(el)) {
      el.style.border = '2px dashed #f43f5e';
      el.style.boxShadow = '0 0 10px #f43f5e';
      el.classList.add('applypilot-error');
    }
  });
}

function removeHighlights() {
  document.querySelectorAll('.applypilot-filled, .applypilot-error').forEach(el => {
    el.style.border = '';
    el.style.boxShadow = '';
  });
}

// Inline triggers tracking
const activeTriggers = new Map(); // inputElement -> triggerElement

function initInlineDetection() {
  // Initial run
  detectAndInjectTriggers();

  // Watch for dynamic DOM updates (e.g. single page apps)
  const observer = new MutationObserver(() => {
    detectAndInjectTriggers();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Update positions on window resize or scroll
  window.addEventListener('resize', repositionAllTriggers);
  window.addEventListener('scroll', repositionAllTriggers, { passive: true });
}

function detectAndInjectTriggers() {
  const inputs = document.querySelectorAll('input');
  inputs.forEach(inputEl => {
    // Only target visible inputs
    if (!isElementVisible(inputEl)) return;
    
    // Check if it looks like an email field
    const isEmailInput = inputEl.type === 'email' || 
                         /email/i.test(inputEl.name) || 
                         /email/i.test(inputEl.id) || 
                         /email/i.test(inputEl.placeholder) ||
                         /email/i.test(getElementLabel(inputEl));
                         
    if (isEmailInput && !activeTriggers.has(inputEl)) {
      createTriggerElement(inputEl);
    }
  });

  // Clean up triggers for elements that are no longer in DOM or invisible
  for (const [inputEl, triggerEl] of activeTriggers.entries()) {
    if (!document.body.contains(inputEl) || !isElementVisible(inputEl)) {
      triggerEl.remove();
      activeTriggers.delete(inputEl);
    }
  }
}

function createTriggerElement(inputEl) {
  const trigger = document.createElement('button');
  trigger.className = 'applypilot-inline-trigger';
  trigger.type = 'button';
  trigger.title = 'Fill form with ApplyPilot';
  
  // Mini ApplyPilot logo SVG
  trigger.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 22H22L12 2Z" fill="#ffffff"/>
    </svg>
  `;

  document.body.appendChild(trigger);
  activeTriggers.set(inputEl, trigger);
  
  positionTrigger(inputEl, trigger);

  // Click Handler
  trigger.addEventListener('click', (e) => {
    console.log("ApplyPilot trigger clicked!");
    e.stopPropagation();
    e.preventDefault();
    
    chrome.storage.local.get(['profiles', 'currentProfileId'], (result) => {
      console.log("Retrieved profiles from storage:", result);
      const profiles = result.profiles || [];
      const currentProfileId = result.currentProfileId || null;
      
      if (profiles.length === 0) {
        console.warn("No profiles found in storage.");
        alert("Please configure a profile in ApplyPilot settings first.");
        return;
      }
      
      showProfileDropdown(trigger, inputEl, profiles, currentProfileId);
    });
  });
}

function positionTrigger(inputEl, triggerEl) {
  const rect = inputEl.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  
  // Overlay slightly on the right side of the input field
  triggerEl.style.left = `${scrollX + rect.right - 26}px`;
  triggerEl.style.top = `${scrollY + rect.top + (rect.height - 22) / 2}px`;
}

function repositionAllTriggers() {
  for (const [inputEl, triggerEl] of activeTriggers.entries()) {
    if (document.body.contains(inputEl) && isElementVisible(inputEl)) {
      positionTrigger(inputEl, triggerEl);
    }
  }
}

function removeDropdowns() {
  document.querySelectorAll('.applypilot-dropdown').forEach(el => el.remove());
}

function showProfileDropdown(triggerEl, inputEl, profiles, currentProfileId) {
  removeDropdowns();
  
  const dropdown = document.createElement('div');
  dropdown.className = 'applypilot-dropdown';
  
  const header = document.createElement('div');
  header.className = 'applypilot-dropdown-header';
  header.textContent = 'ApplyPilot Profiles';
  dropdown.appendChild(header);
  
  profiles.forEach(p => {
    const item = document.createElement('button');
    item.className = 'applypilot-dropdown-item';
    if (p.id === currentProfileId) {
      item.classList.add('active-profile');
    }
    item.textContent = p.profileName;
    
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.remove();
      
      // Auto-fill active page with this profile
      chrome.runtime.sendMessage({
        action: 'START_AUTOMATION',
        profileId: p.id
      });
    });
    
    dropdown.appendChild(item);
  });
  
  document.body.appendChild(dropdown);
  
  const rect = triggerEl.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  dropdown.style.left = `${scrollX + rect.right - 180}px`;
  dropdown.style.top = `${scrollY + rect.bottom + 6}px`;
  
  // Close dropdown on clicking outside
  const clickOutsideHandler = (e) => {
    if (!dropdown.contains(e.target) && e.target !== triggerEl) {
      dropdown.remove();
      document.removeEventListener('click', clickOutsideHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', clickOutsideHandler), 10);
}

// Initialize inline triggers detection
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInlineDetection);
} else {
  initInlineDetection();
}

// Listen for manual and automatic navigation/submit button clicks to support dynamic forms (SPA)
document.addEventListener('click', (e) => {
  const target = e.target.closest('button, input[type="submit"], input[type="button"], a.btn, a.button');
  if (target && !target.className.includes('applypilot-')) {
    // Wait a brief moment for dynamic transition/DOM updates to complete before scanning
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'CONTENT_SCRIPT_READY' }).catch(() => {});
    }, 1000);
  }
}, true);
