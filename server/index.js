const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  getSettings,
  updateSettings,
  saveModels,
  listModels,
  saveAsset,
  getAsset,
  createBatch,
  updateBatch,
  createJob,
  updateJob,
  getJob,
  listJobs,
  deleteJob,
  makeId,
  nowIso
} = require('./db');
const openrouter = require('./openrouterClient');

const app = express();
const port = Number(process.env.PORT || 4317);
const workspaceRoot = path.resolve(__dirname, '..');

app.use(express.json({ limit: '25mb' }));

function requireApiKey() {
  const apiKey = getSettings().apiKey;
  if (!apiKey) {
    const error = new Error('OpenRouter API key is not configured.');
    error.status = 400;
    throw error;
  }
  return apiKey;
}

function normalizeRemoteStatus(status) {
  if (status === 'pending') return 'queued';
  if (status === 'in_progress') return 'processing';
  return status || 'unknown';
}

function terminalStatus(status) {
  return ['completed', 'failed', 'cancelled', 'expired', 'timeout'].includes(status);
}

function activeStatus(status) {
  return ['submitting', 'queued', 'processing', 'pending', 'in_progress'].includes(status);
}

function toClientJob(job) {
  return {
    id: job.id,
    batchId: job.batch_id,
    batchIndex: job.batch_index,
    openrouterJobId: job.openrouter_job_id,
    generationId: job.generation_id,
    status: job.status,
    mode: job.mode,
    model: job.model,
    prompt: job.prompt,
    payload: job.payload,
    response: job.response,
    result: job.result,
    error: job.error,
    localVideoPath: job.local_video_path,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
    contentUrl: job.status === 'completed' ? `/api/jobs/${job.id}/preview` : null
  };
}

function toClientSettings(settings) {
  return {
    ...settings,
    apiKey: settings.apiKey,
    hasApiKey: Boolean(settings.apiKey)
  };
}

function buildPayload(body) {
  const seed = body.seed === '' || body.seed == null ? undefined : Number(body.seed);
  const payload = {
    model: body.model,
    prompt: body.prompt,
    duration: body.duration ? Number(body.duration) : undefined,
    resolution: body.resolution || undefined,
    aspect_ratio: body.aspectRatio || body.aspect_ratio || undefined,
    size: body.size || undefined,
    generate_audio: typeof body.generateAudio === 'boolean'
      ? body.generateAudio
      : typeof body.generate_audio === 'boolean'
        ? body.generate_audio
        : undefined,
    seed: Number.isFinite(seed) ? seed : undefined,
    provider: body.provider || undefined
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || payload[key] === '') delete payload[key];
  });

  if (Array.isArray(body.frame_images) && body.frame_images.length > 0) {
    payload.frame_images = body.frame_images;
  } else if (Array.isArray(body.frameImages) && body.frameImages.length > 0) {
    payload.frame_images = body.frameImages.map((frame) => {
      const asset = getAsset(frame.assetId);
      if (!asset) throw Object.assign(new Error(`Missing asset ${frame.assetId}`), { status: 400 });
      return {
        type: 'image_url',
        frame_type: frame.frameType,
        image_url: { url: asset.data_url }
      };
    });
  }

  return payload;
}

function sanitizeBodyForModel(body) {
  const model = listModels().find((item) => item.id === body.model);
  if (!model) return body;

  const mode = body.mode;
  const frames = model.supported_frame_images || [];
  if ((mode === 'image' || mode === 'start_end') && !frames.includes('first_frame')) {
    throw Object.assign(new Error(`${model.id} does not support first-frame image generation.`), { status: 400 });
  }
  if (mode === 'start_end' && !frames.includes('last_frame')) {
    throw Object.assign(new Error(`${model.id} does not support last-frame image generation.`), { status: 400 });
  }

  const next = { ...body };
  next.duration = getEffectiveModelValue(model.supported_durations, next.duration);
  next.resolution = getEffectiveModelValue(model.supported_resolutions, next.resolution);
  next.aspectRatio = getEffectiveModelValue(model.supported_aspect_ratios, next.aspectRatio || next.aspect_ratio);
  next.size = getEffectiveSize(model.supported_sizes, next.size, next.aspectRatio, next.resolution);

  if (!model.generate_audio) {
    next.generateAudio = false;
    next.generate_audio = false;
  }

  if (!model.seed) {
    delete next.seed;
  }

  return next;
}

