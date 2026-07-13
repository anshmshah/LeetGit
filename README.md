# LeetGit — LeetCode to GitHub Sync

**LeetGit** is a lightweight, premium Manifest V3 Chrome Extension that automatically pushes your accepted LeetCode solutions to a designated GitHub repository in real time. It uses a secure, minimal serverless Vercel backend to manage the GitHub OAuth exchange without hardcoding client secrets in client-side extension code.

---

## Features
- **Instant Syncing:** Automatically detects when a submission status transitions to "Accepted".
- **Multi-layered Detection:** Uses MutationObserver, network fetch interception, and SPA route changes to capture submissions reliably.
- **Direct Monaco Extraction:** Safely extracts the code directly from Monaco Editor models (or fallbacks) inside the page.
- **Repository Setup:** Checks if your target repo exists, and automatically creates a private repository for you if it doesn't.
- **History Tracking:** Displays a rolling history of your last 5 pushed submissions and a running total count right in the extension popup dashboard.

---

## File Structure

```
leethub-clone/
├── manifest.json              # Extension manifest (Manifest V3)
├── popup/
│   ├── popup.html             # Sleek dark mode dashboard
│   └── popup.js               # Popup state & OAuth exchange logic
├── background/
│   └── background.js          # Service worker for pushing solutions and notifications
├── content/
│   ├── leetcode.js            # Content script (Isolated World) monitoring DOM & SPA
│   └── leetcode-main.js       # Content script (MAIN World) intercepting network requests
├── icons/
│   └── icon128.png            # 128x128 app icon
└── vercel-backend/
    ├── api/
    │   ├── github-oauth.js    # OAuth code-to-token exchanger
    │   └── callback.js        # Safe OAuth redirect validator
    └── package.json           # Backend dependencies and node configuration
```

---

## Step-by-Step Setup Instructions

### 1. Create a GitHub OAuth App
To allow the extension to push code to your GitHub account securely, you must create a GitHub OAuth application:

1. Go to your GitHub profile: **Settings** → **Developer settings** → **OAuth Apps** → Click **New OAuth App** (or go to [https://github.com/settings/developers](https://github.com/settings/developers)).
2. Fill in the fields:
   - **Application name:** `LeetGit` (or any name you choose)
   - **Homepage URL:** `https://github.com` (or your deployed Vercel URL later)
   - **Application description:** `Sync LeetCode solutions to GitHub`
   - **Authorization callback URL:** `https://<YOUR_VERCEL_APP_SUBDOMAIN>.vercel.app/api/callback`
     > [!IMPORTANT]
     > *Note: If you do not have your Vercel URL yet, you can create the Vercel project first, retrieve the domain, and then paste it here.*
3. Click **Register application**.
4. Save the displayed **Client ID**.
5. Click **Generate a new client secret** and save the secret value immediately. You will need it in the next step.

---

### 2. Deploy the Vercel Backend
The Vercel backend performs the secure client secret exchange.

1. **Deploy to Vercel:**
   You can deploy the `vercel-backend` folder to Vercel using the Vercel CLI or by linking a GitHub repository containing the files.
   - Using Vercel CLI:
     ```bash
     cd vercel-backend
     vercel
     ```
2. **Configure Environment Variables:**
   In your Vercel Dashboard, navigate to your project settings → **Environment Variables** and add:
   - **Name:** `GITHUB_CLIENT_ID`
     - **Value:** *Your GitHub App Client ID*
   - **Name:** `GITHUB_CLIENT_SECRET`
     - **Value:** *Your GitHub App Client Secret*
3. **Deploy to Production:**
   Run `vercel --prod` to complete the deployment. Write down your production domain (e.g., `https://leetgit-backend.vercel.app`).

---

### 3. Configure the Extension Files
Now, configure the client-side code in the extension files with your credentials.

1. Open [popup/popup.js](file:///d:/LeetGit%20AutoPush/popup/popup.js):
   - Update `VERCEL_BACKEND_URL` with your deployed Vercel domain:
     ```javascript
     const VERCEL_BACKEND_URL = "https://<YOUR_VERCEL_APP_SUBDOMAIN>.vercel.app";
     ```
   - Update `GITHUB_CLIENT_ID` with your GitHub Client ID:
     ```javascript
     const GITHUB_CLIENT_ID = "YOUR_CLIENT_ID_HERE";
     ```
2. Open [background/background.js](file:///d:/LeetGit%20AutoPush/background/background.js):
   - Update `VERCEL_BACKEND_URL` with your deployed Vercel domain:
     ```javascript
     const VERCEL_BACKEND_URL = "https://<YOUR_VERCEL_APP_SUBDOMAIN>.vercel.app";
     ```

---

### 4. Load the Extension in Google Chrome
To install and test your extension locally:

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` by typing it into the URL bar.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the root folder `LeetGit AutoPush` of this project (the directory containing `manifest.json`).
6. Pin **LeetGit** to your toolbar for easy access.

---

## How to Test and Sync

1. Click on the LeetGit extension icon in your toolbar.
2. Click **Connect GitHub**. It will open the GitHub authorization screen in a popup.
3. Once authorized, enter the repository name (e.g., `leetcode-solutions`) in the input box and click **Save & Configure**.
   - *If the repository does not exist, LeetGit will automatically create a private, initialized repo for you!*
4. Go to any LeetCode problem (e.g., [Two Sum](https://leetcode.com/problems/two-sum/)).
5. Submit a working solution.
6. Once the page displays **Accepted**, you will receive a Chrome system notification: `✅ Pushed: Two Sum to GitHub!`
7. Open the extension popup again to see your updated total count, last pushed problem metadata, and a link to the commit!

---

## File Structure in GitHub Repo
Solutions are organized in folders named after the problem's slug:
```
your-repo-name/
└── two-sum/
    └── two-sum.py
```
If you submit multiple solutions in different languages for the same problem, they will be organized side by side:
```
your-repo-name/
└── two-sum/
    ├── two-sum.py
    └── two-sum.java
```
