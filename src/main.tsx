import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Download,
  Film,
  GalleryHorizontal,
  Image,
  KeyRound,
  LayoutGrid,
  Play,
  RefreshCcw,
  Search,
  Settings,
  SplitSquareHorizontal,
  Upload,
  Wand2
} from 'lucide-react';
import './styles.css';

type Tab = 'generate' | 'jobs' | 'gallery' | 'models' | 'settings';

type VideoModel = {
  id: string;
  name?: string;
  description?: string;
  supported_sizes?: string[];
  supported_resolutions?: string[];
  supported_aspect_ratios?: string[];
  supported_durations?: number[];
  supported_frame_images?: string[];
  generate_audio?: boolean;
  seed?: boolean;
  pricing?: Record<string, unknown>;
  pricing_skus?: Record<string, unknown>;
  allowed_passthrough_parameters?: string[];
  synced_at?: string;
};

type Job = {
  id: string;
  batchId?: string | null;
  batchIndex?: number | null;
  openrouterJobId?: string;
  status: string;
  mode: string;
  model: string;
  prompt: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  localVideoPath?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  contentUrl?: string | null;
};

type SettingsState = {
  apiKey: string;
  outputDir: string;
  pollIntervalSeconds: number;
  timeoutMinutes: number;
  requireExpensiveConfirmation: boolean;
  hasApiKey: boolean;
};

type UploadedAsset = {
  id: string;
  name: string;
  mime_type: string;
};

type CostEstimate = {
  cost?: number;
  sku?: string;
  unitPrice?: number;
  multiplier?: number;
  confidence: 'high' | 'medium' | 'unknown';
  reason: string;
  pricingEntries: Array<[string, string]>;
};

type BatchCostEstimate = {
  totalCost?: number;
  totalJobs: number;
  perVideoCost?: number;
  unknownCount: number;
  hasSettingAdjustments: boolean;
  rows: Array<{
    modelId: string;
    videos: number;
    effectiveDuration: string;
    effectiveResolution: string;
    effectiveAspectRatio: string;
    effectiveSize: string;
    durationAdjusted: boolean;
    resolutionAdjusted: boolean;
    aspectRatioAdjusted: boolean;
    sizeAdjusted: boolean;
    estimate: CostEstimate;
  }>;
};

type GenerateForm = {
  mode: 'text' | 'image' | 'start_end';
  model: string;
  batchMode: boolean;
  batchModels: string[];
  videosPerModel: number;
  prompt: string;
  duration: string;
  resolution: string;
  aspectRatio: string;
  size: string;
  generateAudio: boolean;
  seed: string;
  firstFrame?: UploadedAsset;
  lastFrame?: UploadedAsset;
};

const api = {
  async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(body?.error || `Request failed: ${response.status}`);
    return body as T;
  }
};

function createDefaultGenerateForm(defaultModel = ''): GenerateForm {
  return {
    mode: 'text',
    model: defaultModel,
    batchMode: false,
    batchModels: defaultModel ? [defaultModel] : [],
    videosPerModel: 1,
    prompt: '',
    duration: '',
    resolution: '',
    aspectRatio: '',
    size: '',
    generateAudio: false,
    seed: ''
  };
}

