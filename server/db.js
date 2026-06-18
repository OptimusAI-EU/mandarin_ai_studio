const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const workspaceRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(workspaceRoot, '.ovstudio');
const assetsRoot = path.join(dataRoot, 'assets');
const outputsRoot = path.join(dataRoot, 'outputs');
const artifactsRoot = path.join(dataRoot, 'artifacts');

fs.mkdirSync(assetsRoot, { recursive: true });
fs.mkdirSync(outputsRoot, { recursive: true });
fs.mkdirSync(artifactsRoot, { recursive: true });

const db = new DatabaseSync(path.join(dataRoot, 'studio.sqlite'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models_cache (
    id TEXT NOT NULL, modality TEXT NOT NULL DEFAULT 'video',
    data TEXT NOT NULL, synced_at TEXT NOT NULL,
    PRIMARY KEY (id, modality)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    modality TEXT NOT NULL DEFAULT 'text',
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    batch_id TEXT,
    batch_index INTEGER,
    openrouter_job_id TEXT,
    generation_id TEXT,
    status TEXT NOT NULL,
    modality TEXT NOT NULL DEFAULT 'text',
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    prompt TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    response_json TEXT,
    result_json TEXT,
    error TEXT,
    local_path TEXT,
    content_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    job_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    local_path TEXT,
    content_type TEXT,
    data_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY, prompt TEXT NOT NULL, settings_json TEXT NOT NULL,
    status TEXT NOT NULL, estimated_cost REAL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, job_id TEXT, kind TEXT NOT NULL,
    name TEXT NOT NULL, mime_type TEXT NOT NULL,
    local_path TEXT, data_url TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
  );
`);

// Migrate old schema
ensureColumn('jobs', 'batch_id', 'TEXT');
ensureColumn('jobs', 'batch_index', 'INTEGER');
ensureColumn('jobs', 'modality', 'TEXT');
ensureColumn('jobs', 'provider', 'TEXT');
ensureColumn('jobs', 'local_path', 'TEXT');
ensureColumn('jobs', 'content_type', 'TEXT');
ensureColumn('jobs', 'session_id', 'TEXT');
ensureColumn('models_cache', 'modality', 'TEXT');

function ensureColumn(table, column, type) {
  const columns = db.prepare('PRAGMA table_info(' + table + ')').all();
  if (!columns.some((row) => row.name === column)) {
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type + ';');
  }
}

function nowIso() { return new Date().toISOString(); }
function makeId(prefix) { return prefix + '_' + crypto.randomBytes(9).toString('hex'); }

function getSetting(key, fallback) {
  if (fallback === undefined) fallback = null;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(value), nowIso());
}

function getSettings() {
  return {
    apiKey: getSetting('apiKey', ''),
    outputDir: getSetting('outputDir', outputsRoot),
    pollIntervalSeconds: getSetting('pollIntervalSeconds', 15),
    timeoutMinutes: getSetting('timeoutMinutes', 30),
    requireExpensiveConfirmation: getSetting('requireExpensiveConfirmation', true),
    ollamaBaseUrl: getSetting('ollamaBaseUrl', 'http://localhost:11434')
  };
}

function updateSettings(partial) {
  const allowed = ['apiKey', 'outputDir', 'pollIntervalSeconds', 'timeoutMinutes', 'requireExpensiveConfirmation', 'ollamaBaseUrl'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) setSetting(key, partial[key]);
  }
  const settings = getSettings();
  fs.mkdirSync(settings.outputDir, { recursive: true });
  return settings;
}

function saveModels(models, modality) {
  const syncedAt = nowIso();
  const insert = db.prepare('INSERT INTO models_cache (id, modality, data, synced_at) VALUES (?, ?, ?, ?) ON CONFLICT(id, modality) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at');
  db.exec('BEGIN');
  try {
    for (const model of models) insert.run(model.id, modality, JSON.stringify(model), syncedAt);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function listModels(modality) {
  let rows;
  if (modality && modality !== 'all') {
    rows = db.prepare('SELECT data, synced_at FROM models_cache WHERE modality = ? ORDER BY id').all(modality);
  } else {
    rows = db.prepare('SELECT data, synced_at FROM models_cache ORDER BY id').all();
  }
  return rows.map((row) => ({ ...JSON.parse(row.data), synced_at: row.synced_at }));
}

// === Sessions ===

function createSession({ modality, model, title }) {
  const id = makeId('sess');
  const createdAt = nowIso();
  const messages = JSON.stringify([{ role: 'system', content: 'You are a helpful assistant.' }]);
  db.prepare('INSERT INTO sessions (id, modality, title, model, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, modality, title || 'New Chat', model, messages, createdAt, createdAt);
  return getSession(id);
}

function getSession(id) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, messages: JSON.parse(row.messages_json) };
}

function listSessions(modality) {
  let rows;
  if (modality && modality !== 'all') {
    rows = db.prepare('SELECT * FROM sessions WHERE modality = ? ORDER BY updated_at DESC').all(modality);
  } else {
    rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all();
  }
  return rows.map(r => ({ ...r, messages: JSON.parse(r.messages_json) }));
}

function appendMessage(sessionId, message) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.messages.push(message);
  db.prepare('UPDATE sessions SET messages_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(session.messages), nowIso(), sessionId);
  return getSession(sessionId);
}

function updateSessionTitle(sessionId, title) {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), sessionId);
}

function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// === Jobs ===

function rowToJob(row) {
  return {
    ...row,
    payload: JSON.parse(row.payload_json),
    response: row.response_json ? JSON.parse(row.response_json) : null,
    result: row.result_json ? JSON.parse(row.result_json) : null
  };
}

function createJob({ id, sessionId, batchId, batchIndex, status, modality, mode, model, provider, prompt, payload, response }) {
  if (!id) id = makeId('job');
  if (batchId === undefined) batchId = null;
  if (batchIndex === undefined) batchIndex = null;
  if (!modality) modality = 'text';
  if (!provider) provider = 'openrouter';
  if (!response) response = null;
  const createdAt = nowIso();
  db.prepare('INSERT INTO jobs (id, session_id, batch_id, batch_index, openrouter_job_id, generation_id, status, modality, mode, model, provider, prompt, payload_json, response_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, sessionId || null, batchId, batchIndex, response ? response.id : null, response ? (response.generation_id || null) : null, status, modality, mode, model, provider, prompt, JSON.stringify(payload), response ? JSON.stringify(response) : null, createdAt, createdAt);
  return getJob(id);
}

function updateJob(id, patch) {
  const current = getJob(id);
  if (!current) return null;
  const next = {
    openrouter_job_id: patch.openrouter_job_id !== undefined ? patch.openrouter_job_id : current.openrouter_job_id,
    generation_id: patch.generation_id !== undefined ? patch.generation_id : current.generation_id,
    status: patch.status !== undefined ? patch.status : current.status,
    response_json: patch.response ? JSON.stringify(patch.response) : current.response_json,
    result_json: patch.result ? JSON.stringify(patch.result) : current.result_json,
    error: patch.error !== undefined ? patch.error : current.error,
    local_path: patch.local_path !== undefined ? patch.local_path : current.local_path,
    content_type: patch.content_type !== undefined ? patch.content_type : current.content_type,
    completed_at: patch.completed_at !== undefined ? patch.completed_at : current.completed_at,
    updated_at: nowIso()
  };
  db.prepare('UPDATE jobs SET openrouter_job_id = ?, generation_id = ?, status = ?, response_json = ?, result_json = ?, error = ?, local_path = ?, content_type = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(next.openrouter_job_id, next.generation_id, next.status, next.response_json, next.result_json, next.error, next.local_path, next.content_type, next.completed_at, next.updated_at, id);
  return getJob(id);
}

function getJob(id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? rowToJob(row) : null;
}

function listJobs(modality, sessionId) {
  let rows;
  if (sessionId) {
    rows = db.prepare('SELECT * FROM jobs WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
  } else if (modality && modality !== 'all') {
    rows = db.prepare('SELECT * FROM jobs WHERE modality = ? ORDER BY created_at DESC').all(modality);
  } else {
    rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
  }
  return rows.map(rowToJob);
}

function deleteJob(id) { db.prepare('DELETE FROM jobs WHERE id = ?').run(id); }

// === Artifacts ===

function createArtifact({ sessionId, jobId, type, name, description, localPath, contentType, data }) {
  const id = makeId('art');
  const createdAt = nowIso();
  db.prepare('INSERT INTO artifacts (id, session_id, job_id, type, name, description, local_path, content_type, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, sessionId || null, jobId || null, type, name, description || null, localPath || null, contentType || null, data ? JSON.stringify(data) : null, createdAt);
  return getArtifact(id);
}

function getArtifact(id) {
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, data: row.data_json ? JSON.parse(row.data_json) : null };
}

function listArtifacts(sessionId) {
  let rows;
  if (sessionId) {
    rows = db.prepare('SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at DESC').all(sessionId);
  } else {
    rows = db.prepare('SELECT * FROM artifacts ORDER BY created_at DESC').all();
  }
  return rows.map(r => ({ ...r, data: r.data_json ? JSON.parse(r.data_json) : null }));
}

function deleteArtifact(id) { db.prepare('DELETE FROM artifacts WHERE id = ?').run(id); }

// === Assets ===

function getAsset(id) { const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id); return row || null; }

function saveAsset({ kind, name, mimeType, dataUrl }) {
  const id = makeId('asset');
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'asset';
  const extension = path.extname(safeName) || mimeToExtension(mimeType);
  const localPath = path.join(assetsRoot, id + extension);
  const commaIndex = dataUrl.indexOf(',');
  const encoded = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  fs.writeFileSync(localPath, Buffer.from(encoded, 'base64'));
  db.prepare('INSERT INTO assets (id, kind, name, mime_type, local_path, data_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, kind, name, mimeType, localPath, dataUrl, nowIso());
  return getAsset(id);
}

function mimeToExtension(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'audio/wav') return '.wav';
  return '.bin';
}

module.exports = {
  db, dataRoot, outputsRoot, artifactsRoot, nowIso, makeId,
  getSettings, updateSettings,
  saveModels, listModels,
  saveAsset, getAsset,
  createSession, getSession, listSessions, appendMessage, updateSessionTitle, deleteSession,
  createJob, updateJob, getJob, listJobs, deleteJob,
  createArtifact, getArtifact, listArtifacts, deleteArtifact
};
