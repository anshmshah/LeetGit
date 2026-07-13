// Configuration constants - Update these with your deployed Vercel URL
const VERCEL_BACKEND_URL = "https://leet-git.vercel.app"; // Replace with your Vercel deployment URL

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

  if (message.type === "EXTRACT_CODE_NOW") {
    extractCodeFromTab(sender.tab.id)
      .then((code) => sendResponse({ code }))
      .catch((err) => {
        console.error("Error extracting code:", err);
        sendResponse({ error: err.message });
      });
    return true; // Keep message channel open for asynchronous sendResponse
  }
});

// Helper to safely trigger extension desktop notifications without crashing on permission errors
function safeNotify(options) {
  if (typeof chrome !== "undefined" && chrome.notifications && chrome.notifications.create) {
    try {
      chrome.notifications.create(options);
    } catch (err) {
      console.warn("LeetGit: Notification error:", err);
    }
  } else {
    console.log(`LeetGit Notification [${options.title}]: ${options.message}`);
  }
}

// Fetch problem metadata (Difficulty, Title, Tags, Number) from LeetCode's public GraphQL API
async function fetchLeetCodeProblemInfo(slug) {
  try {
    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        query: `
          query questionData($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionFrontendId
              title
              difficulty
              topicTags {
                name
              }
            }
          }
        `,
        variables: { titleSlug: slug }
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      if (result.data && result.data.question) {
        const q = result.data.question;
        return {
          questionId: q.questionFrontendId || "",
          title: q.title || "",
          difficulty: q.difficulty || "Easy",
          tags: q.topicTags ? q.topicTags.map(t => t.name) : [],
          slug: slug
        };
      }
    }
  } catch (err) {
    console.error("LeetGit: Error fetching LeetCode metadata:", err);
  }
  return null;
}

// Convert extension suffix to readable language name
function getLangNameFromExtension(ext) {
  const map = {
    ".cpp": "C++",
    ".py": "Python",
    ".java": "Java",
    ".js": "JavaScript",
    ".ts": "TypeScript",
    ".cs": "C#",
    ".go": "Go",
    ".rs": "Rust",
    ".kt": "Kotlin",
    ".swift": "Swift",
    ".rb": "Ruby",
    ".scala": "Scala",
    ".php": "PHP",
    ".c": "C"
  };
  return map[ext] || "Solution";
}

// Parse existing README markdown table and insert/update current problem solution links
function updateReadmeContent(existingContent, info, relativeFileLink, extension) {
  const headers = "| # | Title | Difficulty | Category / Tags | Solution |";
  const divider = "|---|---|---|---|---|";
  
  let lines = existingContent ? existingContent.split("\n") : [];
  let tableStartIndex = -1;
  let parsedRows = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.toLowerCase().includes("difficulty") && line.toLowerCase().includes("solution")) {
      tableStartIndex = i;
      break;
    }
  }
  
  // Parse existing rows from markdown table
  if (tableStartIndex !== -1) {
    for (let i = tableStartIndex + 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("|")) {
        const parts = line.split("|").map(p => p.trim());
        // parts array: ["", "#", "Title Link", "Difficulty Badge", "Tags", "Solutions Link(s)", ""]
        if (parts.length >= 6) {
          parsedRows.push({
            id: parts[1],
            title: parts[2],
            difficulty: parts[3],
            tags: parts[4],
            solutions: parts[5]
          });
        }
      } else if (line === "" && parsedRows.length > 0) {
        break; // End of table
      }
    }
  }
  
  const langName = getLangNameFromExtension(extension);
  const solLink = `[${langName}](${relativeFileLink})`;
  
  // Check if problem already exists in our table rows
  const existingRow = parsedRows.find(r => r.id === info.questionId);
  if (existingRow) {
    // Add solution link if it isn't listed
    if (!existingRow.solutions.includes(solLink)) {
      if (existingRow.solutions.trim() === "" || existingRow.solutions === "-") {
        existingRow.solutions = solLink;
      } else {
        existingRow.solutions += `, ${solLink}`;
      }
    }
  } else {
    // Determine shields.io color badge based on difficulty
    const badgeColor = info.difficulty === "Easy" ? "brightgreen" : (info.difficulty === "Medium" ? "orange" : "red");
    const diffBadge = `![${info.difficulty}](https://img.shields.io/badge/-${info.difficulty}-${badgeColor})`;
    
    parsedRows.push({
      id: info.questionId,
      title: `[${info.title}](https://leetcode.com/problems/${info.slug}/)`,
      difficulty: diffBadge,
      tags: info.tags.join(", ") || "-",
      solutions: solLink
    });
  }
  
  // Sort rows ascending by problem number
  parsedRows.sort((a, b) => {
    const aNum = parseInt(a.id, 10) || 99999;
    const bNum = parseInt(b.id, 10) || 99999;
    return aNum - bNum;
  });
  
  // Reconstruct README
  let newContent = "";
  if (tableStartIndex !== -1) {
    newContent = lines.slice(0, tableStartIndex).join("\n") + "\n";
  } else {
    newContent = "# LeetCode Solutions\n\nA collection of LeetCode solutions synced automatically with LeetGit.\n\n";
  }
  
  newContent += headers + "\n" + divider + "\n";
  parsedRows.forEach(r => {
    newContent += `| ${r.id} | ${r.title} | ${r.difficulty} | ${r.tags} | ${r.solutions} |\n`;
  });
  
  // Append trailing markdown contents if any
  if (tableStartIndex !== -1) {
    let tableEndIndex = tableStartIndex + 2 + parsedRows.length;
    let actualEnd = tableEndIndex;
    while (actualEnd < lines.length && (lines[actualEnd].trim().startsWith("|") || lines[actualEnd].trim() === "")) {
      actualEnd++;
    }
    if (actualEnd < lines.length) {
      newContent += "\n" + lines.slice(actualEnd).join("\n");
    }
  }
  
  return newContent;
}

