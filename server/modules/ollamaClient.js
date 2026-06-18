const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');

async function ollamaFetch(path, options = {}) {
  const resp = await fetch(`${OLLAMA_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Ollama request failed: ${resp.status}`);
  }
  return resp;
}

async function listLocalModels() {
  const resp = await ollamaFetch('/api/tags');
  const data = await resp.json();
  return data.models || [];
}

async function ollamaGenerateImage(model, prompt, options = {}) {
  const resp = await ollamaFetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model, prompt, stream: false, ...options })
  });
  return resp.json();
}

async function ollamaTTS(model, text) {
  const resp = await ollamaFetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model, prompt: text, stream: false })
  });
  return resp.arrayBuffer();
}

module.exports = { listLocalModels, ollamaGenerateImage, ollamaTTS, ollamaFetch };