function App() {
  const [tab, setTab] = React.useState<Tab>('generate');
  const [settings, setSettings] = React.useState<SettingsState | null>(null);
  const [models, setModels] = React.useState<VideoModel[]>([]);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [selectedCompare, setSelectedCompare] = React.useState<string[]>([]);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState<GenerateForm>(() => createDefaultGenerateForm());

  const selectedModel = React.useMemo(
    () => models.find((model) => model.id === form.model),
    [models, form.model]
  );

  const completedJobs = jobs.filter((job) => job.status === 'completed');

  React.useEffect(() => {
    void loadInitial();
  }, []);

  React.useEffect(() => {
    setForm((current) => sanitizeFormForCapabilities(current, models));
  }, [models, form.model]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      if (!jobs.some((job) => activeStatus(job.status))) return;
      void pollActiveJobs(false);
    }, Math.max(10, settings?.pollIntervalSeconds || 15) * 1000);

    return () => window.clearInterval(interval);
  }, [jobs, settings?.pollIntervalSeconds]);

  async function loadInitial() {
    await Promise.all([loadSettings(), loadModels(), loadJobs()]);
  }

  async function loadSettings() {
    const next = await api.request<SettingsState>('/api/settings');
    setSettings(next);
  }

  async function loadModels() {
    const result = await api.request<{ data: VideoModel[] }>('/api/models/video');
    setModels(result.data);
    if (!form.model && result.data.length > 0) {
      setForm((current) => ({ ...current, model: result.data[0].id, batchModels: current.batchModels.length ? current.batchModels : [result.data[0].id] }));
    }
  }

  async function loadJobs() {
    const result = await api.request<{ data: Job[] }>('/api/jobs');
    setJobs(result.data);
  }

  async function syncModels() {
    setBusy(true);
    setMessage('Syncing models from OpenRouter...');
    try {
      const result = await api.request<{ data: VideoModel[] }>('/api/models/sync', { method: 'POST' });
      setModels(result.data);
      if (!form.model && result.data.length > 0) setForm((current) => ({ ...current, model: result.data[0].id, batchModels: current.batchModels.length ? current.batchModels : [result.data[0].id] }));
      setMessage(`Synced ${result.data.length} video models.`);
    } catch (error) {
      setMessage(getError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitJob() {
    setBusy(true);
    setMessage(form.batchMode ? 'Submitting batch...' : 'Submitting video job...');
    try {
      const frameImages = buildFrameImages(form);

      if (form.batchMode) {
        const selectedModels = form.batchModels.filter(Boolean).slice(0, 3);
        if (selectedModels.length === 0) throw new Error('Select at least one model for the batch.');
        const incompatibleModel = selectedModels.find((modelId) => {
          const model = models.find((item) => item.id === modelId);
          return !modelSupportsMode(model, form.mode);
        });
        if (incompatibleModel) throw new Error(`${incompatibleModel} does not support the selected generation mode.`);
        const batchEstimate = estimateBatchCost(models, form, selectedModels);
        const result = await api.request<{ batch: { id: string }; data: Job[] }>('/api/batches', {
          method: 'POST',
          body: JSON.stringify({
            mode: form.mode,
            models: selectedModels,
            videosPerModel: form.videosPerModel,
            prompt: form.prompt,
            duration: form.duration,
            resolution: form.resolution,
            aspectRatio: form.aspectRatio,
            size: form.size,
            generateAudio: form.generateAudio,
            seed: form.seed,
            frameImages,
            modelSettings: Object.fromEntries(batchEstimate.rows.map((row) => [row.modelId, {
              duration: row.effectiveDuration,
              resolution: row.effectiveResolution,
              aspectRatio: row.effectiveAspectRatio,
              size: row.effectiveSize
            }])),
            estimatedCost: batchEstimate.totalCost
          })
        });
        setJobs((current) => [...result.data, ...current]);
        setTab('jobs');
        setMessage(`Batch ${result.batch.id} submitted with ${result.data.length} jobs.`);
        window.setTimeout(() => void pollActiveJobs(false), 2500);
        return;
      }

      const job = await api.request<Job>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          mode: form.mode,
          model: form.model,
          prompt: form.prompt,
          duration: form.duration,
          resolution: form.resolution,
          aspectRatio: form.aspectRatio,
          size: form.size,
          generateAudio: form.generateAudio,
          seed: form.seed,
          frameImages
        })
      });
      setJobs((current) => [job, ...current]);
      setTab('jobs');
      setMessage(`Job ${job.status}: ${job.id}`);
      window.setTimeout(() => void pollActiveJobs(false), 2500);
    } catch (error) {
      setMessage(getError(error));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFrame(file: File, frame: 'firstFrame' | 'lastFrame') {
    const dataUrl = await fileToDataUrl(file);
    const asset = await api.request<UploadedAsset>('/api/assets/upload', {
      method: 'POST',
      body: JSON.stringify({
        kind: frame,
        name: file.name,
        mimeType: file.type,
        dataUrl
      })
    });
    setForm((current) => ({ ...current, [frame]: asset }));
  }

  async function pollJob(id: string, announce = true) {
    try {
      const job = await api.request<Job>(`/api/jobs/${id}/poll`, { method: 'POST' });
      setJobs((current) => current.map((item) => (item.id === id ? job : item)));
      if (announce) setMessage(`Job ${job.id} is ${job.status}.`);
    } catch (error) {
      if (announce) setMessage(getError(error));
    }
  }

  async function pollActiveJobs(announce = true) {
    try {
      const result = await api.request<{ data: Job[] }>('/api/jobs/poll-active', { method: 'POST' });
      setJobs(result.data);
      if (announce) setMessage('Active jobs refreshed.');
    } catch (error) {
      if (announce) setMessage(getError(error));
    }
  }

  async function downloadJob(id: string) {
    setMessage('Downloading completed video...');
    try {
      const job = await api.request<Job>(`/api/jobs/${id}/download`, { method: 'POST', body: JSON.stringify({ index: 0 }) });
      setJobs((current) => current.map((item) => (item.id === id ? job : item)));
      setMessage(`Saved to ${job.localVideoPath}`);
    } catch (error) {
      setMessage(getError(error));
    }
  }

  function clearGenerateForm() {
    setForm(sanitizeFormForCapabilities(createDefaultGenerateForm(models[0]?.id), models));
    setMessage('Generate form cleared.');
  }

  async function duplicateJob(job: Job) {
    setForm({
      mode: normalizeMode(job.mode),
      model: job.model,
      batchMode: false,
      batchModels: [job.model],
      videosPerModel: 1,
      prompt: job.prompt,
      duration: String(job.payload.duration || ''),
      resolution: String(job.payload.resolution || ''),
      aspectRatio: String(job.payload.aspect_ratio || ''),
      size: String(job.payload.size || ''),
      generateAudio: Boolean(job.payload.generate_audio),
      seed: String(job.payload.seed || '')
    });
    setTab('generate');
    setMessage('Loaded previous job settings into Generate.');
  }

  function toggleCompare(id: string) {
    setSelectedCompare((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 4) return current;
      return [...current, id];
    });
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Film size={24} />
          <div>
            <strong>Open Video Studio</strong>
            <span>Local video generation</span>
          </div>
        </div>
        <nav>
          <TabButton icon={<Wand2 size={18} />} active={tab === 'generate'} onClick={() => setTab('generate')}>Generate</TabButton>
          <TabButton icon={<Play size={18} />} active={tab === 'jobs'} onClick={() => setTab('jobs')}>Jobs</TabButton>
          <TabButton icon={<GalleryHorizontal size={18} />} active={tab === 'gallery'} onClick={() => setTab('gallery')}>Gallery</TabButton>
          <TabButton icon={<LayoutGrid size={18} />} active={tab === 'models'} onClick={() => setTab('models')}>Models</TabButton>
          <TabButton icon={<Settings size={18} />} active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</TabButton>
        </nav>
        <div className="sidebar-status">
          <span className={settings?.hasApiKey ? 'dot ok' : 'dot'} />
          {settings?.hasApiKey ? 'API key saved' : 'API key missing'}
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <h1>{titleForTab(tab)}</h1>
            <p>{subtitleForTab(tab)}</p>
          </div>
          <button className="secondary" onClick={loadInitial} title="Refresh local data">
            <RefreshCcw size={17} />
            Refresh
          </button>
        </header>

        {message && <div className="message">{message}</div>}

        {tab === 'generate' && (
          <GenerateView
            form={form}
            setForm={setForm}
            models={models}
            selectedModel={selectedModel}
            busy={busy}
            onSubmit={submitJob}
            onClear={clearGenerateForm}
            onSyncModels={syncModels}
            onUploadFrame={uploadFrame}
          />
        )}

        {tab === 'jobs' && (
          <JobsView
            jobs={jobs}
            selectedCompare={selectedCompare}
            onPoll={pollJob}
            onPollActive={pollActiveJobs}
            onDownload={downloadJob}
            onDuplicate={duplicateJob}
            onToggleCompare={toggleCompare}
          />
        )}

        {tab === 'gallery' && (
          <GalleryView
            jobs={completedJobs}
            selectedCompare={selectedCompare}
            onDownload={downloadJob}
            onDuplicate={duplicateJob}
            onToggleCompare={toggleCompare}
          />
        )}

        {tab === 'models' && (
          <ModelsView models={models} busy={busy} onSyncModels={syncModels} />
        )}

        {tab === 'settings' && settings && (
          <SettingsView settings={settings} setSettings={setSettings} setMessage={setMessage} />
        )}

        {selectedCompare.length >= 2 && (
          <CompareTray jobs={jobs.filter((job) => selectedCompare.includes(job.id))} onClose={() => setSelectedCompare([])} />
        )}
      </main>
    </div>
  );
}