function getEffectiveModelValue(supportedValues = [], requestedValue) {
  const supported = supportedValues.map(String);
  if (supported.length === 0) return requestedValue || undefined;
  if (!requestedValue) return supported[0];
  const requested = String(requestedValue);
  const exact = supported.find((value) => value.toLowerCase() === requested.toLowerCase());
  if (exact) return exact;

  const requestedNumber = Number.parseFloat(requested);
  if (Number.isFinite(requestedNumber)) {
    return supported.reduce((best, current) => {
      return Math.abs(Number.parseFloat(current) - requestedNumber) < Math.abs(Number.parseFloat(best) - requestedNumber)
        ? current
        : best;
    }, supported[0]);
  }

  return supported[0];
}

function getEffectiveSize(supportedSizes = [], requestedSize, aspectRatio, resolution) {
  const supported = supportedSizes.map(String).filter((size) => sizeMatchesSettings(size, aspectRatio, resolution));
  if (!requestedSize) return undefined;

  const requested = String(requestedSize);
  const exact = supported.find((size) => size.toLowerCase() === requested.toLowerCase());
  if (exact) return exact;

  if (supported.length === 0) {
    return sizeMatchesSettings(requested, aspectRatio, resolution) ? requested : undefined;
  }

  const requestedPixels = sizePixels(requested);
  return supported.reduce((best, current) => {
    return Math.abs(sizePixels(current) - requestedPixels) < Math.abs(sizePixels(best) - requestedPixels) ? current : best;
  }, supported[0]);
}

function sizeMatchesSettings(size, aspectRatio, resolution) {
  return sizeMatchesAspect(size, aspectRatio) && sizeMatchesResolution(size, resolution);
}

function sizeMatchesAspect(size, aspectRatio) {
  if (!size || !aspectRatio) return true;
  const parsedSize = parseSize(size);
  const parsedAspect = parseAspectRatio(aspectRatio);
  if (!parsedSize || !parsedAspect) return true;
  return parsedSize.width * parsedAspect.height === parsedSize.height * parsedAspect.width;
}

function sizeMatchesResolution(size, resolution) {
  if (!size || !resolution) return true;
  const parsedSize = parseSize(size);
  const pixels = parseResolutionPixels(resolution);
  if (!parsedSize || !pixels) return true;
  return Math.min(parsedSize.width, parsedSize.height) === pixels;
}

