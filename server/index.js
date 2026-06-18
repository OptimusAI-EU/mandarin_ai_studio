const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  getSettings, updateSettings, saveModels, listModels,
  saveAsset, getAsset, createSession, getSession, listSessions,
  appendMessage, updateSessionTitle, deleteSession,
  createJob, updateJob, getJob, listJobs, deleteJob,
  createArtifact, getArtifact, listArtifacts, deleteArtifact,
  makeId, nowIso
} = require('./db');
const openrouter = require('./openrouterClient');

function loadEnv() {
  const envPath = path.join(workspaceRoot, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

const app = express();
const port = Number(process.env.PORT || 4317);
const workspaceRoot = path.resolve(__dirname, '..');
loadEnv();
app.use(express.json({ limit: '50mb' }));

function requireApiKey() {
  const envKey = process.env.OPENROUTER_API_KEY;
  const dbKey = getSettings().apiKey;
  const apiKey = envKey || dbKey;
  if (!apiKey) { const e = new Error('OpenRouter API key not configured.'); e.status = 400; throw e; }
  return apiKey;
}

function normalizeStatus(s) { if (s === 'pending') return 'queued'; if (s === 'in_progress') return 'processing'; return s || 'unknown'; }
function terminalStatus(s) { return ['completed','failed','cancelled','expired','timeout'].includes(s); }
function activeStatus(s) { return ['submitting','queued','processing','pending','in_progress'].includes(s); }

function toClientJob(job) {
  return {
    id: job.id, sessionId: job.session_id, batchId: job.batch_id, batchIndex: job.batch_index,
    openrouterJobId: job.openrouter_job_id, generationId: job.generation_id, status: job.status,
    modality: job.modality, mode: job.mode, model: job.model, provider: job.provider,
    prompt: job.prompt, payload: job.payload, response: job.response, result: job.result,
    error: job.error, localPath: job.local_path, contentType: job.content_type,
    createdAt: job.created_at, updatedAt: job.updated_at, completedAt: job.completed_at,
    contentUrl: job.status === 'completed' ? '/api/jobs/' + job.id + '/content' : null
  };
}

function toClientSettings(s) {
  return { ...s, apiKey: '', hasApiKey: Boolean(process.env.OPENROUTER_API_KEY) || Boolean(s.apiKey) };
}

function buildPayload(body) {
  const seed = body.seed === '' || body.seed == null ? undefined : Number(body.seed);
  const payload = {
    model: body.model, prompt: body.prompt,
    duration: body.duration ? Number(body.duration) : undefined,
    resolution: body.resolution || undefined,
    aspect_ratio: body.aspectRatio || body.aspect_ratio || undefined,
    size: body.size || undefined,
    generate_audio: typeof body.generateAudio === 'boolean' ? body.generateAudio : typeof body.generate_audio === 'boolean' ? body.generate_audio : undefined,
    seed: Number.isFinite(seed) ? seed : undefined,
    provider: body.provider || undefined
  };
  Object.keys(payload).forEach(k => { if (payload[k] === undefined || payload[k] === '') delete payload[k]; });
  if (Array.isArray(body.frame_images) && body.frame_images.length > 0) {
    payload.frame_images = body.frame_images;
  } else if (Array.isArray(body.frameImages) && body.frameImages.length > 0) {
    payload.frame_images = body.frameImages.map(f => {
      const asset = getAsset(f.assetId);
      if (!asset) throw Object.assign(new Error('Missing asset ' + f.assetId), { status: 400 });
      return { type: 'image_url', frame_type: f.frameType, image_url: { url: asset.data_url } };
    });
  }
  return payload;
}

// Categorize model by output_modalities
function categorizeModel(model) {
  const arch = model.architecture || {};
  const outMods = arch.output_modalities || [];
  const inMods = arch.input_modalities || [];
  const id = (model.id || '').toLowerCase();

  // Primary: check output_modalities
  if (outMods.includes('video')) return 'video';
  if (outMods.includes('image')) return 'image';
  if (outMods.includes('audio') || outMods.includes('speech')) return 'audio';
  if (outMods.includes('text')) {
    // If it also accepts image input, it's an image model per review requirement
    if (inMods.includes('image')) return 'image';
    return 'text';
  }
  if (outMods.includes('3d') || outMods.includes('mesh')) return '3d';
  if (outMods.includes('embeddings') || outMods.includes('rerank')) return 'others';

  // Fallback: check input_modalities for image+text->text models (should be image per review)
  if (inMods.includes('image') && inMods.includes('text') && outMods.length === 0) {
    return 'image';
  }

  // Fallback: model ID patterns
  if (id.includes('video') || id.includes('veo') || id.includes('kling') || id.includes('sora') || id.includes('runway') || id.includes('pika')) return 'video';
  if (id.includes('dall-e') || id.includes('flux') || id.includes('midjourney') || id.includes('stable-diffusion') || id.includes('sdxl') || id.includes('imagen')) return 'image';
  if (id.includes('tts') || id.includes('stt') || id.includes('speech') || id.includes('whisper') || id.includes('eleven') || id.includes('bark') || id.includes('audio')) return 'audio';
  if (id.includes('3d') || id.includes('mesh') || id.includes('gaussian') || id.includes('nerf')) return '3d';
  if (id.includes('embed') || id.includes('rerank')) return 'others';

  return 'text'; // Default
}

// Parse pricing from model data
function parsePricing(model) {
  const pricing = model.pricing || {};
  return {
    prompt: pricing.prompt || pricing.input || '0',
    completion: pricing.completion || pricing.output || '0',
    request: pricing.request || '0',
    image: pricing.image || '0',
    video: pricing.video || '0',
    audio: pricing.audio || '0'
  };
}

// === Health ===
app.get('/api/health', (req, res) => res.json({ ok: true }));

// === Settings ===
app.get('/api/settings', (req, res) => res.json(toClientSettings(getSettings())));
app.patch('/api/settings', (req, res) => {
  const updated = updateSettings(req.body);
  if (req.body.apiKey) {
    const envPath = path.join(workspaceRoot, '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
      content = content.split('\n').filter(l => !l.trim().startsWith('OPENROUTER_API_KEY=')).join('\n');
    }
    content = content.trimEnd() + '\nOPENROUTER_API_KEY=' + req.body.apiKey + '\n';
    fs.writeFileSync(envPath, content);
    process.env.OPENROUTER_API_KEY = req.body.apiKey;
  }
  res.json(toClientSettings(updated));
});
app.post('/api/settings/test', async (req, res, next) => {
  try {
    const apiKey = req.body.apiKey || process.env.OPENROUTER_API_KEY || getSettings().apiKey;
    if (!apiKey) return res.status(400).json({ error: 'Enter an OpenRouter API key first.' });
    const result = await openrouter.fetchAllModels(apiKey);
    const count = result.data ? result.data.length : 0;
    res.json({ ok: true, count });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

// === Models ===
app.get('/api/models', (req, res) => res.json({ data: listModels('all') }));
app.get('/api/models/:modality', (req, res) => res.json({ data: listModels(req.params.modality) }));

app.post('/api/models/sync', async (req, res, next) => {
  try {
    const apiKey = requireApiKey();
    let saved = 0;

    // Use the correct OpenRouter API endpoints with ?output_modalities= query parameter
    const endpoints = [
      { cat: 'text',   mod: 'text' },
      { cat: 'image',  mod: 'image' },
      { cat: 'audio',  mod: 'audio' },
      { cat: 'audio',  mod: 'speech' },  // Merge speech into audio
    ];
    for (const ep of endpoints) {
      try {
        const result = await openrouter.fetchModelsByModality(apiKey, ep.mod);
        const models = result.data || result || [];
        console.log('Synced ' + models.length + ' ' + ep.cat + ' models from output_modalities=' + ep.mod);
        for (const model of models) {
          const arch = model.architecture || {};
          const inMods = arch.input_modalities || [];
          const outMods = arch.output_modalities || [];
          // Categorize: if input has image AND output has text, it's an image model
          let category = ep.cat;
          if (category === 'text' && inMods.includes('image') && outMods.includes('text')) {
            category = 'image';
          }
          saveModels([{
            ...model,
            modality: category,
            context_length: model.context_length,
            input_modalities: inMods,
            output_modalities: outMods,
            pricing: parsePricing(model)
          }], category);
          saved++;
        }
      } catch (e) {
        console.error('Error syncing ' + ep.cat + ':', e && e.message ? e.message : String(e));
      }
    }

    // Video models from dedicated endpoint
    try {
      const videoResult = await openrouter.fetchModelsByModality(apiKey, 'video');
      const videoModels = videoResult.data || videoResult || [];
      console.log('Synced ' + videoModels.length + ' video models');
      for (const model of videoModels) {
        const arch = model.architecture || {};
        saveModels([{
          ...model, modality: 'video', context_length: model.context_length,
          input_modalities: arch.input_modalities || [], output_modalities: arch.output_modalities || [],
          pricing: parsePricing(model)
        }], 'video');
        saved++;
      }
    } catch (e) { console.error('Error syncing video:', e && e.message ? e.message : String(e)); }

    // Others: embeddings, rerank
    for (const mod of ['embeddings', 'rerank']) {
      try {
        const result = await openrouter.fetchModelsByModality(apiKey, mod);
        const models = result.data || result || [];
        if (models.length) {
          console.log('Synced ' + models.length + ' ' + mod + ' models (others)');
          for (const model of models) {
            const arch = model.architecture || {};
            saveModels([{
              ...model, modality: 'others', context_length: model.context_length,
              input_modalities: arch.input_modalities || [], output_modalities: arch.output_modalities || [],
              pricing: parsePricing(model)
            }], 'others');
            saved++;
          }
        }
      } catch (e) { /* Some modalities may not exist */ }
    }

    console.log('Total models synced: ' + saved);
    res.json({ data: listModels('all') });
  } catch (error) { console.error('Sync error:', error); next(error); }
});

// === Sessions ===
app.get('/api/sessions', (req, res) => {
  const modality = req.query.modality || 'all';
  res.json({ data: listSessions(modality) });
});
app.post('/api/sessions', (req, res) => {
  const { modality, model, title } = req.body;
  const session = createSession({ modality: modality || 'text', model: model || 'openrouter/auto', title });
  res.status(201).json(session);
});
app.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).end();
  res.json(session);
});
app.delete('/api/sessions/:id', (req, res) => {
  deleteSession(req.params.id);
  res.status(204).end();
});

// === Artifacts ===
app.get('/api/artifacts', (req, res) => {
  const sessionId = req.query.session_id;
  res.json({ data: listArtifacts(sessionId) });
});
app.get('/api/artifacts/:id', (req, res) => {
  const art = getArtifact(req.params.id);
  if (!art) return res.status(404).end();
  res.json(art);
});
app.get('/api/artifacts/:id/content', (req, res) => {
  const art = getArtifact(req.params.id);
  if (!art || !art.local_path) return res.status(404).end();
  res.type(art.content_type || 'application/octet-stream').sendFile(art.local_path, { dotfiles: 'allow' });
});
app.delete('/api/artifacts/:id', (req, res) => { deleteArtifact(req.params.id); res.status(204).end(); });

// === Jobs ===
app.get('/api/jobs', (req, res) => {
  const modality = req.query.modality || 'all';
  const sessionId = req.query.session_id;
  res.json({ data: listJobs(modality, sessionId).map(toClientJob) });
});
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.json(toClientJob(job));
});
app.delete('/api/jobs/:id', (req, res) => { deleteJob(req.params.id); res.status(204).end(); });