function GenerateView({
  form,
  setForm,
  models,
  selectedModel,
  busy,
  onSubmit,
  onClear,
  onSyncModels,
  onUploadFrame
}: {
  form: GenerateForm;
  setForm: React.Dispatch<React.SetStateAction<GenerateForm>>;
  models: VideoModel[];
  selectedModel?: VideoModel;
  busy: boolean;
  onSubmit: () => void;
  onClear: () => void;
  onSyncModels: () => void;
  onUploadFrame: (file: File, frame: 'firstFrame' | 'lastFrame') => void;
}) {
  const frameTypes = selectedModel?.supported_frame_images || [];
  const supportsFirst = frameTypes.includes('first_frame');
  const supportsLast = frameTypes.includes('last_frame');
  const selectedBatchModels = form.batchModels.filter(Boolean).slice(0, 3);
  const capabilityModels = selectedModel ? [selectedModel] : [];
  const durations = intersectModelValues(capabilityModels, 'supported_durations').map(String);
  const resolutions = intersectModelValues(capabilityModels, 'supported_resolutions');
  const aspects = intersectModelValues(capabilityModels, 'supported_aspect_ratios');
  const sizes = filterSizesForSettings(intersectModelValues(capabilityModels, 'supported_sizes'), form.aspectRatio, form.resolution);
  const estimate = estimateVideoCost(selectedModel, form);
  const batchEstimate = estimateBatchCost(models, form, selectedBatchModels);

  return (
    <section className="workspace">
      <div className="panel generate-panel">
        <div className="panel-toolbar">
          <h2>Prompt</h2>
          <button className="secondary" onClick={onClear} disabled={busy}>
            Clear
          </button>
        </div>

        <div className="mode-tabs">
          <button className={form.mode === 'text' ? 'active' : ''} onClick={() => setForm((current) => ({ ...current, mode: 'text' }))}>
            Text
          </button>
          <button className={form.mode === 'image' ? 'active' : ''} disabled={!supportsFirst} onClick={() => setForm((current) => ({ ...current, mode: 'image' }))}>
            Image
          </button>
          <button className={form.mode === 'start_end' ? 'active' : ''} disabled={!supportsFirst || !supportsLast} onClick={() => setForm((current) => ({ ...current, mode: 'start_end' }))}>
            Start + End
          </button>
        </div>

        <label>
          Model
          <select value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value, batchModels: current.batchModels.length ? current.batchModels : [event.target.value] }))}>
            <option value="">Select a model</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
          </select>
        </label>

        {models.length === 0 && (
          <button className="secondary" onClick={onSyncModels} disabled={busy}>
            <RefreshCcw size={17} />
            Sync Video Models
          </button>
        )}

        <div className="batch-box">
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.batchMode}
              onChange={(event) => setForm((current) => ({
                ...current,
                batchMode: event.target.checked,
                batchModels: current.batchModels.length ? current.batchModels : current.model ? [current.model] : []
              }))}
            />
            Batch across multiple models
          </label>

          {form.batchMode && (
            <>
              <div className="batch-toolbar">
                <strong>{selectedBatchModels.length}/3 models</strong>
                <label>
                  Videos per model
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={form.videosPerModel}
                    onChange={(event) => setForm((current) => ({ ...current, videosPerModel: clampNumber(Number(event.target.value), 1, 3) }))}
                  />
                </label>
              </div>
              <div className="batch-model-list">
                {models.map((model) => {
                  const checked = form.batchModels.includes(model.id);
                  const compatible = modelSupportsMode(model, form.mode);
                  const disabled = !checked && (!compatible || selectedBatchModels.length >= 3);
                  return (
                    <label className={`batch-model-row ${disabled ? 'disabled' : ''}`} key={model.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => setForm((current) => {
                          const nextModels = event.target.checked
                            ? [...current.batchModels, model.id].slice(0, 3)
                            : current.batchModels.filter((id) => id !== model.id);
                          return {
                            ...current,
                            batchModels: nextModels,
                            model: current.model || nextModels[0] || ''
                          };
                        })}
                      />
                      <span>{model.id}{compatible ? '' : ' - unsupported mode'}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <label>
          Prompt
          <textarea
            rows={8}
            value={form.prompt}
            onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
            placeholder="A cinematic shot of a golden retriever running across a beach at sunset."
          />
        </label>

        {(form.mode === 'image' || form.mode === 'start_end') && (
          <div className="frame-grid">
            <FrameUpload
              label="First frame"
              asset={form.firstFrame}
              onChange={(file) => onUploadFrame(file, 'firstFrame')}
            />
            {form.mode === 'start_end' && (
              <FrameUpload
                label="Last frame"
                asset={form.lastFrame}
                onChange={(file) => onUploadFrame(file, 'lastFrame')}
              />
            )}
          </div>
        )}
      </div>

      <div className="panel controls-panel">
        <h2>Controls</h2>
        <div className="field-grid">
          <SmartInput label="Duration" value={form.duration} options={durations} onChange={(value) => setForm((current) => ({ ...current, duration: value }))} />
          <SmartInput label="Resolution" value={form.resolution} options={resolutions} onChange={(value) => setForm((current) => ({ ...current, resolution: value, size: sizeMatchesSettings(current.size, current.aspectRatio, value) ? current.size : '' }))} />
          <SmartInput label="Aspect" value={form.aspectRatio} options={aspects} onChange={(value) => setForm((current) => ({ ...current, aspectRatio: value, size: sizeMatchesSettings(current.size, value, current.resolution) ? current.size : '' }))} />
          <SmartInput label="Size" value={form.size} options={sizes} onChange={(value) => setForm((current) => ({ ...current, size: value }))} />
        </div>
        {form.batchMode && (
          <p className="control-note">Batch estimates show each model's effective settings when a selected value is not supported by every model.</p>
        )}

        {selectedModel?.seed && (
          <label>
            Seed
            <input value={form.seed} onChange={(event) => setForm((current) => ({ ...current, seed: event.target.value }))} />
          </label>
        )}

        <label className="toggle">
          <input
            type="checkbox"
            checked={form.generateAudio}
            disabled={!selectedModel?.generate_audio}
            onChange={(event) => setForm((current) => ({ ...current, generateAudio: event.target.checked }))}
          />
          Generate audio
        </label>

        <ModelCapability model={selectedModel} />

        {form.batchMode
          ? <BatchCostEstimatePanel estimate={batchEstimate} />
          : <CostEstimatePanel estimate={estimate} duration={form.duration} />}

        <button className="primary submit" onClick={onSubmit} disabled={busy || !form.prompt.trim() || (!form.batchMode && !form.model) || (form.batchMode && selectedBatchModels.length === 0)}>
          <Wand2 size={18} />
          {form.batchMode ? `Generate ${batchEstimate.totalJobs} Videos` : 'Generate Video'}
        </button>
      </div>
    </section>
  );
}

function JobsView({
  jobs,
  selectedCompare,
  onPoll,
  onPollActive,
  onDownload,
  onDuplicate,
  onToggleCompare
}: {
  jobs: Job[];
  selectedCompare: string[];
  onPoll: (id: string) => void;
  onPollActive: () => void;
  onDownload: (id: string) => void;
  onDuplicate: (job: Job) => void;
  onToggleCompare: (id: string) => void;
}) {
  return (
    <>
      <div className="toolbar">
        <button className="primary" onClick={onPollActive}>
          <RefreshCcw size={17} />
          Poll Active Jobs
        </button>
      </div>
      <section className="job-list">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            selected={selectedCompare.includes(job.id)}
            onPoll={onPoll}
            onDownload={onDownload}
            onDuplicate={onDuplicate}
            onToggleCompare={onToggleCompare}
          />
        ))}
        {jobs.length === 0 && <EmptyState icon={<Play size={28} />} title="No jobs yet" text="Submit a generation to start tracking jobs." />}
      </section>
    </>
  );
}

function GalleryView({
  jobs,
  selectedCompare,
  onDownload,
  onDuplicate,
  onToggleCompare
}: {
  jobs: Job[];
  selectedCompare: string[];
  onDownload: (id: string) => void;
  onDuplicate: (job: Job) => void;
  onToggleCompare: (id: string) => void;
}) {
  return (
    <section className="gallery-grid">
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          selected={selectedCompare.includes(job.id)}
          compact
          onPoll={() => undefined}
          onDownload={onDownload}
          onDuplicate={onDuplicate}
          onToggleCompare={onToggleCompare}
        />
      ))}
      {jobs.length === 0 && <EmptyState icon={<GalleryHorizontal size={28} />} title="No completed videos" text="Completed jobs will appear here." />}
    </section>
  );
}

