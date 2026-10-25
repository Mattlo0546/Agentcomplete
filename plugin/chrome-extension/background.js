const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTES = [
  [/^\/v1\/enhance$/, ['POST']],
  [/^\/v1\/health$/, ['GET']],
  [/^\/v1\/settings$/, ['GET', 'PUT']],
  [/^\/v1\/knowledge$/, ['GET', 'POST']],
  [/^\/v1\/knowledge\/[A-Za-z0-9_-]+$/, ['GET', 'PATCH', 'DELETE']],
  [/^\/v1\/tags$/, ['GET']],
  [/^\/v1\/traces\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^\/v1\/outcomes$/, ['POST']],
  [/^\/v1\/stats$/, ['GET']],
  [/^\/v1\/logs$/, ['GET', 'DELETE']],
  [/^\/v1\/logs\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^\/v1\/analytics\/status$/, ['GET']],
  [/^\/v1\/analytics\/(export|train)$/, ['POST']],
  [/^\/v1\/handoff$/, ['POST']],
];

function apiAllowed(path, method) {
  if (typeof path !== 'string' || path.length > 3000 || !METHODS.has(method)) return false;
  if (!path.startsWith('/v1/') || path.includes('..') || path.includes('#') || path.includes('\\')) return false;
  const pathname = path.split('?')[0];
  return ROUTES.some(([pattern, methods]) => pattern.test(pathname) && methods.includes(method));
}

async function proxy(path, method = 'GET', body) {
  let config;
  try {
    const response = await fetch(chrome.runtime.getURL('.runtime.json'), {cache: 'no-store'});
    if (!response.ok) throw new Error();
    config = await response.json();
    const url = new URL(config.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password || url.search || url.hash || typeof config.token !== 'string') throw new Error();
  } catch {
    throw new Error('Start the local OpenAI bridge, then reload the extension.');
  }
  const nativeOnly = body?.autocomplete_only === true;
  const requestBody = body && typeof body === 'object' ? {...body} : body;
  if (requestBody) delete requestBody.autocomplete_only;
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json', ...(nativeOnly ? {'X-Skill-Issue-Autocomplete-Only': 'true'} : {})},
    ...(requestBody === undefined ? {} : {body: JSON.stringify(requestBody)}),
    signal: AbortSignal.timeout(25000),
    redirect: 'error',
  });
  const contentType = response.headers?.get?.('content-type') || '';
  const data = response.status === 204 ? null : contentType.includes('text/event-stream') ? {__sse: await response.text()} : await response.json();
  return {status: response.status, data};
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  const fromChatGPT = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(sender.url || '');
  const senderUrl = sender.url || '';
  const fromPopup = senderUrl === chrome.runtime.getURL('popup.html');
  if (!fromChatGPT && !fromPopup) return;
  if (message.type === 'api' && (fromPopup || fromChatGPT)) {
    const method = message.method || 'GET';
    if (!apiAllowed(message.path, method)) {
      respond({status: 403, data: {error: {code: 'forbidden', message: 'This route is not available to the extension.'}}});
      return;
    }
    if (message.body !== undefined && (typeof message.body !== 'object' || message.body === null || JSON.stringify(message.body).length > 600000)) {
      respond({status: 413, data: {error: {code: 'invalid_request', message: 'Request body is too large or invalid.'}}});
      return;
    }
    proxy(message.path, method, message.body).then(respond).catch(error => respond({status: 0, data: {error: {code: 'bridge_unavailable', message: error.message || 'OpenAI bridge unavailable.'}}}));
    return true;
  }
  if (message.type === 'health') {
    proxy('/health').then(({status, data}) => respond(status < 400 ? data : {error: data?.error?.message || 'Bridge unavailable.'})).catch(error => respond({error: error.message}));
    return true;
  }
  if (message.type === 'open-settings' && fromChatGPT) {
    chrome.runtime.openOptionsPage().then(() => respond({ok: true})).catch(() => respond({error: 'Open settings from the extension toolbar icon.'}));
    return true;
  }
});
