// Configuration constants - Update these with your deployed Vercel URL
const VERCEL_BACKEND_URL = process.env.VERCEL_BACKEND_URL; // Replace with your Vercel deployment URL

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUBMISSION_ACCEPTED_DETECTED") {
    handleAcceptedSubmission(message.payload, sender.tab)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error("Error in background script: ", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for asynchronous sendResponse
  }
});

// Primary orchestrator for the push operation
async function handleAcceptedSubmission(payload, tab) {
  if (!tab || !tab.id) {
    return { success: false, error: "No active tab found." };
  }

  // 1. Get credentials from chrome.storage.local
  const credentials = await new Promise((resolve) => {
    chrome.storage.local.get(["githubToken", "githubUsername", "repoOwner", "repoName"], resolve);
  });

  const { githubToken, githubUsername, repoOwner, repoName } = credentials;

  if (!githubToken || !repoOwner || !repoName) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "/icons/icon128.png",
      title: "LeetGit Configuration Required",
      message: "Please configure your GitHub connection and repository in the extension popup."
    });
    return { success: false, error: "Configuration missing." };
  }

  // 2. Extract code from the LeetCode editor (MAIN world access to Monaco)
  let code = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: () => {
        // Retry logic inside the page context if needed, but since it's already accepted, the editor is loaded
        try {
          // 1. Monaco Editor (Modern LeetCode UI)
          if (window.monaco && window.monaco.editor) {
            const models = window.monaco.editor.getModels();
            if (models && models.length > 0) {
              return models[0].getValue();
            }
          }

          // 2. CodeMirror (Older LeetCode UI)
          const cmElement = document.querySelector(".CodeMirror");
          if (cmElement && cmElement.CodeMirror) {
            return cmElement.CodeMirror.getValue();
          }

          // 3. Fallback to textarea
          const textarea = document.querySelector("textarea.pattern-lock-textarea") || 
                           document.querySelector("textarea[class*='editor']") ||
                           document.querySelector("textarea");
          if (textarea) {
            return textarea.value;
          }
        } catch (e) {
          console.error("LeetGit: Error extracting editor contents: ", e);
        }
        return null;
      }
    });

    code = results && results[0] ? results[0].result : null;
  } catch (err) {
    console.error("Failed to execute code extraction script:", err);
  }

  if (!code || code.trim() === "") {
    console.warn("LeetGit: Code extraction returned empty string or failed.");
    return { success: false, error: "Failed to extract code from LeetCode editor." };
  }

  // 3. Prepare push details
  const { problemSlug, problemTitle, language, extension } = payload;
  const path = `${problemSlug}/${problemSlug}${extension}`;
  const commitMessage = `✅ Solve: ${problemTitle} (${language})`;
  const base64Code = btoa(unescape(encodeURIComponent(code)));

  try {
    // 4. Check if file already exists to get its SHA
    let existingSha = null;
    const getFileUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${path}`;

    const checkResponse = await fetch(getFileUrl, {
      method: "GET",
      headers: {
        "Authorization": `token ${githubToken}`,
        "Accept": "application/vnd.github.v3+json"
      }
    });

    if (checkResponse.status === 200) {
      const fileData = await checkResponse.json();
      existingSha = fileData.sha;
    } else if (checkResponse.status === 401) {
      // Clear token since it is invalid
      chrome.storage.local.remove(["githubToken", "githubUsername", "repoName", "repoOwner"]);
      chrome.notifications.create({
        type: "basic",
        iconUrl: "/icons/icon128.png",
        title: "LeetGit Session Expired",
        message: "Your GitHub authentication token is invalid. Please log in again."
      });
      return { success: false, error: "Invalid token." };
    }

    // 5. Commit and Push solution to GitHub
    const putResponse = await fetch(getFileUrl, {
      method: "PUT",
      headers: {
        "Authorization": `token ${githubToken}`,
        "Content-Type": "application/json",
        "Accept": "application/vnd.github.v3+json"
      },
      body: JSON.stringify({
        message: commitMessage,
        content: base64Code,
        sha: existingSha || undefined
      })
    });

    if (putResponse.ok) {
      const putData = await putResponse.json();
      const githubUrl = putData.content.html_url || `https://github.com/${repoOwner}/${repoName}/blob/main/${path}`;

      // 6. Save success to pushHistory
      await updatePushHistory({
        problemTitle,
        language,
        timestamp: new Date().toISOString(),
        githubUrl
      });

      // 7. Show success notification
      chrome.notifications.create({
        type: "basic",
        iconUrl: "/icons/icon128.png",
        title: "Solution Pushed!",
        message: `✅ Pushed: ${problemTitle} to GitHub!`
      });

      return { success: true, githubUrl };
    } else {
      const errData = await putResponse.json();
      const errorMsg = errData.message || "Failed to commit changes.";
      
      chrome.notifications.create({
        type: "basic",
        iconUrl: "/icons/icon128.png",
        title: "Push Failed",
        message: `❌ LeetGit: Push failed. ${errorMsg}`
      });

      return { success: false, error: errorMsg };
    }

  } catch (err) {
    console.error("Network or API error:", err);
    chrome.notifications.create({
      type: "basic",
      iconUrl: "/icons/icon128.png",
      title: "Push Failed",
      message: `❌ Network error occurred while pushing to GitHub.`
    });
    return { success: false, error: err.message };
  }
}

// Save entry in history (Cap at 20 entries)
async function updatePushHistory(newEntry) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["pushHistory"], (data) => {
      let history = data.pushHistory || [];
      
      // Append entry
      history.push(newEntry);
      
      // Cap at 20
      if (history.length > 20) {
        history.shift(); // remove oldest element (first index)
      }

      chrome.storage.local.set({ pushHistory: history }, () => {
        resolve();
      });
    });
  });
}
