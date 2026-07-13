// LeetGit - Content Script (Isolated World)

// Language extension mapping
const languageMap = {
  "c++": ".cpp", "cpp": ".cpp",
  "python": ".py", "python3": ".py", "py": ".py",
  "java": ".java",
  "javascript": ".js", "js": ".js",
  "typescript": ".ts", "ts": ".ts",
  "c#": ".cs", "csharp": ".cs",
  "go": ".go", "golang": ".go",
  "rust": ".rs",
  "kotlin": ".kt",
  "swift": ".swift",
  "ruby": ".rb",
  "scala": ".scala",
  "php": ".php",
  "c": ".c"
};

// Initialize listeners and observers
document.addEventListener("DOMContentLoaded", initialize);
// Fallback if DOMContentLoaded already fired
if (document.readyState === "interactive" || document.readyState === "complete") {
  initialize();
}

function initialize() {
  console.log("LeetGit: Content script initialized.");
  startObserver();
  setupEventListeners();
  setupUrlPolling();
}

// 1. Setup Event Listeners
function setupEventListeners() {
  // Listen for custom events dispatched by the MAIN world network interceptor
  window.addEventListener("leetgit-accepted", (e) => {
    console.log("LeetGit: Received accepted event from network interceptor.");
    const { problemSlug, problemTitle, language } = e.detail;
    const slug = problemSlug || getProblemSlug();
    const title = problemTitle || getProblemTitle();
    const lang = language || getLanguage();
    const ext = getExtension(lang);

    triggerPush(slug, title, lang, ext);
  });

  window.addEventListener("leetgit-accepted-graphql", (e) => {
    console.log("LeetGit: Received accepted GraphQL event. Checking DOM...");
    // Wait briefly for DOM to update then trigger extraction
    setTimeout(handleAcceptedTrigger, 1000);
  });

  // Listen for clicks on the "Submit" button to clear deduplication flags
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button) {
      const text = button.textContent || "";
      const isSubmit = text.trim() === "Submit" || 
                       button.getAttribute("data-e2e-locator") === "console-submit-button" ||
                       button.classList.contains("submit-btn");
      if (isSubmit) {
        const slug = getProblemSlug();
        const lang = getLanguage();
        if (slug && lang) {
          const key = `leetgit_pushed_${slug}_${lang}`;
          sessionStorage.removeItem(key);
          console.log(`LeetGit: Submission initiated. Cleared dedupe key: ${key}`);
        }
      }
    }
  });
}

