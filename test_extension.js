// Automated integration test for ApplyPilot extension using Playwright
const { chromium } = require('playwright');
const path = require('path');

async function runTest() {
  const extensionPath = __dirname;
  console.log("Loading extension from:", extensionPath);

  // Launch browser with the unpacked extension loaded
  const context = await chromium.launchPersistentContext('', {
    headless: false, // Must be headed to load extensions
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    // 1. Discover the extension ID dynamically from service worker
    console.log("Waiting for Extension Service Worker to register...");
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    
    const extensionId = background.url().split('/')[2];
    console.log("Discovered Extension ID:", extensionId);

    // 2. Open options page to seed test profile
    console.log("Opening options page to seed test profile...");
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForLoadState('domcontentloaded');

    // Seed test profile directly into chrome.storage.local
    await optionsPage.evaluate(() => {
      const testProfile = {
        id: 'prof_test',
        profileName: 'Test Profile',
        firstName: 'Alice',
        lastName: 'Smith',
        fullName: 'Alice Smith',
        email: 'alice@example.com',
        phone: '+1 555 987 6543',
        dob: '1995-05-15',
        gender: 'Female',
        nationality: 'Canadian',
        address: {
          street: '789 Maple Ave',
          line2: 'Apt 4B',
          city: 'Toronto',
          state: 'ON',
          zip: 'M5V 2T6',
          country: 'Canada'
        },
        linkedin: 'https://linkedin.com/in/alicesmith',
        github: 'https://github.com/alicesmith',
        portfolio: 'https://alicesmith.dev',
        skills: 'JavaScript, Node.js, Playwright',
        languages: 'English, French',
        achievements: 'Created ApplyPilot test run',
        resumeText: 'Test resume text for Alice Smith.',
        education: [],
        experience: [],
        projects: [],
        customQA: []
      };

      return new Promise((resolve) => {
        chrome.storage.local.set({
          profiles: [testProfile],
          currentProfileId: 'prof_test'
        }, resolve);
      });
    });
    console.log("Test profile seeded successfully!");

    // 3. Open mock form page
    console.log("Opening mock form page...");
    const page = await context.newPage();
    await page.goto('http://localhost:8080/mock_form.html');
    await page.waitForLoadState('domcontentloaded');

    // 4. Wait for the inline trigger button to be rendered
    console.log("Waiting for ApplyPilot inline trigger button...");
    const triggerSelector = '.applypilot-inline-trigger';
    await page.waitForSelector(triggerSelector, { timeout: 5000 });
    
    // Get its position and click it
    const trigger = await page.$(triggerSelector);
    console.log("Trigger button found. Clicking trigger button...");
    await trigger.click();

    // 5. Select the profile from the dropdown tooltip
    console.log("Waiting for profile dropdown...");
    const dropdownSelector = '.applypilot-dropdown-item';
    await page.waitForSelector(dropdownSelector, { timeout: 3000 });
    
    const dropdownItem = await page.$(dropdownSelector);
    console.log("Dropdown option found. Clicking profile option...");
    await dropdownItem.click();

    // 6. Wait for autofill execution
    console.log("Waiting for form autofill to execute...");
    await page.waitForTimeout(2000); // Allow time for input dispatch events

    // 7. Verify the form fields
    const fname = await page.$eval('#input-fname', el => el.value);
    const lname = await page.$eval('#input-lname', el => el.value);
    const fullname = await page.$eval('#input-fullname', el => el.value);
    const email = await page.$eval('#input-email', el => el.value);
    const phone = await page.$eval('#input-phone', el => el.value);
    const city = await page.$eval('#input-city', el => el.value);

    console.log("\n--- Verification Results ---");
    console.log(`First Name:  "${fname}" (Expected: "Alice") -> ${fname === 'Alice' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Last Name:   "${lname}" (Expected: "Smith") -> ${lname === 'Smith' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Full Name:   "${fullname}" (Expected: "Alice Smith") -> ${fullname === 'Alice Smith' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Email:       "${email}" (Expected: "alice@example.com") -> ${email === 'alice@example.com' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Phone:       "${phone}" (Expected: "+1 555 987 6543") -> ${phone === '+1 555 987 6543' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`City:        "${city}" (Expected: "Toronto") -> ${city === 'Toronto' ? '✅ PASS' : '❌ FAIL'}`);
    console.log("----------------------------\n");

    if (fname === 'Alice' && email === 'alice@example.com') {
      console.log("🎉 SUCCESS: Extension successfully filled the form fields!");
    } else {
      console.error("❌ FAILURE: Form fields were not populated correctly.");
    }
  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    // Close context
    await context.close();
  }
}

runTest();
