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

// Helper for sending messages to background worker safely, avoiding uncaught context invalidation errors
function safeSendMessage(message, callback) {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // Clear last runtime error if any to avoid warnings in extension logs
        if (chrome.runtime.lastError) {
          console.warn("LeetGit: Communication warning:", chrome.runtime.lastError.message);
        }
        if (callback) callback(response);
      });
      return true;
    } catch (err) {
      console.warn("LeetGit: Extension context was invalidated. Please refresh the page.", err);
    }
  } else {
    console.warn("LeetGit: Extension context is not available. Please refresh the page.");
  }
  if (callback) callback(null);
  return false;
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

    handleAcceptedTrigger(slug, title, lang, ext);
  });

  window.addEventListener("leetgit-accepted-graphql", (e) => {
    console.log("LeetGit: Received accepted GraphQL event. Checking DOM...");
    // Wait briefly for DOM to update then trigger extraction
    setTimeout(() => {
      const slug = getProblemSlug();
      const lang = getLanguage();
      if (slug && lang) {
        const title = getProblemTitle();
        const ext = getExtension(lang);
        handleAcceptedTrigger(slug, title, lang, ext);
      }
    }, 1000);
  });

  // Listen for clicks on the Submit or Run buttons to manage submit state
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button) {
      const text = (button.textContent || "").trim();
      
      const isSubmit = text.includes("Submit") || 
                       button.getAttribute("data-e2e-locator") === "console-submit-button" ||
                       button.classList.contains("submit-btn");
                       
      const isRun = text.includes("Run") || 
                    button.getAttribute("data-e2e-locator") === "console-run-button" ||
                    button.classList.contains("run-btn");
                    
      if (isSubmit) {
        handleSubmissionInitiated();
      } else if (isRun) {
        console.log("LeetGit: Run Code clicked. Resetting submit flag.");
        sessionStorage.removeItem("leetgit_is_submit");
      }
    }
  });

  // Listen for keyboard submissions and runs (shortcuts)
  document.addEventListener("keydown", (e) => {
    const activeEl = document.activeElement;
    const isEditorActive = activeEl && (activeEl.tagName === "TEXTAREA" || activeEl.closest(".editor") || activeEl.closest(".monaco-editor"));
    
    if (isEditorActive) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        // Ctrl+Enter / Cmd+Enter = Submit
        handleSubmissionInitiated();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "'") {
        // Ctrl+' / Cmd+' = Run Code
        console.log("LeetGit: Run Code shortcut detected. Resetting submit flag.");
        sessionStorage.removeItem("leetgit_is_submit");
      }
    }
  });
}

// Cooldown tracker to prevent click/keydown double submissions
let lastSubmitTime = 0;

// Handler for submission click or keyboard shortcut - caches code immediately to avoid navigation race condition
function handleSubmissionInitiated() {
  const now = Date.now();
  if (now - lastSubmitTime < 3000) {
    console.log("LeetGit: Submission extraction cooldown active. Ignoring duplicate trigger.");
    return;
  }
  lastSubmitTime = now;

  const slug = getProblemSlug();
  const lang = getLanguage();
  if (slug && lang) {
    const key = `leetgit_pushed_${slug}_${lang}`;
    sessionStorage.removeItem(key);
    
    // Set submit flag state to allow pushes only for this run
    sessionStorage.setItem("leetgit_is_submit", "true");
    console.log(`LeetGit: Submission initiated. Cleared dedupe key: ${key}`);

    // Request early code extraction via background script (using chrome.scripting to bypass CSP)
    safeSendMessage({ type: "EXTRACT_CODE_NOW" }, (response) => {
      if (response && response.code) {
        sessionStorage.setItem("leetgit_submitted_code", response.code);
        console.log("LeetGit: Code extracted and cached in sessionStorage.");
      } else {
        console.warn("LeetGit: Early code extraction failed:", response?.error || "Unknown error");
      }
    });
  }
}