function ModelsView({ models, busy, onSyncModels }: { models: VideoModel[]; busy: boolean; onSyncModels: () => void }) {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const visible = models.filter((model) => {
    const haystack = `${model.id} ${model.name || ''}`.toLowerCase();
    if (!haystack.includes(query.toLowerCase())) return false;
    if (filter === 'image') return (model.supported_frame_images || []).includes('first_frame');
    if (filter === 'start_end') {
      const frames = model.supported_frame_images || [];
      return frames.includes('first_frame') && frames.includes('last_frame');
    }
    if (filter === 'audio') return Boolean(model.generate_audio);
    if (filter === 'vertical') return (model.supported_aspect_ratios || []).includes('9:16');
    return true;
  });

  return (
    <section>
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" />
        </div>
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All</option>
          <option value="image">Image-to-video</option>
          <option value="start_end">Start + end</option>
          <option value="audio">Audio</option>
          <option value="vertical">9:16</option>
        </select>
        <button className="primary" onClick={onSyncModels} disabled={busy}>
          <RefreshCcw size={17} />
          Sync
        </button>
      </div>

      <div className="model-grid">
        {visible.map((model) => (
          <article className="model-card" key={model.id}>
            <h2>{model.name || model.id}</h2>
            <code>{model.id}</code>
            <ModelCapability model={model} />
          </article>
        ))}
      </div>
      {visible.length === 0 && <EmptyState icon={<LayoutGrid size={28} />} title="No models" text="Sync models after saving your OpenRouter API key." />}
    </section>
  );
}

