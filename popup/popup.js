// Configuration constants - Update these with your deployed Vercel URL and GitHub Client ID
const VERCEL_BACKEND_URL = "https://leet-git.vercel.app"; // Replace with your Vercel deployment URL
const GITHUB_CLIENT_ID = "Ov23liVXe7tGjOu7GRJ1"; // Replace with your GitHub OAuth App Client ID

// DOM Elements
const stateLoggedOut = document.getElementById("state-logged-out");
const stateConfigureRepo = document.getElementById("state-configure-repo");
const stateActive = document.getElementById("state-active");

const btnConnect = document.getElementById("btn-connect");
const connectSpinner = document.getElementById("connect-spinner");
const loginError = document.getElementById("login-error");

const userAvatar = document.getElementById("user-avatar");
const usernameSpan = document.getElementById("username");
const repoNameInput = document.getElementById("repo-name");
const btnSaveRepo = document.getElementById("btn-save-repo");
const saveSpinner = document.getElementById("save-spinner");
const configError = document.getElementById("config-error");
const btnLogoutB = document.getElementById("btn-logout-b");

const repoLink = document.getElementById("repo-link");
const statTotal = document.getElementById("stat-total");
const statLastPushed = document.getElementById("stat-last-pushed");
const historyList = document.getElementById("history-list");
const btnDisconnect = document.getElementById("btn-disconnect");

// Initialize popup on load
document.addEventListener("DOMContentLoaded", () => {
  updateUI();
  setupEventListeners();
});

function setupEventListeners() {
  btnConnect.addEventListener("click", handleGitHubConnect);
  btnSaveRepo.addEventListener("click", handleSaveRepo);
  btnLogoutB.addEventListener("click", handleDisconnect);
  btnDisconnect.addEventListener("click", handleDisconnect);
}

// Function to update UI based on stored credentials
function updateUI() {
  chrome.storage.local.get(
    ["githubToken", "githubUsername", "avatarUrl", "repoOwner", "repoName", "pushHistory"],
    (data) => {
      // Hide all states first
      stateLoggedOut.style.display = "none";
      stateConfigureRepo.style.display = "none";
      stateActive.style.display = "none";

      if (data.githubToken) {
        if (data.repoName && data.repoOwner) {
          // STATE C: Fully Configured and Active
          stateActive.style.display = "flex";
          repoLink.textContent = `${data.repoOwner}/${data.repoName}`;
          repoLink.href = `https://github.com/${data.repoOwner}/${data.repoName}`;
          
          const history = data.pushHistory || [];
          statTotal.textContent = history.length;

          if (history.length > 0) {
            const last = history[history.length - 1];
            statLastPushed.innerHTML = `<strong>${last.problemTitle}</strong> (${last.language})<br><span style="color:var(--text-muted); font-size:0.75rem;">${timeAgo(last.timestamp)}</span>`;
          } else {
            statLastPushed.textContent = "None yet";
          }

          renderHistory(history);
        } else {
          // STATE B: Logged in but needs repo configuration
          stateConfigureRepo.style.display = "flex";
          userAvatar.src = data.avatarUrl || "https://github.com/identicons/guest.png";
          usernameSpan.textContent = `@${data.githubUsername}`;
          repoNameInput.value = "";
          configError.style.display = "none";
        }
      } else {
        // STATE A: Logged Out
        stateLoggedOut.style.display = "flex";
        loginError.style.display = "none";
      }
    }
  );
}

// State A: Initiate OAuth Flow
function handleGitHubConnect() {
  loginError.style.display = "none";
  
  if (GITHUB_CLIENT_ID === "YOUR_CLIENT_ID" || VERCEL_BACKEND_URL.includes("your-vercel-backend")) {
    showError(loginError, "Please set GITHUB_CLIENT_ID and VERCEL_BACKEND_URL in popup.js");
    return;
  }

  btnConnect.disabled = true;
  connectSpinner.style.display = "inline-block";

  const extensionId = chrome.runtime.id;
  const chromeRedirectUri = `https://${extensionId}.chromiumapp.org/`;
  
  const authUrl = `https://github.com/login/oauth/authorize` +
    `?client_id=${GITHUB_CLIENT_ID}` +
    `&scope=repo` +
    `&redirect_uri=${encodeURIComponent(VERCEL_BACKEND_URL + '/api/callback')}` +
    `&state=${encodeURIComponent(chromeRedirectUri)}`;

  chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  }, (responseUrl) => {
    btnConnect.disabled = false;
    connectSpinner.style.display = "none";

    if (chrome.runtime.lastError || !responseUrl) {
      console.error(chrome.runtime.lastError);
      showError(loginError, "Authentication was cancelled or failed.");
      return;
    }

    try {
      const urlObj = new URL(responseUrl);
      const code = urlObj.searchParams.get("code");
      
      if (!code) {
        showError(loginError, "No auth code returned from flow.");
        return;
      }

      exchangeCodeForToken(code);
    } catch (err) {
      console.error(err);
      showError(loginError, "Failed to parse authentication result.");
    }
  });
}