// Push updated README.md to GitHub repository
async function pushReadmeUpdate(repoOwner, repoName, githubToken, info, relativeFileLink, extension) {
  const path = "README.md";
  const readmeUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${path}`;
  
  let existingSha = null;
  let existingContent = "";
  
  try {
    const getRes = await fetch(readmeUrl, {
      method: "GET",
      headers: {
        "Authorization": `token ${githubToken}`,
        "Accept": "application/vnd.github.v3+json"
      }
    });
    
    if (getRes.status === 200) {
      const data = await getRes.json();
      existingSha = data.sha;
      existingContent = decodeURIComponent(escape(atob(data.content)));
    }
    
    const updatedContent = updateReadmeContent(existingContent, info, relativeFileLink, extension);
    const base64Content = btoa(unescape(encodeURIComponent(updatedContent)));
    
    await fetch(readmeUrl, {
      method: "PUT",
      headers: {
        "Authorization": `token ${githubToken}`,
        "Content-Type": "application/json",
        "Accept": "application/vnd.github.v3+json"
      },
      body: JSON.stringify({
        message: `📝 Update README: ${info.title} (${getLangNameFromExtension(extension)})`,
        content: base64Content,
        sha: existingSha || undefined
      })
    });
    console.log("LeetGit: README.md updated successfully!");
  } catch (err) {
    console.error("LeetGit: Error pushing README update:", err);
  }
}

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
    safeNotify({
      type: "basic",
      iconUrl: "/icons/icon128.png",
      title: "LeetGit Configuration Required",
      message: "Please configure your GitHub connection and repository in the extension popup."
    });
    return { success: false, error: "Configuration missing." };
  }

  // 2. Retrieve extracted code from the payload
  let code = payload.code || null;

  if (!code || code.trim() === '') {
    console.warn("LeetGit: Code extraction returned empty.");
    safeNotify({
      type: "basic",
      iconUrl: "/icons/icon128.png", 
      title: "Push Failed",
      message: "❌ Could not extract code from editor. Try submitting again."
    });
    return { success: false, error: "Failed to extract code from LeetCode editor." };
  }

  const { problemSlug, problemTitle, language, extension } = payload;

  // 3. Fetch difficulty, ID and tags from LeetCode API
  const info = await fetchLeetCodeProblemInfo(problemSlug) || {
    questionId: "",
    title: problemTitle,
    difficulty: "Easy",
    tags: [],
    slug: problemSlug
  };

  // If GraphQL fails to get ID, try extracting from title
  if (!info.questionId) {
    const match = problemTitle.match(/^(\d+)\./);
    info.questionId = match ? match[1] : "";
    info.title = problemTitle.replace(/^\d+\.\s*/, "");
  }

  // Group files into categorized folders: Easy/ Medium/ Hard/
  const difficultyDir = info.difficulty; // e.g. "Easy", "Medium", "Hard"
  const path = `${difficultyDir}/${problemSlug}/${problemSlug}${extension}`;
  const commitMessage = `✅ Solve: ${info.title} (${language})`;
  const base64Code = btoa(unescape(encodeURIComponent(code)));

  try {
    // 4. Check if file already exists to get its SHA (at the categorized path)
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
      safeNotify({
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
        problemTitle: info.title,
        language,
        timestamp: new Date().toISOString(),
        githubUrl
      });

      // 7. Update README.md automatically
      await pushReadmeUpdate(repoOwner, repoName, githubToken, info, path, extension);

      // 8. Show success notification
      safeNotify({
        type: "basic",
        iconUrl: "/icons/icon128.png",
        title: "Solution Pushed!",
        message: `✅ Pushed: ${info.title} to GitHub!`
      });

      return { success: true, githubUrl };
    } else {
      const errData = await putResponse.json();
      const errorMsg = errData.message || "Failed to commit changes.";
      
      safeNotify({
        type: "basic",
        iconUrl: "/icons/icon128.png",
        title: "Push Failed",
        message: `❌ LeetGit: Push failed. ${errorMsg}`
      });

      return { success: false, error: errorMsg };
    }

  } catch (err) {
    console.error("Network or API error:", err);
    safeNotify({
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

// Safely query and extract code from editor contexts in the target tab's MAIN world
async function extractCodeFromTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: "MAIN",
      func: () => {
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
          console.error("LeetGit extract error:", e);
        }
        return null;
      }
    });
    return results && results[0] ? results[0].result : null;
  } catch (err) {
    console.error("Failed to execute scripting extraction:", err);
    return null;
  }
}