function SettingsView({
  settings,
  setSettings,
  setMessage
}: {
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>;
  setMessage: (message: string) => void;
}) {
  const [local, setLocal] = React.useState(settings);

  async function save() {
    try {
      const updated = await api.request<SettingsState>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(local)
      });
      setSettings(updated);
      setMessage('Settings saved.');
    } catch (error) {
      setMessage(getError(error));
    }
  }

  async function testKey() {
    try {
      const result = await api.request<{ ok: boolean; count: number }>('/api/settings/test', {
        method: 'POST',
        body: JSON.stringify({ apiKey: local.apiKey })
      });
      setMessage(`OpenRouter key works. Found ${result.count} video models.`);
    } catch (error) {
      setMessage(getError(error));
    }
  }

  return (
    <section className="settings-grid">
      <div className="panel">
        <h2>OpenRouter</h2>
        <label>
          API key
          <input
            type="password"
            value={local.apiKey}
            onChange={(event) => setLocal((current) => ({ ...current, apiKey: event.target.value }))}
            placeholder="sk-or-v1-..."
          />
        </label>
        <div className="actions">
          <button className="primary" onClick={save}>
            <KeyRound size={17} />
            Save
          </button>
          <button className="secondary" onClick={testKey}>
            <RefreshCcw size={17} />
            Test
          </button>
          <button className="secondary" onClick={() => setLocal((current) => ({ ...current, apiKey: '' }))}>
            Clear
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Local Files</h2>
        <label>
          Output directory
          <input value={local.outputDir} onChange={(event) => setLocal((current) => ({ ...current, outputDir: event.target.value }))} />
        </label>
        <div className="field-grid">
          <label>
            Poll interval
            <input
              type="number"
              min="10"
              value={local.pollIntervalSeconds}
              onChange={(event) => setLocal((current) => ({ ...current, pollIntervalSeconds: Number(event.target.value) }))}
            />
          </label>
          <label>
            Timeout
            <input
              type="number"
              min="5"
              value={local.timeoutMinutes}
              onChange={(event) => setLocal((current) => ({ ...current, timeoutMinutes: Number(event.target.value) }))}
            />
          </label>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={local.requireExpensiveConfirmation}
            onChange={(event) => setLocal((current) => ({ ...current, requireExpensiveConfirmation: event.target.checked }))}
          />
          Confirm expensive generations
        </label>
        <p className="note">This app is designed for local use. Do not host it publicly with your API key saved.</p>
      </div>
    </section>
  );
}

function JobCard({
  job,
  selected,
  compact = false,
  onPoll,
  onDownload,
  onDuplicate,
  onToggleCompare
}: {
  job: Job;
  selected: boolean;
  compact?: boolean;
  onPoll: (id: string) => void;
  onDownload: (id: string) => void;
  onDuplicate: (job: Job) => void;
  onToggleCompare: (id: string) => void;
}) {
  return (
    <article className={`job-card ${compact ? 'compact' : ''}`}>
      <div className="video-frame">
        {job.contentUrl ? (
          <video src={job.contentUrl} controls />
        ) : (
          <div className="video-placeholder">
            <Film size={28} />
            <span>{job.status}</span>
          </div>
        )}
      </div>
      <div className="job-body">
        <div className="job-title">
          <div>
            <strong>{job.model}</strong>
            <span>{job.batchId ? `Batch ${job.batchId} / #${job.batchIndex}` : new Date(job.createdAt).toLocaleString()}</span>
          </div>
          <StatusBadge status={job.status} />
        </div>
        <p>{job.prompt}</p>
        {typeof job.result?.usage === 'object' && job.result?.usage && (
          <div className="metadata-row">
            <span>Actual cost</span>
            <strong>{formatCost((job.result.usage as { cost?: number }).cost)}</strong>
          </div>
        )}
        {job.error && <div className="error">{job.error}</div>}
        {job.localVideoPath && <code className="path">{job.localVideoPath}</code>}
        <div className="actions">
          {!['completed', 'failed', 'draft'].includes(job.status) && (
            <button className="secondary" onClick={() => onPoll(job.id)} title="Poll job">
              <RefreshCcw size={16} />
              Poll
            </button>
          )}
          {job.status === 'completed' && (
            <button className="secondary" onClick={() => onDownload(job.id)} title="Download video">
              <Download size={16} />
              Save
            </button>
          )}
          {job.status === 'completed' && (
            <button className={selected ? 'primary' : 'secondary'} onClick={() => onToggleCompare(job.id)} title="Compare video">
              <SplitSquareHorizontal size={16} />
              Compare
            </button>
          )}
          <button className="secondary" onClick={() => onDuplicate(job)} title="Duplicate settings">
            <Wand2 size={16} />
            Use
          </button>
        </div>
      </div>
    </article>
  );
}