// === Generate ===
app.post('/api/generate/:modality', async (req, res, next) => {
  try {
    const modality = req.params.modality;
    const body = req.body;
    if (!body.prompt) return res.status(400).json({ error: 'prompt is required.' });
    if (!body.model) return res.status(400).json({ error: 'model is required.' });

    const sessionId = body.session_id || null;
    const provider = body.provider || 'openrouter';
    const settings = getSettings();

    // Create or use existing session
    let session = sessionId ? getSession(sessionId) : null;
    if (!session) {
      session = createSession({ modality, model: body.model, title: body.prompt.slice(0, 50) });
    }
    const sid = session.id;

    // Append user message
    const userContent = [];
    if (body.images && body.images.length > 0) {
      userContent.push({ type: 'text', text: body.prompt });
      for (const img of body.images) {
        let imgUrl = img;
        if (typeof img === 'object' && img.dataUrl) imgUrl = img.dataUrl;
        else if (typeof img === 'string' && !img.startsWith('http') && !img.startsWith('data:')) {
          const asset = getAsset(img);
          if (asset) imgUrl = 'data:' + asset.mime_type + ';base64,' + (asset.data_url || '').split(',')[1];
        }
        userContent.push({ type: 'image_url', image_url: { url: imgUrl } });
      }
    } else {
      userContent.push(body.prompt);
    }
    appendMessage(sid, { role: 'user', content: userContent });

    const localJob = createJob({
      status: 'submitting', modality, mode: body.mode || 'text',
      model: body.model, provider, prompt: body.prompt,
      payload: body, sessionId: sid
    });

    try {
      let response, result, contentType;

      if (modality === 'text') {
        const messages = session.messages.map(m => {
          if (typeof m.content === 'string') return { role: m.role, content: m.content };
          return m;
        });
        response = await openrouter.createChatCompletion(requireApiKey(), { model: body.model, messages, max_tokens: body.max_tokens || 4096, temperature: body.temperature || 0.7 });
        result = response;
        contentType = 'text/markdown';
        const assistantMsg = response.choices?.[0]?.message?.content || response.choices?.[0]?.text || '';
        appendMessage(sid, { role: 'assistant', content: assistantMsg });
      } else if (modality === 'image') {
        const payload = { model: body.model, prompt: body.prompt, n: body.n || 1, size: body.size || '1024x1024', response_format: body.response_format || 'url' };
        if (body.quality) payload.quality = body.quality;
        if (body.style) payload.style = body.style;
        if (body.images && body.images.length > 0) payload.images = body.images;
        response = await openrouter.createImageJob(requireApiKey(), payload);
        result = response;
        contentType = 'image/png';
        // Save image artifact
        if (response.data?.[0]) {
          const imgInfo = response.data[0];
          let localPath = null;
          if (imgInfo.b64_json) {
            const buf = Buffer.from(imgInfo.b64_json, 'base64');
            localPath = path.join(settings.outputDir, localJob.id + '.png');
            fs.writeFileSync(localPath, buf);
          }
          createArtifact({ sessionId: sid, jobId: localJob.id, type: 'image', name: 'Generated Image', localPath, contentType: 'image/png', data: { url: imgInfo.url, b64: imgInfo.b64_json } });
          appendMessage(sid, { role: 'assistant', content: 'Generated image.', attachments: [{ type: 'image', url: imgInfo.url || '/api/artifacts/' + localJob.id + '/content' }] });
        }
      } else if (modality === 'video') {
        const payload = buildPayload(body);
        response = await openrouter.createVideoJob(requireApiKey(), payload);
        result = response;
        contentType = 'video/mp4';
        appendMessage(sid, { role: 'assistant', content: 'Video generation started. Job: ' + response.id });
      } else if (modality === 'audio') {
        const payload = { model: body.model, input: body.prompt, voice: body.voice || 'alloy', response_format: body.response_format || 'mp3' };
        response = await openrouter.createTTSJob(requireApiKey(), payload);
        result = response;
        contentType = 'audio/mpeg';
        appendMessage(sid, { role: 'assistant', content: 'Audio generated.' });
      } else {
        return res.status(400).json({ error: 'Unknown modality: ' + modality });
      }

      const updated = updateJob(localJob.id, { status: 'completed', response, result, content_type: contentType, completed_at: nowIso() });
      updateSessionTitle(sid, body.prompt.slice(0, 50));
      res.status(201).json(toClientJob(updated));
    } catch (error) {
      updateJob(localJob.id, { status: 'failed', error: error.message, response: error.body || null });
      appendMessage(sid, { role: 'assistant', content: 'Error: ' + error.message });
      res.status(201).json(toClientJob(getJob(localJob.id)));
    }
  } catch (error) { next(error); }
});

