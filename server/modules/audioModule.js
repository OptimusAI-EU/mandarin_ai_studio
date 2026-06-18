const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function buildHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:5173',
    'X-OpenRouter-Title': 'Mandarin AI Studio'
  };
}

async function parseResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const msg = body?.error?.message || body?.message || `Request failed with ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function listAudioModels(apiKey) {
  const resp = await fetch(`${OPENROUTER_BASE}/audio/models`, {
    headers: buildHeaders(apiKey)
  });
  return parseResponse(resp);
}

async function textToSpeech(apiKey, payload) {
  const resp = await fetch(`${OPENROUTER_BASE}/audio/speech`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload)
  });
  return parseResponse(resp);
}

async function speechToText(apiKey, payload) {
  const resp = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload)
  });
  return parseResponse(resp);
}

module.exports = { listAudioModels, textToSpeech, speechToText };
