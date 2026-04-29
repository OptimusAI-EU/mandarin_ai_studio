const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const workspaceRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(workspaceRoot, '.ovstudio');
const assetsRoot = path.join(dataRoot, 'assets');
const outputsRoot = path.join(dataRoot, 'outputs');

fs.mkdirSync(assetsRoot, { recursive: true });
fs.mkdirSync(outputsRoot, { recursive: true });

const db = new DatabaseSync(path.join(dataRoot, 'studio.sqlite'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models_cache (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    batch_index INTEGER,
    openrouter_job_id TEXT,
    generation_id TEXT,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    response_json TEXT,
    result_json TEXT,
    error TEXT,
    local_video_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    status TEXT NOT NULL,
    estimated_cost REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    local_path TEXT,
    data_url TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
  );
`);

ensureColumn('jobs', 'batch_id', 'TEXT');
ensureColumn('jobs', 'batch_index', 'INTEGER');

function ensureColumn(table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), nowIso());
}

function getSettings() {
  return {
    apiKey: getSetting('apiKey', ''),
    outputDir: getSetting('outputDir', outputsRoot),
    pollIntervalSeconds: getSetting('pollIntervalSeconds', 15),
    timeoutMinutes: getSetting('timeoutMinutes', 30),
    requireExpensiveConfirmation: getSetting('requireExpensiveConfirmation', true)
  };
}

function updateSettings(partial) {
  const allowed = [
    'apiKey',
    'outputDir',
    'pollIntervalSeconds',
    'timeoutMinutes',
    'requireExpensiveConfirmation'
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      setSetting(key, partial[key]);
    }
  }

  const settings = getSettings();
  fs.mkdirSync(settings.outputDir, { recursive: true });
  return settings;
}

function saveModels(models) {
  const syncedAt = nowIso();
  const insert = db.prepare(`
    INSERT INTO models_cache (id, data, synced_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at
  `);

  db.exec('BEGIN');
  try {
    for (const model of models) {
      insert.run(model.id, JSON.stringify(model), syncedAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function listModels() {
  return db.prepare('SELECT data, synced_at FROM models_cache ORDER BY id').all().map((row) => ({
    ...JSON.parse(row.data),
    synced_at: row.synced_at
  }));
}

function getAsset(id) {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
  return row || null;
}

function saveAsset({ kind, name, mimeType, dataUrl }) {
  const id = makeId('asset');
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'asset';
  const extension = path.extname(safeName) || mimeToExtension(mimeType);
  const localPath = path.join(assetsRoot, `${id}${extension}`);
  const commaIndex = dataUrl.indexOf(',');
  const encoded = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;

  fs.writeFileSync(localPath, Buffer.from(encoded, 'base64'));
  db.prepare(`
    INSERT INTO assets (id, kind, name, mime_type, local_path, data_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, kind, name, mimeType, localPath, dataUrl, nowIso());

  return getAsset(id);
}

function mimeToExtension(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'video/webm') return '.webm';
  return '.bin';
}

function rowToJob(row) {
  return {
    ...row,
    payload: JSON.parse(row.payload_json),
    response: row.response_json ? JSON.parse(row.response_json) : null,
    result: row.result_json ? JSON.parse(row.result_json) : null
  };
}

function createBatch({ prompt, settings, estimatedCost = null }) {
  const id = makeId('batch');
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO batches (id, prompt, settings_json, status, estimated_cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, prompt, JSON.stringify(settings), 'submitting', estimatedCost, createdAt, createdAt);
  return getBatch(id);
}

function updateBatch(id, patch) {
  const current = getBatch(id);
  if (!current) return null;
  db.prepare(`
    UPDATE batches SET status = ?, estimated_cost = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? current.status,
    patch.estimated_cost ?? current.estimated_cost,
    nowIso(),
    id
  );
  return getBatch(id);
}

function getBatch(id) {
  const row = db.prepare('SELECT * FROM batches WHERE id = ?').get(id);
  return row
    ? {
        ...row,
        settings: JSON.parse(row.settings_json)
      }
    : null;
}

function createJob({ id = makeId('job'), batchId = null, batchIndex = null, status, mode, model, prompt, payload, response = null }) {
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO jobs (
      id, batch_id, batch_index, openrouter_job_id, generation_id, status, mode, model, prompt,
      payload_json, response_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    batchId,
    batchIndex,
    response?.id || null,
    response?.generation_id || null,
    status,
    mode,
    model,
    prompt,
    JSON.stringify(payload),
    response ? JSON.stringify(response) : null,
    createdAt,
    createdAt
  );
  return getJob(id);
}

function updateJob(id, patch) {
  const current = getJob(id);
  if (!current) return null;

  const next = {
    openrouter_job_id: patch.openrouter_job_id ?? current.openrouter_job_id,
    generation_id: patch.generation_id ?? current.generation_id,
    status: patch.status ?? current.status,
    response_json: patch.response ? JSON.stringify(patch.response) : current.response_json,
    result_json: patch.result ? JSON.stringify(patch.result) : current.result_json,
    error: patch.error ?? current.error,
    local_video_path: patch.local_video_path ?? current.local_video_path,
    completed_at: patch.completed_at ?? current.completed_at,
    updated_at: nowIso()
  };

  db.prepare(`
    UPDATE jobs SET
      openrouter_job_id = ?,
      generation_id = ?,
      status = ?,
      response_json = ?,
      result_json = ?,
      error = ?,
      local_video_path = ?,
      completed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    next.openrouter_job_id,
    next.generation_id,
    next.status,
    next.response_json,
    next.result_json,
    next.error,
    next.local_video_path,
    next.completed_at,
    next.updated_at,
    id
  );

  return getJob(id);
}

function getJob(id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? rowToJob(row) : null;
}

function listJobs() {
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all().map(rowToJob);
}

function deleteJob(id) {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

module.exports = {
  db,
  dataRoot,
  outputsRoot,
  nowIso,
  makeId,
  getSettings,
  updateSettings,
  saveModels,
  listModels,
  saveAsset,
  getAsset,
  createBatch,
  updateBatch,
  getBatch,
  createJob,
  updateJob,
  getJob,
  listJobs,
  deleteJob
};