// === Assets ===
app.post('/api/assets/upload', (req, res) => {
  const { kind = 'input', name, mimeType, dataUrl } = req.body;
  if (!name || !mimeType || !dataUrl) return res.status(400).json({ error: 'name, mimeType, and dataUrl required.' });
  res.status(201).json(saveAsset({ kind, name, mimeType, dataUrl }));
});
app.get('/api/assets/:id/content', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset || !asset.local_path) return res.status(404).end();
  res.type(asset.mime_type).sendFile(asset.local_path, { dotfiles: 'allow' });
});

// === Download ===
app.post('/api/jobs/:id/download', async (req, res, next) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).end();
    if (job.status !== 'completed') return res.status(400).json({ error: 'Only completed jobs can be downloaded.' });
    if (job.local_path) {
      const a = document.createElement('a'); // This won't work server-side, just return the path
      return res.json(toClientJob(job));
    }
    if (job.contentUrl) return res.json(toClientJob(job));
    res.json(toClientJob(job));
  } catch (error) { next(error); }
});

app.get('/api/jobs/:id/content', async (req, res, next) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).end();
    if (job.local_path && fs.existsSync(job.local_path)) {
      return res.type(job.content_type || 'application/octet-stream').sendFile(job.local_path, { dotfiles: 'allow' });
    }
    if (job.modality === 'text' && job.result) {
      const choices = job.result.choices;
      if (choices?.[0]) {
        const content = choices[0].message?.content || choices[0].text || '';
        return res.type('text/plain').send(content);
      }
    }
    // For image jobs, redirect to artifact
    if (job.modality === 'image' && job.result?.data?.[0]) {
      const imgInfo = job.result.data[0];
      if (imgInfo.url) return res.redirect(imgInfo.url);
    }
    res.status(404).json({ error: 'No content available.' });
  } catch (error) { next(error); }
});

// === Static ===
const distPath = path.join(workspaceRoot, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({ error: error.message || 'Unexpected error', details: error.body || undefined });
});

app.listen(port, '127.0.0.1', () => {
  console.log('Mandarin AI Studio API listening on http://127.0.0.1:' + port);
});