// Exchange the temporary OAuth code for access token via Vercel Backend
async function exchangeCodeForToken(code) {
  try {
    btnConnect.disabled = true;
    connectSpinner.style.display = "inline-block";

    const res = await fetch(`${VERCEL_BACKEND_URL}/api/github-oauth?code=${code}`);
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    if (!data.access_token) {
      throw new Error("No access token returned from exchange.");
    }

    // Fetch user profile info
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `token ${data.access_token}`,
        "Accept": "application/vnd.github.v3+json"
      }
    });

    if (!userRes.ok) {
      throw new Error("Failed to fetch user profile from GitHub API.");
    }

    const userData = await userRes.json();
    
    // Save info in local storage
    chrome.storage.local.set({
      githubToken: data.access_token,
      githubUsername: userData.login,
      avatarUrl: userData.avatar_url,
      pushHistory: [] // Initialize history
    }, () => {
      updateUI();
    });

  } catch (err) {
    console.error(err);
    showError(loginError, `Token exchange failed: ${err.message}`);
  } finally {
    btnConnect.disabled = false;
    connectSpinner.style.display = "none";
  }
}

// State B: Handle repository configuration and validation/auto-creation
async function handleSaveRepo() {
  configError.style.display = "none";
  const repoInput = repoNameInput.value.trim();

  if (!repoInput) {
    showError(configError, "Please enter a repository name.");
    return;
  }

  btnSaveRepo.disabled = true;
  saveSpinner.style.display = "inline-block";

  chrome.storage.local.get(["githubToken", "githubUsername"], async (data) => {
    const token = data.githubToken;
    let repoName = repoInput;
    let repoOwner = data.githubUsername;

    // Check if user entered owner/repo format
    if (repoInput.includes("/")) {
      const parts = repoInput.split("/");
      repoOwner = parts[0].trim();
      repoName = parts[1].trim();
    }

    if (!repoOwner || !repoName) {
      showError(configError, "Invalid repository format.");
      btnSaveRepo.disabled = false;
      saveSpinner.style.display = "none";
      return;
    }

    try {
      // Check if repository already exists
      const checkRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
        headers: {
          "Authorization": `token ${token}`,
          "Accept": "application/vnd.github.v3+json"
        }
      });

      if (checkRes.status === 200) {
        // Repo exists, save settings
        chrome.storage.local.set({
          repoName: repoName,
          repoOwner: repoOwner
        }, () => {
          updateUI();
        });
      } else if (checkRes.status === 404) {
        // Repo does not exist. If it belongs to logged-in user, auto-create it
        if (repoOwner.toLowerCase() === data.githubUsername.toLowerCase()) {
          const createRes = await fetch("https://api.github.com/user/repos", {
            method: "POST",
            headers: {
              "Authorization": `token ${token}`,
              "Content-Type": "application/json",
              "Accept": "application/vnd.github.v3+json"
            },
            body: JSON.stringify({
              name: repoName,
              private: true,
              auto_init: true,
              description: "LeetCode solutions synced automatically via LeetGit"
            })
          });

          if (createRes.status === 201) {
            chrome.storage.local.set({
              repoName: repoName,
              repoOwner: repoOwner
            }, () => {
              updateUI();
            });
          } else {
            const createData = await createRes.json();
            throw new Error(createData.message || "Failed to create repository.");
          }
        } else {
          showError(configError, "Repository not found. We can only auto-create repositories under your account.");
        }
      } else {
        throw new Error(`GitHub API returned status ${checkRes.status}`);
      }
    } catch (err) {
      console.error(err);
      showError(configError, `Error: ${err.message}`);
    } finally {
      btnSaveRepo.disabled = false;
      saveSpinner.style.display = "none";
    }
  });
}

// Disconnect OAuth & Configuration
function handleDisconnect() {
  chrome.storage.local.clear(() => {
    updateUI();
  });
}

// Helper: Show Error Messages
function showError(element, msg) {
  element.textContent = msg;
  element.style.display = "block";
}

// Helper: Render Push History (Recent 5 pushes scrollable list)
function renderHistory(history) {
  historyList.innerHTML = "";
  
  if (history.length === 0) {
    historyList.innerHTML = `<div style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:10px 0;">No pushes recorded yet.</div>`;
    return;
  }

  // Reverse list to show newest first, and take top 5
  const displayHistory = [...history].reverse().slice(0, 5);

  displayHistory.forEach(item => {
    const historyItem = document.createElement("div");
    historyItem.className = "history-item";

    const historyInfo = document.createElement("div");
    historyInfo.className = "history-info";

    const name = document.createElement("div");
    name.className = "history-name";
    name.textContent = item.problemTitle;
    name.title = item.problemTitle;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${item.language} • ${timeAgo(item.timestamp)}`;

    historyInfo.appendChild(name);
    historyInfo.appendChild(meta);

    const link = document.createElement("a");
    link.className = "history-link";
    link.href = item.githubUrl;
    link.target = "_blank";
    link.title = "View commit on GitHub";
    link.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
    `;

    historyItem.appendChild(historyInfo);
    historyItem.appendChild(link);
    historyList.appendChild(historyItem);
  });
}

// Simple human-readable time ago parser
function timeAgo(timestamp) {
  const now = new Date();
  const past = new Date(timestamp);
  const msPerMinute = 60 * 1000;
  const msPerHour = msPerMinute * 60;
  const msPerDay = msPerHour * 24;
  const elapsed = now - past;

  if (elapsed < msPerMinute) {
    return "just now";
  } else if (elapsed < msPerHour) {
    const mins = Math.round(elapsed / msPerMinute);
    return mins === 1 ? "1 min ago" : `${mins} mins ago`;
  } else if (elapsed < msPerDay) {
    const hours = Math.round(elapsed / msPerHour);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  } else {
    const days = Math.round(elapsed / msPerDay);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
}