// 2. DOM Mutation Observer
var observer = null;
function startObserver() {
  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver(() => {
    // Check if the DOM shows "Accepted"
    // Modern UI submission panel result
    const subResult = document.querySelector('[data-e2e-locator="submission-result"]');
    if (subResult) {
      const text = subResult.textContent.trim();
      if (text === "Accepted") {
        const slug = getProblemSlug();
        const lang = getLanguage();
        if (slug && lang) {
          const title = getProblemTitle();
          const ext = getExtension(lang);
          handleAcceptedTrigger(slug, title, lang, ext);
        }
        return;
      } else if (text !== "Pending" && text !== "Judging" && text !== "") {
        // Submission failed. Clear submit state to prevent Run Code from triggering pushes later
        console.log("LeetGit: Submission failed (DOM):", text);
        sessionStorage.removeItem("leetgit_is_submit");
        sessionStorage.removeItem("leetgit_submitted_code");
      }
    }

    // Fallbacks: checking green-s or class elements with accepted keyword
    const greenElements = document.querySelectorAll('.text-green-s, [class*="accepted"]');
    for (const el of greenElements) {
      if (el.textContent.trim() === "Accepted") {
        const slug = getProblemSlug();
        const lang = getLanguage();
        if (slug && lang) {
          const title = getProblemTitle();
          const ext = getExtension(lang);
          handleAcceptedTrigger(slug, title, lang, ext);
        }
        return;
      }
    }

    // Fallback: checking error/failure messages in DOM to reset submit state
    const redElements = document.querySelectorAll('.text-red-s, .text-danger, [class*="error"], [class*="fail"]');
    for (const el of redElements) {
      const text = el.textContent.trim();
      if (text === "Wrong Answer" || text === "Runtime Error" || text === "Time Limit Exceeded" || text === "Compile Error" || text === "Memory Limit Exceeded") {
        console.log("LeetGit: Submission failed (DOM fallback):", text);
        sessionStorage.removeItem("leetgit_is_submit");
        sessionStorage.removeItem("leetgit_submitted_code");
        break;
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

// Handler for URL changes in Single Page Application navigation
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
      const title = getProblemTitle();
      const ext = getExtension(lang);
      // Detail pages are direct solutions, allow push directly
      sessionStorage.setItem("leetgit_is_submit", "true");
      handleAcceptedTrigger(slug, title, lang, ext);
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

// Extract clean problem title
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

// Extract the active programming language from the editor toolbar or DOM elements
function getLanguage() {
  const knownLanguages = [
    "c++", "java", "python", "python3", "c", "c#", "javascript", 
    "typescript", "go", "rust", "kotlin", "swift", "ruby", "scala", 
    "php", "html", "sql", "clojure", "elixir", "erlang", "f#", 
    "haskell", "lisp", "ocaml", "pascal", "perl", "r", "scheme", "smalltalk"
  ];
  
  // Prioritize scanning buttons inside the editor header/toolbar area
  const editorHeader = document.querySelector('[class*="editor-tool"]') || 
                       document.querySelector('[class*="control-bar"]') ||
                       document.querySelector('.editor-toolbar') ||
                       document.querySelector('[class*="Header"]') ||
                       document.body;
                       
  const buttons = editorHeader.querySelectorAll('button');
  for (const button of buttons) {
    const text = button.textContent.trim().toLowerCase();
    if (knownLanguages.includes(text)) {
      return button.textContent.trim();
    }
  }
  
  // Scan all page buttons if toolbar area was not matched
  if (editorHeader !== document.body) {
    const allButtons = document.querySelectorAll('button');
    for (const button of allButtons) {
      const text = button.textContent.trim().toLowerCase();
      if (knownLanguages.includes(text)) {
        return button.textContent.trim();
      }
    }
  }

  // Fallback to submission details program elements
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

// 5. Code extraction and push
function handleAcceptedTrigger(slug, title, lang, ext) {
  // STRICT CHECK: Verify that the trigger is in Submit mode (bypasses Run Code)
  if (sessionStorage.getItem("leetgit_is_submit") !== "true") {
    console.log("LeetGit: Ignored accepted event because it did not originate from an active Submit action.");
    return;
  }

  const finalSlug = slug || getProblemSlug();
  const finalLang = lang || getLanguage();
  if (!finalSlug || !finalLang) return;

  const key = `leetgit_pushed_${finalSlug}_${finalLang}`;
  if (sessionStorage.getItem(key)) {
    return; // Already pushed or pending
  }

  // Set to pending state to prevent duplicate observer checks from running
  sessionStorage.setItem(key, "pending");

  const finalTitle = title || getProblemTitle();
  const finalExt = ext || getExtension(finalLang);

  // Retrieve code from sessionStorage cache or DOM fallback
  let code = sessionStorage.getItem("leetgit_submitted_code");
  if (!code || code.trim() === "") {
    code = extractCodeFromDOM();
  }

  if (code && code.trim() !== "") {
    triggerPush(finalSlug, finalTitle, finalLang, finalExt, code);
  } else {
    // Live extraction fallback using chrome.scripting (failsafe in case of late load or missing cache)
    console.warn("LeetGit: Cached code not found. Querying live editor...");
    safeSendMessage({ type: "EXTRACT_CODE_NOW" }, (response) => {
      if (response && response.code) {
        triggerPush(finalSlug, finalTitle, finalLang, finalExt, response.code);
      } else {
        console.error("LeetGit: Live fallback extraction failed.");
        // Only clear pending status if it wasn't modified in the meantime by a concurrent push
        if (sessionStorage.getItem(key) === "pending") {
          sessionStorage.removeItem(key);
        }
        sessionStorage.removeItem("leetgit_is_submit");
      }
    });
  }
}

// Extract code from standard DOM elements (useful on submission details page and static viewer pages)
function extractCodeFromDOM() {
  try {
    // 1. Try reading from a textarea (often houses the code in read-only editors)
    const textarea = document.querySelector("textarea");
    if (textarea && textarea.value && textarea.value.trim() !== "") {
      return textarea.value;
    }

    // 2. Try reading from a <pre> or <code> block
    const preCode = document.querySelector("pre") || document.querySelector("code");
    if (preCode && preCode.innerText && preCode.innerText.trim() !== "") {
      return preCode.innerText;
    }

    // 3. Try reading from Monaco container lines
    const viewLines = document.querySelector(".view-lines");
    if (viewLines && viewLines.innerText && viewLines.innerText.trim() !== "") {
      return viewLines.innerText;
    }
  } catch (err) {
    console.error("LeetGit: DOM code extraction error:", err);
  }
  return null;
}

function triggerPush(slug, title, lang, ext, code) {
  const key = `leetgit_pushed_${slug}_${lang}`;
  console.log("LeetGit: Sending push message for " + title + " (" + lang + ")");

  safeSendMessage({
    type: "SUBMISSION_ACCEPTED_DETECTED",
    payload: {
      problemSlug: slug,
      problemTitle: title,
      language: lang,
      extension: ext,
      code: code
    }
  }, (response) => {
    if (!response || !response.success) {
      console.error("LeetGit: Push failed:", response?.error || "Unknown error");
      // Only remove if it hasn't been set to "pushed" by a concurrent successful request
      if (sessionStorage.getItem(key) === "pending") {
        sessionStorage.removeItem(key);
      }
      sessionStorage.removeItem("leetgit_is_submit");
    } else {
      console.log("LeetGit: Solution pushed successfully!", response.githubUrl);
      sessionStorage.setItem(key, "pushed");
      
      // Successfully pushed! Clean up submit session state
      sessionStorage.removeItem("leetgit_is_submit");
      sessionStorage.removeItem("leetgit_submitted_code");
    }
  });
}
