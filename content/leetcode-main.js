// LeetGit - Main World Network Interceptor
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = args[0];
      if (typeof url === "string") {
        // 1. Direct check endpoint poll (e.g. /submissions/detail/12345/check/)
        if (url.includes("/submissions/detail/") && url.includes("/check/")) {
          const cloned = response.clone();
          cloned.json().then(data => {
            if (data && data.status_msg === "Accepted") {
              window.dispatchEvent(new CustomEvent("leetgit-accepted", {
                detail: {
                  problemSlug: data.title_slug || "",
                  problemTitle: data.title || "",
                  language: data.lang || ""
                }
              }));
            }
          }).catch(err => console.error("LeetGit check parsing error:", err));
        }

        // 2. GraphQL checking
        if (url.includes("/graphql")) {
          const cloned = response.clone();
          cloned.json().then(data => {
            const str = JSON.stringify(data);
            if (str.includes('"status_msg":"Accepted"') || str.includes('"status_msg": "Accepted"')) {
              window.dispatchEvent(new CustomEvent("leetgit-accepted-graphql", {
                detail: data
              }));
            }
          }).catch(err => console.error("LeetGit graphql parsing error:", err));
        }
      }
    } catch (e) {
      // Fail silently to not disrupt the website
    }
    return response;
  };
})();
