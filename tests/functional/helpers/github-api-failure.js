async function failNextGitHubApi(page, {
  status = 500,
  message = 'Errore GitHub simulato',
  method = '',
  pathIncludes = ''
} = {}) {
  let pending = true;

  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const methodMatches = !method || request.method() === method;
    const pathMatches = !pathIncludes || pathname.includes(pathIncludes);

    if (!pending || !methodMatches || !pathMatches) {
      return route.fallback();
    }

    pending = false;
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ message })
    });
  });
}

module.exports = { failNextGitHubApi };
