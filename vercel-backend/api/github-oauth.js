// Vercel serverless function: api/github-oauth.js
export default async function handler(req, res) {
  // Set CORS headers to allow requests from Chrome extensions
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { code } = req.query;

  if (!code) {
    res.status(400).json({ error: "Missing 'code' parameter in query." });
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(500).json({ 
      error: "Server configuration error. Environment variables GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set on Vercel." 
    });
    return;
  }

  try {
    const githubResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code
      })
    });

    const data = await githubResponse.json();

    if (data.error) {
      res.status(400).json(data);
    } else {
      res.status(200).json(data);
    }
  } catch (err) {
    console.error("Token exchange error:", err);
    res.status(500).json({ error: "Internal server error occurred during token exchange." });
  }
}