function parseSize(size) {
  const match = String(size).toLowerCase().match(/^(\d+)x(\d+)$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function parseAspectRatio(aspectRatio) {
  const match = String(aspectRatio).match(/^(\d+):(\d+)$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function parseResolutionPixels(resolution) {
  const normalized = String(resolution).toLowerCase();
  if (normalized === '4k') return 2160;
  const match = normalized.match(/^(\d+)p$/);
  return match ? Number(match[1]) : null;
}

function sizePixels(size) {
  const parsed = parseSize(size);
  return parsed ? parsed.width * parsed.height : 0;
}

async function submitJob(body, metadata = {}) {
  const apiKey = requireApiKey();
  const sanitizedBody = sanitizeBodyForModel(body);
  const payload = buildPayload(sanitizedBody);
  const localJob = createJob({
    batchId: metadata.batchId || null,
    batchIndex: metadata.batchIndex ?? null,
    status: 'submitting',
    mode: sanitizedBody.mode,
    model: sanitizedBody.model,
    prompt: sanitizedBody.prompt,
    payload
  });

  try {
    const response = await openrouter.createVideoJob(apiKey, payload);
    return updateJob(localJob.id, {
      openrouter_job_id: response.id,
      generation_id: response.generation_id || null,
      status: normalizeRemoteStatus(response.status),
      response
    });
  } catch (error) {
    return updateJob(localJob.id, {
      status: 'failed',
      error: error.message,
      response: error.body || null
    });
  }
}

async function pollAndUpdateJob(job, apiKey) {
  if (!job || !job.openrouter_job_id || terminalStatus(job.status)) return job;

  const result = await openrouter.pollVideoJob(apiKey, job.openrouter_job_id);
  const status = normalizeRemoteStatus(result.status);
  return updateJob(job.id, {
    status,
    generation_id: result.generation_id || job.generation_id,
    result,
    error: result.error || null,
    completed_at: status === 'completed' ? nowIso() : null
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/settings', (req, res) => {
  res.json(toClientSettings(getSettings()));
});

app.patch('/api/settings', (req, res) => {
  res.json(toClientSettings(updateSettings(req.body)));
});

app.post('/api/settings/test', async (req, res, next) => {
  try {
    const apiKey = req.body.apiKey || getSettings().apiKey;
    if (!apiKey) return res.status(400).json({ error: 'Enter an OpenRouter API key first.' });
    const result = await openrouter.listVideoModels(apiKey);
    res.json({ ok: true, count: result.data?.length || 0 });
  } catch (error) {
    next(error);
  }
});

app.get('/api/models/video', (req, res) => {
  res.json({ data: listModels() });
});

app.post('/api/models/sync', async (req, res, next) => {
  try {
    const apiKey = requireApiKey();
    const result = await openrouter.listVideoModels(apiKey);
    saveModels(result.data || []);
    res.json({ data: listModels() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/upload', (req, res) => {
  const { kind = 'frame', name, mimeType, dataUrl } = req.body;
  if (!name || !mimeType || !dataUrl) {
    return res.status(400).json({ error: 'name, mimeType, and dataUrl are required.' });
  }
  res.status(201).json(saveAsset({ kind, name, mimeType, dataUrl }));
});

app.get('/api/assets/:id/content', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset || !asset.local_path) return res.status(404).end();
  res.type(asset.mime_type).sendFile(asset.local_path, { dotfiles: 'allow' });
});

app.post('/api/jobs', async (req, res, next) => {
  try {
    const required = ['mode', 'model', 'prompt'];
    for (const key of required) {
      if (!req.body[key]) return res.status(400).json({ error: `${key} is required.` });
    }
    const job = await submitJob(req.body);
    res.status(201).json(toClientJob(job));
  } catch (error) {
    next(error);
  }
});

app.post('/api/batches', async (req, res, next) => {
  try {
    const models = Array.isArray(req.body.models) ? [...new Set(req.body.models.filter(Boolean))] : [];
    const videosPerModel = Number(req.body.videosPerModel || 1);

    if (!req.body.prompt) return res.status(400).json({ error: 'prompt is required.' });
    if (!req.body.mode) return res.status(400).json({ error: 'mode is required.' });
    if (models.length < 1) return res.status(400).json({ error: 'Select at least one model.' });
    if (models.length > 3) return res.status(400).json({ error: 'A batch can include at most 3 models.' });
    if (!Number.isInteger(videosPerModel) || videosPerModel < 1 || videosPerModel > 3) {
      return res.status(400).json({ error: 'videosPerModel must be 1, 2, or 3.' });
    }

    const batch = createBatch({
      prompt: req.body.prompt,
      estimatedCost: typeof req.body.estimatedCost === 'number' ? req.body.estimatedCost : null,
      settings: {
        mode: req.body.mode,
        models,
        videosPerModel,
        duration: req.body.duration,
        resolution: req.body.resolution,
        aspectRatio: req.body.aspectRatio,
        size: req.body.size,
        generateAudio: req.body.generateAudio,
        seed: req.body.seed
      }
    });

    const jobs = [];
    let batchIndex = 0;
    for (const model of models) {
      for (let copy = 0; copy < videosPerModel; copy += 1) {
        batchIndex += 1;
        const modelSettings = req.body.modelSettings?.[model] || {};
        const job = await submitJob({ ...req.body, ...modelSettings, model }, { batchId: batch.id, batchIndex });
        jobs.push(job);
      }
    }

    const failedCount = jobs.filter((job) => job.status === 'failed').length;
    const finalBatch = updateBatch(batch.id, {
      status: failedCount === jobs.length ? 'failed' : failedCount > 0 ? 'partial' : 'submitted'
    });

    res.status(201).json({
      batch: finalBatch,
      data: jobs.map(toClientJob)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs', (req, res) => {
  res.json({ data: listJobs().map(toClientJob) });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.json(toClientJob(job));
});

app.post('/api/jobs/:id/poll', async (req, res, next) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).end();
    if (!job.openrouter_job_id) return res.status(400).json({ error: 'Job has not been submitted.' });
    if (terminalStatus(job.status)) return res.json(toClientJob(job));

    const updated = await pollAndUpdateJob(job, requireApiKey());
    res.json(toClientJob(updated));
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/poll-active', async (req, res, next) => {
  try {
    const activeJobs = listJobs().filter((job) => activeStatus(job.status) && job.openrouter_job_id);
    if (activeJobs.length === 0) return res.json({ data: listJobs().map(toClientJob) });

    const apiKey = requireApiKey();
    for (const job of activeJobs) {
      await pollAndUpdateJob(job, apiKey);
    }

    res.json({ data: listJobs().map(toClientJob) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:id/download', async (req, res, next) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).end();
    if (job.status !== 'completed') return res.status(400).json({ error: 'Only completed jobs can be downloaded.' });
    if (!job.openrouter_job_id) return res.status(400).json({ error: 'Missing OpenRouter job id.' });

    const settings = getSettings();
    fs.mkdirSync(settings.outputDir, { recursive: true });
    const safeModel = job.model.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${job.created_at.slice(0, 19).replace(/[:T]/g, '-')}_${safeModel}_${job.id}.mp4`;
    const outputPath = path.join(settings.outputDir, fileName);
    const content = await openrouter.downloadVideo(requireApiKey(), job.openrouter_job_id, req.body.index || 0);
    fs.writeFileSync(outputPath, content);

    const updated = updateJob(job.id, { local_video_path: outputPath });
    res.json(toClientJob(updated));
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:id/content', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || !job.local_video_path) return res.status(404).end();
  res.type('video/mp4').sendFile(job.local_video_path, { dotfiles: 'allow' });
});

app.get('/api/jobs/:id/preview', async (req, res, next) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).end();

    if (job.local_video_path) {
      return res.type('video/mp4').sendFile(job.local_video_path, { dotfiles: 'allow' });
    }

    if (job.status !== 'completed') {
      return res.status(409).json({ error: 'Video is not completed yet.' });
    }

    const unsignedUrl = job.result?.unsigned_urls?.[0];
    if (unsignedUrl) {
      return res.redirect(unsignedUrl);
    }

    if (!job.openrouter_job_id) {
      return res.status(404).json({ error: 'No preview URL is available for this job.' });
    }

    const content = await openrouter.downloadVideo(requireApiKey(), job.openrouter_job_id, 0);
    res.type('video/mp4').send(content);
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:id/retry', async (req, res, next) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).end();
    const retry = await submitJob({
      ...job.payload,
      mode: job.mode,
      model: job.model,
      prompt: job.prompt
    });
    res.status(201).json(toClientJob(retry));
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:id/duplicate', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  const duplicate = createJob({
    id: makeId('draft'),
    status: 'draft',
    mode: job.mode,
    model: job.model,
    prompt: job.prompt,
    payload: job.payload
  });
  res.status(201).json(toClientJob(duplicate));
});

app.delete('/api/jobs/:id', (req, res) => {
  deleteJob(req.params.id);
  res.status(204).end();
});

app.get('/api/gallery', (req, res) => {
  res.json({
    data: listJobs()
      .filter((job) => job.status === 'completed')
      .map(toClientJob)
  });
});

const distPath = path.join(workspaceRoot, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || 'Unexpected error',
    details: error.body || undefined
  });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Open Video Studio API listening on http://127.0.0.1:${port}`);
});