function CompareTray({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  return (
    <section className="compare-tray">
      <div className="compare-header">
        <strong>Compare</strong>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${jobs.length}, minmax(220px, 1fr))` }}>
        {jobs.map((job) => (
          <div className="compare-item" key={job.id}>
            {job.contentUrl ? <video src={job.contentUrl} controls /> : <div className="video-placeholder">No local file</div>}
            <strong>{job.model}</strong>
            <p>{job.prompt}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FrameUpload({ label, asset, onChange }: { label: string; asset?: UploadedAsset; onChange: (file: File) => void }) {
  return (
    <label className="frame-upload">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onChange(file);
        }}
      />
      <Upload size={22} />
      <strong>{label}</strong>
      <span>{asset?.name || 'Upload PNG, JPEG, or WebP'}</span>
    </label>
  );
}

function SmartInput({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      {options.length > 0 ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Auto</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Auto" />
      )}
    </label>
  );
}

function ModelCapability({ model }: { model?: VideoModel }) {
  if (!model) return <div className="capabilities">Select a model to see capabilities.</div>;
  const chips = [
    ...(model.supported_durations || []).map((duration) => `${duration}s`),
    ...(model.supported_resolutions || []),
    ...(model.supported_sizes || []),
    ...(model.supported_aspect_ratios || []),
    ...(model.supported_frame_images || []),
    model.generate_audio ? 'audio' : '',
    model.seed ? 'seed' : ''
  ].filter(Boolean);

  return (
    <div className="capabilities">
      {chips.length > 0 ? chips.map((chip) => <span key={chip}>{chip}</span>) : <span>dynamic metadata</span>}
    </div>
  );
}

function CostEstimatePanel({ estimate, duration }: { estimate: CostEstimate; duration: string }) {
  const hasCost = typeof estimate.cost === 'number';

  return (
    <div className={`cost-panel ${estimate.confidence}`}>
      <div className="cost-panel-header">
        <span>Estimated Cost</span>
        <strong>{hasCost ? formatCost(estimate.cost) : 'Unavailable'}</strong>
      </div>
      <p>{estimate.reason}</p>
      {hasCost && (
        <div className="cost-details">
          <span>SKU</span>
          <code>{estimate.sku}</code>
          <span>Unit price</span>
          <strong>{formatCost(estimate.unitPrice)}</strong>
          <span>Billable units</span>
          <strong>{formatNumber(estimate.multiplier)}{estimate.sku?.includes('second') ? ' sec' : ''}</strong>
        </div>
      )}
      {!duration && hasCost && estimate.sku?.includes('second') && (
        <p className="cost-warning">Choose a duration for a more precise estimate.</p>
      )}
      {estimate.pricingEntries.length > 0 && (
        <details>
          <summary>Pricing metadata</summary>
          <div className="pricing-list">
            {estimate.pricingEntries.map(([key, value]) => (
              <React.Fragment key={key}>
                <code>{key}</code>
                <span>{value}</span>
              </React.Fragment>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function BatchCostEstimatePanel({ estimate }: { estimate: BatchCostEstimate }) {
  const hasTotal = typeof estimate.totalCost === 'number';

  return (
    <div className={`cost-panel ${estimate.unknownCount ? 'medium' : 'high'}`}>
      <div className="cost-panel-header">
        <span>Estimated Batch Cost</span>
        <strong>{hasTotal ? formatCost(estimate.totalCost) : 'Partial'}</strong>
      </div>
      <p>
        {estimate.totalJobs} job{estimate.totalJobs === 1 ? '' : 's'} across {estimate.rows.length} model{estimate.rows.length === 1 ? '' : 's'}.
        {estimate.unknownCount ? ` ${estimate.unknownCount} model estimate${estimate.unknownCount === 1 ? ' is' : 's are'} unavailable.` : ''}
      </p>
      <div className="batch-cost-list">
        {estimate.rows.map((row) => (
          <React.Fragment key={row.modelId}>
            <code>{row.modelId}</code>
            <span>{row.videos} x {typeof row.estimate.cost === 'number' ? formatCost(row.estimate.cost) : 'unknown'}</span>
            <small>{formatEffectiveSettings(row)}</small>
            <small>{row.estimate.sku || row.estimate.reason}</small>
          </React.Fragment>
        ))}
      </div>
      {estimate.hasSettingAdjustments && (
        <p className="cost-warning">Some models cannot use the selected settings, so the closest supported settings shown above will be submitted for those models.</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function TabButton({ icon, active, onClick, children }: { icon: React.ReactNode; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function buildFrameImages(form: GenerateForm) {
  const frameImages = [];
  if (form.mode === 'image' || form.mode === 'start_end') {
    if (!form.firstFrame) throw new Error('Upload a first frame image.');
    frameImages.push({ assetId: form.firstFrame.id, frameType: 'first_frame' });
  }
  if (form.mode === 'start_end') {
    if (!form.lastFrame) throw new Error('Upload a last frame image.');
    frameImages.push({ assetId: form.lastFrame.id, frameType: 'last_frame' });
  }
  return frameImages;
}

function getError(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function normalizeMode(mode: string): GenerateForm['mode'] {
  if (mode === 'image' || mode === 'image_to_video') return 'image';
  if (mode === 'start_end' || mode === 'start_end_frame') return 'start_end';
  return 'text';
}

function activeStatus(status: string) {
  return ['submitting', 'queued', 'processing', 'pending', 'in_progress'].includes(status);
}

function formatCost(cost: number | undefined) {
  if (typeof cost !== 'number') return 'unknown';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(cost);
}

function formatNumber(value: number | undefined) {
  if (typeof value !== 'number') return 'unknown';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatEffectiveSettings(row: BatchCostEstimate['rows'][number]) {
  const parts = [
    settingLabel('duration', row.effectiveDuration ? `${row.effectiveDuration}s` : '', row.durationAdjusted),
    settingLabel('resolution', row.effectiveResolution, row.resolutionAdjusted),
    settingLabel('aspect', row.effectiveAspectRatio, row.aspectRatioAdjusted),
    settingLabel('size', row.effectiveSize, row.sizeAdjusted)
  ].filter(Boolean);
  return parts.join(' · ');
}

function settingLabel(label: string, value: string, adjusted: boolean) {
  if (!value) return '';
  return adjusted ? `${label}: uses ${value}` : `${label}: ${value}`;
}

function modelSupportsMode(model: VideoModel | undefined, mode: GenerateForm['mode']) {
  if (!model) return false;
  if (mode === 'text') return true;
  const frames = model.supported_frame_images || [];
  if (mode === 'image') return frames.includes('first_frame');
  if (mode === 'start_end') return frames.includes('first_frame') && frames.includes('last_frame');
  return true;
}

function sanitizeFormForCapabilities(form: GenerateForm, models: VideoModel[]) {
  const selectedModels = form.batchMode
    ? form.batchModels.slice(0, 3).map((id) => models.find((model) => model.id === id)).filter(Boolean) as VideoModel[]
    : form.model
      ? models.filter((model) => model.id === form.model)
      : [];

  if (selectedModels.length === 0) return form;

  const durations = intersectModelValues(selectedModels, 'supported_durations').map(String);
  const resolutions = intersectModelValues(selectedModels, 'supported_resolutions');
  const aspects = intersectModelValues(selectedModels, 'supported_aspect_ratios');
  const sizes = filterSizesForSettings(intersectModelValues(selectedModels, 'supported_sizes'), form.aspectRatio, form.resolution);

  const next = {
    ...form,
    batchModels: form.batchModels.slice(0, 3)
  };

  if (durations.length && !durations.includes(next.duration)) next.duration = durations[0];
  if (resolutions.length && !resolutions.includes(next.resolution)) next.resolution = resolutions[0];
  if (sizes.length && next.size && !sizes.includes(next.size)) next.size = '';
  if (aspects.length && !aspects.includes(next.aspectRatio)) next.aspectRatio = aspects[0];
  if (next.size && !sizeMatchesSettings(next.size, next.aspectRatio, next.resolution)) next.size = '';
  if (!selectedModels.some((model) => model.generate_audio)) next.generateAudio = false;

  return shallowEqualForm(form, next) ? form : next;
}

function intersectModelValues(modelList: VideoModel[], key: 'supported_durations' | 'supported_resolutions' | 'supported_sizes' | 'supported_aspect_ratios') {
  if (modelList.length === 0) return [];
  const valueSets = modelList
    .map((model) => model[key] || [])
    .filter((values) => values.length > 0)
    .map((values) => new Set(values.map(String)));

  if (valueSets.length === 0) return [];

  const [firstSet, ...rest] = valueSets;
  return [...firstSet]
    .filter((value) => rest.every((set) => set.has(value)))
    .sort((a, b) => numericAwareSort(a, b));
}

function numericAwareSort(a: string, b: string) {
  const numericA = Number.parseFloat(a);
  const numericB = Number.parseFloat(b);
  if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) {
    return numericA - numericB;
  }
  return a.localeCompare(b);
}

function shallowEqualForm(a: GenerateForm, b: GenerateForm) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function estimateBatchCost(models: VideoModel[], form: GenerateForm, selectedModelIds: string[]): BatchCostEstimate {
  const videos = clampNumber(form.videosPerModel, 1, 3);
  const rows = selectedModelIds.slice(0, 3).map((modelId) => {
    const model = models.find((item) => item.id === modelId);
    const effectiveDuration = getEffectiveModelValue(model, 'supported_durations', form.duration);
    const effectiveResolution = getEffectiveModelValue(model, 'supported_resolutions', form.resolution);
    const effectiveAspectRatio = getEffectiveModelValue(model, 'supported_aspect_ratios', form.aspectRatio);
    const effectiveSize = getEffectiveSize(model, form.size, effectiveAspectRatio, effectiveResolution);
    const effectiveForm = {
      ...form,
      model: modelId,
      duration: effectiveDuration,
      resolution: effectiveResolution,
      aspectRatio: effectiveAspectRatio,
      size: effectiveSize
    };
    return {
      modelId,
      videos,
      effectiveDuration,
      effectiveResolution,
      effectiveAspectRatio,
      effectiveSize,
      durationAdjusted: valueAdjusted(form.duration, effectiveDuration),
      resolutionAdjusted: valueAdjusted(form.resolution, effectiveResolution),
      aspectRatioAdjusted: valueAdjusted(form.aspectRatio, effectiveAspectRatio),
      sizeAdjusted: valueAdjusted(form.size, effectiveSize),
      estimate: estimateVideoCost(model, effectiveForm)
    };
  });
  const knownRows = rows.filter((row) => typeof row.estimate.cost === 'number');
  const totalCost = knownRows.length === rows.length
    ? rows.reduce((total, row) => total + (row.estimate.cost || 0) * row.videos, 0)
    : undefined;

  return {
    totalCost,
    totalJobs: rows.length * videos,
    perVideoCost: knownRows.length === rows.length && rows.length > 0 ? totalCost! / (rows.length * videos) : undefined,
    unknownCount: rows.length - knownRows.length,
    hasSettingAdjustments: rows.some((row) => row.durationAdjusted || row.resolutionAdjusted || row.aspectRatioAdjusted || row.sizeAdjusted),
    rows
  };
}

function getEffectiveModelValue(model: VideoModel | undefined, key: 'supported_durations' | 'supported_resolutions' | 'supported_aspect_ratios' | 'supported_sizes', requestedValue: string) {
  const supported = (model?.[key] || []).map(String).sort(numericAwareSort);
  if (supported.length === 0) return requestedValue;
  if (requestedValue && supported.includes(requestedValue)) return requestedValue;
  const requestedNumber = Number.parseFloat(requestedValue);
  if (Number.isFinite(requestedNumber)) {
    return supported.reduce((best, current) => {
      return Math.abs(Number.parseFloat(current) - requestedNumber) < Math.abs(Number.parseFloat(best) - requestedNumber) ? current : best;
    }, supported[0]);
  }
  return supported[0];
}

function getEffectiveSize(model: VideoModel | undefined, requestedSize: string, aspectRatio: string, resolution: string) {
  const supported = filterSizesForSettings((model?.supported_sizes || []).map(String), aspectRatio, resolution).sort(numericAwareSort);
  if (!requestedSize) return '';
  if (supported.length === 0) return sizeMatchesSettings(requestedSize, aspectRatio, resolution) ? requestedSize : '';
  if (requestedSize && supported.includes(requestedSize)) return requestedSize;
  if (requestedSize && sizeMatchesSettings(requestedSize, aspectRatio, resolution)) {
    const requestedPixels = sizePixels(requestedSize);
    return supported.reduce((best, current) => {
      return Math.abs(sizePixels(current) - requestedPixels) < Math.abs(sizePixels(best) - requestedPixels) ? current : best;
    }, supported[0]);
  }
  return supported[0];
}

function valueAdjusted(requestedValue: string, effectiveValue: string) {
  return Boolean(requestedValue && effectiveValue && requestedValue !== effectiveValue);
}

function filterSizesForSettings(sizes: string[], aspectRatio: string, resolution: string) {
  return sizes.filter((size) => sizeMatchesSettings(size, aspectRatio, resolution));
}

function sizeMatchesSettings(size: string, aspectRatio: string, resolution: string) {
  return sizeMatchesAspect(size, aspectRatio) && sizeMatchesResolution(size, resolution);
}

function sizeMatchesAspect(size: string, aspectRatio: string) {
  if (!size || !aspectRatio) return true;
  const parsedSize = parseSize(size);
  const parsedAspect = parseAspectRatio(aspectRatio);
  if (!parsedSize || !parsedAspect) return true;
  return parsedSize.width * parsedAspect.height === parsedSize.height * parsedAspect.width;
}

function sizeMatchesResolution(size: string, resolution: string) {
  if (!size || !resolution) return true;
  const parsedSize = parseSize(size);
  const pixels = parseResolutionPixels(resolution);
  if (!parsedSize || !pixels) return true;
  return Math.min(parsedSize.width, parsedSize.height) === pixels;
}

function parseSize(size: string) {
  const match = size.toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseAspectRatio(aspectRatio: string) {
  const match = aspectRatio.match(/^(\d+):(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseResolutionPixels(resolution: string) {
  const normalized = resolution.toLowerCase();
  if (normalized === '4k') return 2160;
  const match = normalized.match(/^(\d+)p$/);
  return match ? Number(match[1]) : null;
}

function sizePixels(size: string) {
  const parsed = parseSize(size);
  return parsed ? parsed.width * parsed.height : 0;
}

function estimateVideoCost(model: VideoModel | undefined, form: GenerateForm): CostEstimate {
  const pricing = normalizePricingEntries(model?.pricing_skus || model?.pricing);

  if (!model) {
    return {
      confidence: 'unknown',
      reason: 'Select a model to see an estimate.',
      pricingEntries: []
    };
  }

  if (pricing.length === 0) {
    return {
      confidence: 'unknown',
      reason: 'This model did not include pricing metadata in the synced model list.',
      pricingEntries: []
    };
  }

  const duration = parsePositiveNumber(form.duration) || firstSupportedDuration(model) || 1;
  const selectedResolution = form.resolution.toLowerCase();
  const selectedSize = form.size.toLowerCase();
  const numericPricing = pricing.map(([sku, value]) => [sku, Number(value)] as [string, number]);
  const sortedPricing = [...numericPricing].sort((a, b) => specificityScore(b[0], form, selectedResolution, selectedSize) - specificityScore(a[0], form, selectedResolution, selectedSize));
  const match = sortedPricing.find(([sku]) => isSupportedPricingSku(sku));

  if (!match) {
    return {
      confidence: 'unknown',
      reason: 'Pricing metadata is present, but the app does not recognize these billing units yet.',
      pricingEntries: pricing
    };
  }

  const [sku, unitPrice] = match;
  const normalizedSku = sku.toLowerCase();
  const chargesPerSecond = normalizedSku.includes('second') || normalizedSku.includes('duration_seconds');
  const multiplier = chargesPerSecond ? duration : 1;
  const cost = unitPrice * multiplier;
  const exactResolutionMatch = Boolean(selectedResolution && normalizedSku.includes(selectedResolution));
  const exactSizeMatch = Boolean(selectedSize && normalizedSku.includes(selectedSize));
  const modeMatch = skuMatchesMode(normalizedSku, form.mode);
  const audioMatch = skuMatchesAudio(normalizedSku, form.generateAudio);
  const unsupportedResolution = Boolean(selectedResolution && model.supported_resolutions?.length && !model.supported_resolutions.map((item) => item.toLowerCase()).includes(selectedResolution));

  return {
    cost,
    sku,
    unitPrice,
    multiplier,
    confidence: unsupportedResolution || !modeMatch || !audioMatch
      ? 'medium'
      : exactResolutionMatch || exactSizeMatch || !selectedResolution && !selectedSize
        ? 'high'
        : 'medium',
    reason: chargesPerSecond
      ? buildEstimateReason(unitPrice, multiplier, unsupportedResolution, selectedResolution)
      : `Estimated from a flat ${formatCost(unitPrice)} per video.`,
    pricingEntries: pricing
  };
}

function normalizePricingEntries(pricing: Record<string, unknown> | undefined): Array<[string, string]> {
  if (!pricing) return [];
  return Object.entries(pricing)
    .map(([key, value]) => [key, String(value)] as [string, string])
    .filter(([, value]) => Number.isFinite(Number(value)));
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function firstSupportedDuration(model: VideoModel) {
  const durations = model.supported_durations || [];
  return durations.find((duration) => Number.isFinite(duration) && duration > 0);
}

function isSupportedPricingSku(sku: string) {
  const normalized = sku.toLowerCase();
  return normalized.includes('per-video-second')
    || normalized.includes('duration_seconds')
    || normalized === 'per-video'
    || normalized.includes('per-video');
}

function specificityScore(sku: string, form: GenerateForm, selectedResolution: string, selectedSize: string) {
  const normalized = sku.toLowerCase();
  let score = 0;
  if (selectedSize && normalized.includes(selectedSize)) score += 100;
  if (selectedResolution && normalized.includes(selectedResolution)) score += 90;
  if (skuMatchesAudio(normalized, form.generateAudio)) score += 80;
  if (skuMatchesMode(normalized, form.mode)) score += 40;
  if (normalized.includes('second') || normalized.includes('duration_seconds')) score += 10;
  if (normalized === 'per-video') score += 5;
  return score;
}

function skuMatchesAudio(normalizedSku: string, generateAudio: boolean) {
  if (generateAudio) return normalizedSku.includes('with_audio') || !normalizedSku.includes('without_audio');
  return normalizedSku.includes('without_audio') || !normalizedSku.includes('with_audio');
}

function skuMatchesMode(normalizedSku: string, mode: GenerateForm['mode']) {
  if (mode === 'text') return normalizedSku.includes('text_to_video') || !normalizedSku.includes('image_to_video');
  if (mode === 'image' || mode === 'start_end') return normalizedSku.includes('image_to_video') || !normalizedSku.includes('text_to_video');
  return true;
}

function buildEstimateReason(unitPrice: number, multiplier: number, unsupportedResolution: boolean, selectedResolution: string) {
  const base = `Estimated from ${formatCost(unitPrice)} per video second for ${formatNumber(multiplier)} second${multiplier === 1 ? '' : 's'}.`;
  if (!unsupportedResolution) return base;
  return `${base} ${selectedResolution} is not listed as a supported resolution for this model, so the closest general pricing SKU was used.`;
}

function titleForTab(tab: Tab) {
  return {
    generate: 'Generate',
    jobs: 'Jobs',
    gallery: 'Gallery',
    models: 'Models',
    settings: 'Settings'
  }[tab];
}

function subtitleForTab(tab: Tab) {
  return {
    generate: 'Prompt, upload frames, and submit OpenRouter video jobs.',
    jobs: 'Track async jobs, poll status, save outputs, and reuse settings.',
    gallery: 'Preview local outputs and compare completed generations.',
    models: 'Browse current OpenRouter video model capabilities.',
    settings: 'Store local settings for this machine.'
  }[tab];
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
