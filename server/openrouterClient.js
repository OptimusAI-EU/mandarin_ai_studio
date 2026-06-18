const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function buildHeaders(apiKey, extra = {}) {
  return {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:5173',
    'X-OpenRouter-Title': 'Mandarin AI Studio',
    ...extra
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    const body = text ? JSON.parse(text) : {};
    const message = (body && body.error && body.error.message) || body.message || 'Request failed with ' + response.status;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

// === Fetch models by output modality using ?output_modalities= query parameter ===
// This is the correct OpenRouter API endpoint for filtering models by output modality
// Returns ALL models for that modality, not just the ones with output_modalities set in their architecture
async function fetchModelsByModality(apiKey, outputModality) {
  const url = OPENROUTER_BASE_URL + '/models?output_modalities=' + outputModality;
  const response = await fetch(url, { headers: buildHeaders(apiKey) });
  return parseJsonResponse(response);
}

// === Video ===
async function createVideoJob(apiKey, payload) {
  const response = await fetch(OPENROUTER_BASE_URL + '/videos', {
    method: 'POST', headers: buildHeaders(apiKey), body: JSON.stringify(payload)
  });
  return parseJsonResponse(response);
}

async function pollVideoJob(apiKey, jobIdOrUrl) {
  const url = jobIdOrUrl.startsWith('http') ? jobIdOrUrl : OPENROUTER_BASE_URL + '/videos/' + jobIdOrUrl;
  const response = await fetch(url, { headers: buildHeaders(apiKey) });
  return parseJsonResponse(response);
}

async function downloadVideo(apiKey, jobId, index) {
  index = index || 0;
  const response = await fetch(OPENROUTER_BASE_URL + '/videos/' + jobId + '/content?index=' + index, {
    headers: buildHeaders(apiKey, { Accept: 'video/*' })
  });
  if (!response.ok) throw new Error('Download failed with ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}

// === Image ===
async function createImageJob(apiKey, payload) {
  const response = await fetch(OPENROUTER_BASE_URL + '/images/generations', {
    method: 'POST', headers: buildHeaders(apiKey), body: JSON.stringify(payload)
  });
  return parseJsonResponse(response);
}

// === Audio ===
async function createTTSJob(apiKey, payload) {
  const response = await fetch(OPENROUTER_BASE_URL + '/audio/speech', {
    method: 'POST', headers: buildHeaders(apiKey), body: JSON.stringify(payload)
  });
  return parseJsonResponse(response);
}

async function createSTTJob(apiKey, payload) {
  const response = await fetch(OPENROUTER_BASE_URL + '/audio/transcriptions', {
    method: 'POST', headers: buildHeaders(apiKey), body: JSON.stringify(payload)
  });
  return parseJsonResponse(response);
}

// === Chat Completions ===
async function createChatCompletion(apiKey, payload) {
  const response = await fetch(OPENROUTER_BASE_URL + '/chat/completions', {
    method: 'POST', headers: buildHeaders(apiKey), body: JSON.stringify(payload)
  });
  return parseJsonResponse(response);
}

module.exports = {
  fetchModelsByModality,
  createVideoJob, pollVideoJob, downloadVideo,
  createImageJob,
  createTTSJob, createSTTJob,
  createChatCompletion
};
