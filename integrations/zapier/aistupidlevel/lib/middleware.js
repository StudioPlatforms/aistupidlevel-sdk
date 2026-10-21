const { ROUTER_URL, DATA_URL } = require('./constants');

/**
 * Router calls carry the router key; Data API calls carry the data key. A connection in sandbox mode
 * adds X-ASL-Sandbox to router calls: real routing, a mock answer, nothing spent or counted.
 */
const addAuth = (request, z, bundle) => {
  const auth = bundle.authData || {};
  request.headers = request.headers || {};
  if (request.url.startsWith(DATA_URL)) {
    if (auth.dataKey) request.headers.Authorization = `Bearer ${auth.dataKey}`;
  } else if (request.url.startsWith(ROUTER_URL)) {
    request.headers.Authorization = `Bearer ${auth.routerKey}`;
    if (auth.mode === 'sandbox') request.headers['X-ASL-Sandbox'] = 'true';
  }
  request.headers['User-Agent'] = 'aistupidlevel-zapier/1.0.0';
  return request;
};

/** Turn API errors into messages that say what to fix. */
const handleErrors = (response, z) => {
  if (response.status < 400) return response;
  let message = '';
  try {
    const body = response.json;
    message = (body && (body.error && (body.error.message || body.error)) || body.message) || '';
    if (typeof message !== 'string') message = JSON.stringify(message);
  } catch (e) { message = response.content || ''; }
  if (response.status === 401) {
    throw new z.errors.Error(`AI Stupid Level refused the key: ${message || 'unauthorized'}. Check it at https://aistupidlevel.info/router/keys.`, 'AuthenticationError', 401);
  }
  if (response.status === 429) {
    throw new z.errors.ThrottledError(message || 'Rate limited by AI Stupid Level.', Number(response.getHeader('retry-after')) || 60);
  }
  throw new z.errors.Error(message || `AI Stupid Level answered ${response.status}.`, 'ApiError', response.status);
};

module.exports = { addAuth, handleErrors };
