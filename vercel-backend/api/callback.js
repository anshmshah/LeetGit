// Vercel serverless function: api/callback.js
export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).send("<h3>Error: Missing 'code' or 'state' parameters.</h3><p>Ensure you are initiating login from the Chrome extension.</p>");
    return;
  }

  // Validate the state URL to prevent Open Redirect vulnerabilities.
  // The state parameter must match a Chrome Extension identity URI format:
  // https://<extension-id>.chromiumapp.org/
  const isChromeIdentityUrl = /^https:\/\/[a-z0-9]+\.chromiumapp\.org\/?$/i.test(state);

  if (!isChromeIdentityUrl) {
    res.status(400).send("<h3>Error: Security check failed.</h3><p>The redirection target is invalid. Only chromiumapp.org redirects are allowed.</p>");
    return;
  }

  // Build the redirection target
  // Ensure we append the code cleanly to the target URL
  const separator = state.endsWith("/") ? "" : "/";
  const redirectTarget = `${state}${separator}?code=${code}`;

  // Perform HTTP 302 Redirect
  res.writeHead(302, { Location: redirectTarget });
  res.end();
}