// 2. DOM Mutation Observer
let observer = null;
function startObserver() {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver(() => {
    // Check if the DOM shows "Accepted"
    // Modern UI submission panel result
    const subResult = document.querySelector('[data-e2e-locator="submission-result"]');
    if (subResult && subResult.textContent.trim() === "Accepted") {
      handleAcceptedTrigger();
      return;
    }

    // Fallbacks: checking green-s or class elements with accepted keyword
    const greenElements = document.querySelectorAll('.text-green-s, [class*="accepted"]');
    for (const el of greenElements) {
      if (el.textContent.trim() === "Accepted") {
        handleAcceptedTrigger();
        return;
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// 3. SPA URL Polling
let lastUrl = window.location.href;
function setupUrlPolling() {
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      handleUrlChange();
    }
  }, 1000);

  // Run initial check for submission detail pages (on direct navigation)
  if (window.location.pathname.includes("/submissions/detail/")) {
    checkSubmissionDetailPage();
  }
}

function handleUrlChange() {
  // Re-observe DOM since SPA updates can tear down page elements
  startObserver();
  
  if (window.location.pathname.includes("/submissions/detail/")) {
    checkSubmissionDetailPage();
  }
}

// Retry loop for the submission detail page
function checkSubmissionDetailPage(retries = 10) {
  if (retries <= 0) return;

  const statusEl = document.querySelector(".text-success") || 
                   document.querySelector('[data-e2e-locator="submission-result"]') ||
                   document.querySelector(".status-accepted") ||
                   document.querySelector(".text-green-s");

  if (statusEl && statusEl.textContent.trim().toLowerCase().includes("accepted")) {
    const slug = getProblemSlug();
    const lang = getLanguage();
    if (slug && lang) {
      const key = `leetgit_pushed_${slug}_${lang}`;
      if (sessionStorage.getItem(key)) {
        return; // Already pushed or pushing
      }
      
      sessionStorage.setItem(key, "pending");
      const title = getProblemTitle();
      const ext = getExtension(lang);
      
      triggerPush(slug, title, lang, ext);
      return;
    }
  }

  setTimeout(() => {
    checkSubmissionDetailPage(retries - 1);
  }, 1000);
}

// 4. Metadata Parsing Helpers
function getProblemSlug() {
  // Try pattern: leetcode.com/problems/problem-slug/...
  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  if (match) return match[1];

  // Try finding link back to problems in details page
  const probLink = document.querySelector('a[href*="/problems/"]');
  if (probLink) {
    const hrefMatch = probLink.getAttribute("href").match(/\/problems\/([^/]+)/);
    if (hrefMatch) return hrefMatch[1];
  }

  // Fallback to title based slug
  const title = getProblemTitle();
  if (title) {
    return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
  }
  return "";
}

function getProblemTitle() {
  // Modern LeetCode problem page title element
  const titleEl = document.querySelector('[data-cy="question-title"]') || 
                  document.querySelector('div[class*="title"]') ||
                  document.querySelector('h4');
  if (titleEl) {
    let rawTitle = titleEl.textContent.trim();
    // Remove leading problem number (e.g. "1. Two Sum" -> "Two Sum")
    return rawTitle.replace(/^\d+\.\s*/, "");
  }

  // Fallback: document title
  const docTitle = document.title;
  if (docTitle) {
    return docTitle.split(" - ")[0].trim().replace(/^\d+\.\s*/, "");
  }
  return "LeetCode Solution";
}

function getLanguage() {
  // Modern UI lang select button
  const langBtn = document.querySelector('button[id*="lang-select"]') || 
                  document.querySelector('[data-cy="lang-select"]');
  if (langBtn) return langBtn.textContent.trim();

  // Submission details page lang text
  const langEl = document.querySelector("#submission-program-info") || 
                 document.querySelector("div[class*='language']");
  if (langEl) return langEl.textContent.trim();

  return "Python3"; // Default fallback
}

function getExtension(lang) {
  const cleaned = lang.toLowerCase().trim();
  for (const [key, value] of Object.entries(languageMap)) {
    if (cleaned.includes(key)) return value;
  }
  return ".txt";
}

// 5. Trigger extraction and background push
function handleAcceptedTrigger() {
  const slug = getProblemSlug();
  const lang = getLanguage();
  if (!slug || !lang) return;

  const key = `leetgit_pushed_${slug}_${lang}`;
  if (sessionStorage.getItem(key)) {
    return; // Already pushed or pending
  }

  sessionStorage.setItem(key, "pending");

  const title = getProblemTitle();
  const ext = getExtension(lang);

  triggerPush(slug, title, lang, ext);
}

function triggerPush(slug, title, lang, ext) {
  const key = `leetgit_pushed_${slug}_${lang}`;
  console.log(`LeetGit: Sending push message for ${title} (${lang})`);

  chrome.runtime.sendMessage({
    type: "SUBMISSION_ACCEPTED_DETECTED",
    payload: {
      problemSlug: slug,
      problemTitle: title,
      language: lang,
      extension: ext
    }
  }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      console.error("LeetGit: Push failed:", chrome.runtime.lastError || response?.error);
      // Remove flag on failure so user can try again
      sessionStorage.removeItem(key);
    } else {
      console.log("LeetGit: Solution pushed successfully!", response.githubUrl);
      sessionStorage.setItem(key, "pushed");
    }
  });
}
