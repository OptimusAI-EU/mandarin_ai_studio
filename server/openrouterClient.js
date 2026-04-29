const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function buildHeaders(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:5173',
    'X-OpenRouter-Title': 'OpenRouter Video Studio',
    ...extra
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = body?.error?.message || body?.message || `OpenRouter request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function listVideoModels(apiKey) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/videos/models`, {
    headers: buildHeaders(apiKey)
  });
  return parseJsonResponse(response);
}

async function createVideoJob(apiKey, payload) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/videos`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload)
  });
  return parseJsonResponse(response);
}

async function pollVideoJob(apiKey, jobIdOrUrl) {
  const url = jobIdOrUrl.startsWith('http')
    ? jobIdOrUrl
    : `${OPENROUTER_BASE_URL}/videos/${jobIdOrUrl}`;

  const response = await fetch(url, {
    headers: buildHeaders(apiKey)
  });
  return parseJsonResponse(response);
}

async function downloadVideo(apiKey, jobId, index = 0) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/videos/${jobId}/content?index=${index}`, {
    headers: buildHeaders(apiKey, { Accept: 'video/*' })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Download failed with ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  listVideoModels,
  createVideoJob,
  pollVideoJob,
  downloadVideo
};
