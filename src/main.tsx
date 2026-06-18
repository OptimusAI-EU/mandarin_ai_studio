import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  Download, Film, Image, KeyRound, LayoutGrid, Mic, MicOff, Paperclip, Play,
  RefreshCcw, Send, Settings, Upload, Volume2, Wand2, Box, X, Copy, Code,
  FileText, ExternalLink, Link, Loader2, MessageSquare, Search, ChevronDown,
  Save, Eye, Plus, Trash2, Square, RotateCcw, Check
} from 'lucide-react';
import './styles.css';

type Modality = 'text' | 'image' | 'video' | 'audio' | '3d' | 'all';
const MOD_ICONS: Record<string, React.ComponentType<any>> = { text: FileText, image: Image, video: Film, audio: Volume2, '3d': Box };
const MOD_LABELS: Record<string, string> = { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio', '3d': '3D' };
const ALL_CATS = [
  { key: 'all', label: 'All Modalities' },
  { key: 'text', label: 'Text / Multimodal' },
  { key: 'image', label: 'Image' },
  { key: 'video', label: 'Video' },
  { key: 'audio', label: 'Audio' },
  { key: '3d', label: '3D' },
  { key: 'others', label: 'Others' },
];

type Model = {
  id: string; name?: string; description?: string; modality?: string;
  context_length?: number; input_modalities?: string[]; output_modalities?: string[];
  pricing?: Record<string, string>;
};

type ChatMsg = { id: string; role: string; content: string; images?: string[]; attachments?: any[]; timestamp: string; };

type Session = {
  id: string; modality: string; title: string; model: string;
  messages: ChatMsg[]; created_at: string; updated_at: string;
};

type Artifact = {
  id: string; session_id?: string; job_id?: string; type: string;
  name: string; description?: string; local_path?: string;
  content_type?: string; data?: any; created_at: string;
};

type AttachType = { id: string; name: string; mime_type: string; dataUrl?: string; };

const api = {
  async request<T>(url: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(body?.error || 'Request failed: ' + res.status);
    return body as T;
  }
};

function getErr(e: unknown) { return e instanceof Error ? e.message : 'Unexpected error'; }
function fmtTime(s: string) { try { return new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function fmtDate(s: string) { try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } }
function fmtCtx(n: number | undefined) { if (!n) return ''; if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'; if (n >= 1000) return (n / 1000).toFixed(0) + 'K'; return String(n); }

function fmtPrice(pricing: Record<string, string> | undefined) {
  if (!pricing) return 'N/A';
  const p = parseFloat(pricing.prompt || pricing.input || '0');
  const c = parseFloat(pricing.completion || pricing.output || '0');
  if (isNaN(p) && isNaN(c)) return 'N/A';
  if (p === 0 && c === 0) return 'Free';
  const pStr = p > 0 ? '$' + (p * 1000000).toFixed(2) + '/1M in' : 'Free in';
  const cStr = c > 0 ? ' / $' + (c * 1000000).toFixed(2) + '/1M out' : ' / Free out';
  return pStr + cStr;
}

function modelUrl(id: string) { return 'https://openrouter.ai/models/' + id; }

// ============================================
// App Component with per-modality chat state preserved via refs
// ============================================

function App() {
  const [tab, setTab] = React.useState<any>('chat');
  const [settings, setSettings] = React.useState<any>(null);
  const [models, setModels] = React.useState<Model[]>([]);
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [artifacts, setArtifacts] = React.useState<Artifact[]>([]);

  // Per-modality chat state preserved in refs so switching tabs doesn't lose conversations
  const [, forceRender] = React.useReducer(x => x + 1, 0);
  const chatRef = React.useRef<Record<string, {
    selectedModel: string; prompt: string; attachments: AttachType[];
    chatMsgs: ChatMsg[]; currentSession: Session | null; previewContent: any;
    showModelPicker: boolean; modelSearch: string; showAttachMenu: boolean;
    showUrlInput: boolean; urlInput: string; isRecording: boolean; busy: boolean; message: string;
  }>>({});

  const getChat = (mod: string) => {
    if (!chatRef.current[mod]) chatRef.current[mod] = {
      selectedModel: '', prompt: '', attachments: [], chatMsgs: [], currentSession: null,
      previewContent: null, showModelPicker: false, modelSearch: '', showAttachMenu: false,
      showUrlInput: false, urlInput: '', isRecording: false, busy: false, message: ''
    };
    return chatRef.current[mod];
  };

  const [modality, setModality] = React.useState<Modality>('text');
  const [modelsFilter, setModelsFilter] = React.useState('all');
  const [modelsSearch, setModelsSearch] = React.useState('');
  const [modelModal, setModelModal] = React.useState<Model | null>(null);
  const [sessionsSearch, setSessionsSearch] = React.useState('');
  const [showSettingsLocal, setShowSettingsLocal] = React.useState<any>(
    { apiKey: '', outputDir: '', pollIntervalSeconds: 15, timeoutMinutes: 30, requireExpensiveConfirmation: true, hasApiKey: false, ollamaBaseUrl: 'http://localhost:11434' }
  );
  const [testing, setTesting] = React.useState(false);
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Active chat state
  const ch = getChat(modality);
  const selectedModel = ch.selectedModel;
  const prompt = ch.prompt;
  const attachments = ch.attachments;
  const chatMsgs = ch.chatMsgs;
  const currentSession = ch.currentSession;

  // Update helper
  const upd = (updates: Partial<typeof ch>) => { Object.assign(getChat(modality), updates); forceRender(); };

  // Close pickers on outside click
  React.useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.model-picker-wrap') && !t.closest('.model-selector-btn')) upd({ showModelPicker: false });
      if (!t.closest('.attach-wrap') && !t.closest('.attach-btn')) upd({ showAttachMenu: false });
    };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, [modality]);

  React.useEffect(() => { void loadAll(); }, []);
  React.useEffect(() => { if (settings) setShowSettingsLocal({ ...settings }); }, [settings]);
  React.useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

  // Paste image handler
  const handlePaste = React.useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) void handleUploadFile(f);
      }
    }
  }, [modality, attachments]);

  React.useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // ==================== API Functions ====================

  async function loadAll() {
    for (let i = 0; i < 10; i++) {
      try {
        const [s, m, sess, art] = await Promise.all([
          api.request<any>('/api/settings'),
          api.request<any>('/api/models'),
          api.request<any>('/api/sessions?modality=all'),
          api.request<any>('/api/artifacts'),
        ]);
        setSettings(s); setModels(m.data); setSessions(sess.data); setArtifacts(art.data);
        // Set default model for each modality
        for (const mod of ['text', 'image', 'video', 'audio'] as Modality[]) {
          const modModels = m.data.filter((md: Model) => md.modality === mod);
          if (modModels.length > 0 && !getChat(mod).selectedModel) {
            getChat(mod).selectedModel = modModels[0].id;
          }
        }
        forceRender();
        return;
      } catch { if (i < 9) await new Promise(r => setTimeout(r, 1000)); }
    }
  }

  async function syncModels() {
    upd({ busy: true, message: 'Syncing all models...' });
    try {
      const r = await api.request<any>('/api/models/sync', { method: 'POST', body: '{}' });
      setModels(r.data);
      for (const mod of ['text', 'image', 'video', 'audio'] as Modality[]) {
        const modModels = r.data.filter((md: Model) => md.modality === mod);
        if (modModels.length > 0 && !getChat(mod).selectedModel) getChat(mod).selectedModel = modModels[0].id;
      }
      upd({ message: 'Synced ' + r.data.length + ' models.' });
    } catch (e) { upd({ message: getErr(e) }); } finally { upd({ busy: false }); }
  }

  function handleSelectModel(m: Model) {
    upd({ selectedModel: m.id, showModelPicker: false });
    setModelModal(null);
  }

  async function handleNewSession() {
    try {
      const s = await api.request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ modality, model: selectedModel || 'openrouter/auto', title: 'New Chat' }) });
      setSessions(prev => [s, ...prev]);
      upd({ currentSession: s, chatMsgs: s.messages, previewContent: null });
    } catch (e) { upd({ message: getErr(e) }); }
  }

  async function handleOpenSession(sess: Session) {
    try {
      const fresh = await api.request<Session>('/api/sessions/' + sess.id);
      setModality(fresh.modality as Modality);
      upd({ currentSession: fresh, chatMsgs: fresh.messages, selectedModel: fresh.model, previewContent: null });
    } catch (e) { upd({ message: getErr(e) }); }
  }

  async function handleDeleteSession(id: string) {
    try {
      await api.request('/api/sessions/' + id, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (getChat(modality).currentSession?.id === id) upd({ currentSession: null, chatMsgs: [] });
    } catch (e) { upd({ message: getErr(e) }); }
  }

  async function handleSend() {
    const curPrompt = getChat(modality).prompt;
    const curAtt = getChat(modality).attachments;
    if (!curPrompt.trim() && curAtt.length === 0) return;
    if (!getChat(modality).selectedModel) { upd({ message: 'Select a model first.' }); return; }

    let session = getChat(modality).currentSession;
    if (!session) {
      try {
        session = await api.request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ modality, model: getChat(modality).selectedModel, title: curPrompt.slice(0, 50) }) });
        setSessions(prev => [session!, ...prev]);
        upd({ currentSession: session });
      } catch (e) { upd({ message: getErr(e) }); return; }
    }

    const userMsg: ChatMsg = { id: 'msg_' + Date.now(), role: 'user', content: curPrompt, timestamp: new Date().toISOString() };
    if (curAtt.length > 0) {
      userMsg.images = curAtt.map(a => a.dataUrl || '/api/assets/' + a.id + '/content');
      userMsg.attachments = curAtt.map(a => ({ name: a.name, type: a.mime_type }));
    }
    upd({ chatMsgs: [...getChat(modality).chatMsgs, userMsg], prompt: '', attachments: [], busy: true });

    try {
      const body: any = { model: getChat(modality).selectedModel, prompt: curPrompt, session_id: session.id };
      if (curAtt.length > 0) body.images = curAtt;
      await api.request<any>('/api/generate/' + modality, { method: 'POST', body: JSON.stringify(body) });
      const updated = await api.request<Session>('/api/sessions/' + session.id);
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
      upd({ currentSession: updated, chatMsgs: updated.messages });
      if (modality === 'image') upd({ previewContent: { type: 'image', url: '/api/sessions/' + session.id + '/last-image' } });
      const artR = await api.request<any>('/api/artifacts'); setArtifacts(artR.data);
      upd({ message: 'Done.' });
    } catch (e) {
      upd({ message: getErr(e), chatMsgs: [...getChat(modality).chatMsgs, { id: 'err_' + Date.now(), role: 'assistant', content: 'Error: ' + getErr(e), timestamp: new Date().toISOString() }] });
    } finally { upd({ busy: false }); }
  }

  function handleRegenerate() {
    const msgs = getChat(modality).chatMsgs;
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'user') { lastUserIdx = i; break; } }
    if (lastUserIdx < 0) return;
    const userMsg = msgs[lastUserIdx];
    upd({ chatMsgs: msgs.slice(0, lastUserIdx + 1), prompt: userMsg.content });
    setTimeout(() => void handleSend(), 100);
  }

  async function handleUploadFile(file: File) {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => String(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file);
      });
      const asset = await api.request<any>('/api/assets/upload', { method: 'POST', body: JSON.stringify({ kind: 'input', name: file.name, mimeType: file.type, dataUrl }) });
      upd({ attachments: [...getChat(modality).attachments, { ...asset, dataUrl }], message: 'Attached: ' + file.name });
    } catch (e) { upd({ message: getErr(e) }); }
  }

  function handleAttachUrl() {
    const url = getChat(modality).urlInput;
    if (url.trim()) {
      upd({ attachments: [...getChat(modality).attachments, { id: 'url_' + Date.now(), name: url.trim(), mime_type: 'text/uri-list', dataUrl: url.trim() }], message: 'Attached URL', urlInput: '', showUrlInput: false });
    }
  }

  // ==================== Render Functions ====================

  const modelsForModality = React.useMemo(() => {
    let list = models.filter(m => m.modality === modality);
    const ms = getChat(modality).modelSearch;
    if (ms) { const q = ms.toLowerCase(); list = list.filter(m => (m.id + ' ' + (m.name || '') + ' ' + (m.description || '')).toLowerCase().includes(q)); }
    return list;
  }, [models, modality, getChat(modality).modelSearch]);

  const sessionsForModality = React.useMemo(() => {
    let list = sessions.filter(s => s.modality === modality);
    if (sessionsSearch) { const q = sessionsSearch.toLowerCase(); list = list.filter(s => (s.title + ' ' + s.model).toLowerCase().includes(q)); }
    return list;
  }, [sessions, modality, sessionsSearch]);

  function renderChat() {
    const ch = getChat(modality);
    return (
      <div className='unified-layout'>
        <div className='chat-main'>
          <div className='modality-bar'>
            {(['text', 'image', 'video', 'audio', '3d'] as Modality[]).map(m => {
              const Icon = MOD_ICONS[m];
              return <button key={m} className={'modality-btn' + (modality === m ? ' active' : '')} onClick={() => setModality(m)}><Icon size={16} /><span>{MOD_LABELS[m]}</span></button>;
            })}
            <div className='modality-spacer' />
            <button className='new-session-btn' onClick={handleNewSession} title='New Session'><Plus size={16} /> New Chat</button>
          </div>

          <div className='chat-area'>
            {ch.chatMsgs.filter(m => m.role !== 'system').length === 0 && (
              <div className='chat-welcome'><h1>Mandarin AI Studio</h1><p>Select a model and start creating.</p></div>
            )}
            <div className='chat-messages'>
              {ch.chatMsgs.filter(m => m.role !== 'system').map((msg, idx) => {
                const isLast = idx === ch.chatMsgs.filter(m => m.role !== 'system').length - 1;
                return (
                  <div key={msg.id} className={'chat-msg ' + msg.role}>
                    <div className='bubble'>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className='msg-attachments'>
                          {msg.attachments.map((att: any, i: number) => (
                            <span key={i} className='attachment-chip'>
                              {att.type?.startsWith('image/') ? <Image size={12} /> : att.type?.startsWith('audio/') ? <Volume2 size={12} /> : att.type?.startsWith('video/') ? <Film size={12} /> : <FileText size={12} />}{att.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {msg.images && msg.images.length > 0 && <div className='chat-imgs'>{msg.images.map((s, i) => <img key={i} src={s} alt='' />)}</div>}
                      {msg.content && <p>{msg.content}</p>}
                      <span className='time'>{fmtTime(msg.timestamp)}</span>
                      {msg.role === 'assistant' && isLast && !ch.busy && (
                        <div className='msg-actions'>
                          <button className='icon-btn sm' onClick={handleRegenerate} title='Regenerate'><RotateCcw size={12} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {ch.busy && <div className='chat-msg assistant'><div className='bubble typing'><span className='d' /><span className='d' /><span className='d' /></div></div>}
              <div ref={chatEndRef} />
            </div>
          </div>

          <div className='chat-input-area'>
            {ch.message && <div className='msg-bar'>{ch.message}</div>}
            {ch.showUrlInput && (
              <div className='url-row'>
                <input value={ch.urlInput} onChange={e => upd({ urlInput: e.target.value })} placeholder='https://...' onKeyDown={e => { if (e.key === 'Enter') handleAttachUrl(); }} />
                <button className='primary sm' onClick={handleAttachUrl}>Add</button>
                <button className='secondary sm' onClick={() => upd({ showUrlInput: false })}>Cancel</button>
              </div>
            )}
            {ch.attachments.length > 0 && (
              <div className='att-preview'>
                {ch.attachments.map(att => (
                  <div key={att.id} className='att-thumb'>
                    {att.mime_type.startsWith('image/') ? <img src={att.dataUrl} alt={att.name} /> : <div className='att-file-icon'><FileText size={20} /></div>}
                    <span className='att-name'>{att.name}</span>
                    <button onClick={() => upd({ attachments: getChat(modality).attachments.filter(x => x.id !== att.id) })}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className='input-row'>
              <div className='model-selector-btn' onClick={e => { e.stopPropagation(); upd({ showModelPicker: !getChat(modality).showModelPicker }); }}>
                <LayoutGrid size={14} /><span>{ch.selectedModel || 'Select model'}</span><ChevronDown size={14} />
              </div>
            </div>
            {ch.showModelPicker && (
              <div className='model-picker-wrap'>
                <div className='model-picker'>
                  <div className='mp-search'><Search size={14} /><input value={ch.modelSearch} onChange={e => upd({ modelSearch: e.target.value })} placeholder={'Search ' + MOD_LABELS[modality] + ' models...'} /></div>
                  <div className='mp-list'>
                    {modelsForModality.map(m => (
                      <button key={m.id} className={'mp-item' + (ch.selectedModel === m.id ? ' sel' : '')} onClick={e => { e.stopPropagation(); handleSelectModel(m); }}>
                        <span className='mp-name'>{m.name || m.id}</span><code>{m.id}</code>
                        {m.context_length && <small>ctx: {fmtCtx(m.context_length)}</small>}
                      </button>
                    ))}
                    {modelsForModality.length === 0 && <div className='mp-empty'>No models for this modality. Sync from Models page.</div>}
                  </div>
                </div>
              </div>
            )}
            <div className='chat-input-row'>
              <div className='attach-wrap'>
                <button className='icon-btn attach-btn' onClick={e => { e.stopPropagation(); upd({ showAttachMenu: !getChat(modality).showAttachMenu }); }} title='Attach'><Paperclip size={18} /></button>
                {ch.showAttachMenu && (
                  <div className='attach-menu'>
                    <button onClick={() => { fileRef.current?.click(); upd({ showAttachMenu: false }); }}><Upload size={14} /><span>Upload File / Image</span></button>
                    <button onClick={() => { upd({ showUrlInput: true, showAttachMenu: false }); }}><Link size={14} /><span>Attach URL</span></button>
                  </div>
                )}
              </div>
              <input ref={fileRef} type='file' multiple accept='image/*,audio/*,video/*,text/*,.pdf,.py,.js,.ts,.json,.md,.txt,.html,.css' style={{ display: 'none' }}
                onChange={e => { if (e.target.files) { for (let i = 0; i < e.target.files.length; i++) void handleUploadFile(e.target.files[i]); } e.target.value = ''; }} />
              <textarea className='chat-input' value={ch.prompt} onChange={e => upd({ prompt: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }} placeholder={'Message ' + (ch.selectedModel || '...')} rows={1} />
              <button className={'icon-btn mic' + (ch.isRecording ? ' rec' : '')} onClick={() => upd({ isRecording: !getChat(modality).isRecording })} title='Voice'>{ch.isRecording ? <MicOff size={18} /> : <Mic size={18} />}</button>
              {ch.busy ? (
                <>
                  <button className='icon-btn' onClick={() => upd({ busy: false })} title='Stop'><Square size={16} /></button>
                  <button className='icon-btn' disabled><Loader2 size={18} className='spin' /></button>
                </>
              ) : (
                <button className='icon-btn send' onClick={handleSend} disabled={!ch.prompt.trim() && ch.attachments.length === 0} title='Send'><Send size={18} /></button>
              )}
            </div>
          </div>
        </div>

        <div className='preview-panel'>
          <div className='preview-header'><Eye size={14} /><span>Preview</span></div>
          <div className='preview-body'>
            {!ch.previewContent && <div className='preview-empty'><Eye size={40} /><p>Artifacts appear here</p></div>}
            {ch.previewContent?.type === 'image' && <img src={ch.previewContent.url} alt='Preview' className='preview-img' />}
            {ch.previewContent?.type === 'video' && <video src={ch.previewContent.url} controls className='preview-video' />}
            {ch.previewContent?.type === 'audio' && <div className='preview-audio'><Volume2 size={32} /><audio src={ch.previewContent.url} controls /></div>}
          </div>
        </div>
      </div>
    );
  }

  function renderArtifacts() {
    return (
      <div className='page'>
        <div className='page-header'><div><h1>Artifacts</h1><p>{artifacts.length} generated assets</p></div></div>
        {artifacts.length === 0 && <Empty icon={<Eye size={28} />} title='No artifacts' text='Generated images, videos, and files appear here.' />}
        <div className='artifact-grid'>
          {artifacts.map(art => (
            <div key={art.id} className='artifact-card'>
              <div className='artifact-thumb'>
                {art.type === 'image' && art.local_path ? <img src={'/api/artifacts/' + art.id + '/content'} alt='' /> :
                 art.type === 'video' ? <Film size={32} /> :
                 art.type === 'audio' ? <Volume2 size={32} /> :
                 <FileText size={32} />}
              </div>
              <div className='artifact-info'><strong>{art.name}</strong><span>{art.type} * {fmtDate(art.created_at)}</span>{art.description && <p>{art.description.slice(0, 80)}</p>}</div>
              <div className='artifact-actions'>
                <button className='secondary sm' onClick={() => window.open(art.local_path ? '/api/artifacts/' + art.id + '/content' : '#', '_blank')}><Download size={14} /> Save</button>
                <button className='secondary sm' onClick={async () => { await api.request('/api/artifacts/' + art.id, { method: 'DELETE' }); setArtifacts(p => p.filter(a => a.id !== art.id)); }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderSessions() {
    return (
      <div className='page'>
        <div className='page-header'><div><h1>Sessions</h1><p>{sessionsForModality.length} {MOD_LABELS[modality]} sessions</p></div></div>
        <div className='toolbar'><div className='search'><SearchIcon size={14} /><input value={sessionsSearch} onChange={e => setSessionsSearch(e.target.value)} placeholder='Search sessions...' /></div></div>
        {sessionsForModality.length === 0 && <Empty icon={<Play size={28} />} title='No sessions' text='Start a chat to create sessions.' />}
        <div className='session-group'>
          {sessionsForModality.map(sess => (
            <div key={sess.id} className='session-card' onClick={() => handleOpenSession(sess)}>
              <div className='session-icon'>{React.createElement(MOD_ICONS[sess.modality] || MessageSquare, { size: 18 })}</div>
              <div className='session-info'><strong>{sess.title}</strong><span>{sess.model} * {fmtDate(sess.created_at)}</span></div>
              <div className='session-actions'><button className='secondary sm' onClick={e => { e.stopPropagation(); void handleDeleteSession(sess.id); }}><Trash2 size={12} /></button></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderModels() {
    let filtered = modelsFilter === 'all' ? models : models.filter(m => m.modality === modelsFilter);
    if (modelsSearch) { const q = modelsSearch.toLowerCase(); filtered = filtered.filter(m => (m.id + ' ' + (m.name || '') + ' ' + (m.description || '')).toLowerCase().includes(q)); }
    const grouped: Record<string, Model[]> = {};
    for (const m of filtered) { const mod = m.modality || 'others'; if (!grouped[mod]) grouped[mod] = []; grouped[mod].push(m); }
    return (
      <div className='page'>
        <div className='page-header'>
          <div><h1>Models</h1><p>{models.length} models from OpenRouter</p></div>
          <button className='primary' onClick={syncModels} disabled={getChat(modality).busy}>{getChat(modality).busy ? <><Loader2 size={14} className='spin' /> Syncing...</> : <><RefreshCcw size={14} /> Sync All</>}</button>
        </div>
        <div className='models-search-bar'>
          <SearchIcon size={18} />
          <input value={modelsSearch} onChange={e => setModelsSearch(e.target.value)} placeholder='Search models by name, id, or description...' />
        </div>
        <div className='toolbar'>
          <select value={modelsFilter} onChange={e => setModelsFilter(e.target.value)}>{ALL_CATS.map(c => <option key={c.key} value={c.key}>{c.label}{c.key !== 'all' ? ' (' + (grouped[c.key]?.length || 0) + ')' : ''}</option>)}</select>
        </div>
        {Object.keys(grouped).length === 0 && <Empty icon={<LayoutGrid size={28} />} title='No models' text='Click Sync All to fetch models.' />}
        {Object.entries(grouped).sort().map(([mod, items]) => (
          <div key={mod} className='model-group'>
            <h3 className='model-group-title'>{MOD_ICONS[mod] ? React.createElement(MOD_ICONS[mod], { size: 16 }) : null}<span>{ALL_CATS.find(c => c.key === mod)?.label || mod} ({items.length})</span></h3>
            <div className='model-grid'>
              {items.map(m => (
                <div key={m.id + '-' + (m.modality || '')} className='model-card' onClick={() => setModelModal(m)}>
                  <div className='model-card-top'><h4>{m.name || m.id}</h4><a href={modelUrl(m.id)} target='_blank' rel='noopener noreferrer' onClick={e => e.stopPropagation()} title='OpenRouter'><ExternalLink size={12} /></a></div>
                  <code>{m.id}</code>
                  <div className='model-meta'>
                    {m.context_length && <span className='tag'>ctx: {fmtCtx(m.context_length)}</span>}
                    <span className='tag'>{fmtPrice(m.pricing)}</span>
                    {m.input_modalities?.map((im: string) => <span key={im} className='tag in'>{im}</span>)}
                    {m.output_modalities?.map((om: string) => <span key={om} className='tag out'>{om}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderSettings() {
    if (!showSettingsLocal) return null;
    return (
      <div className='page'>
        <div className='page-header'><div><h1>Settings</h1><p>Configure API keys and preferences</p></div></div>
        <div className='settings-grid'>
          <div className='panel'>
            <h2>OpenRouter</h2>
            <label>API key <input type='password' value={showSettingsLocal.apiKey} onChange={e => setShowSettingsLocal({ ...showSettingsLocal, apiKey: e.target.value })} placeholder='sk-or-v1-...' /></label>
            <p className='note'>Saved to .env file.</p>
            <div className='actions'>
              <button className='primary' onClick={saveSettings}><KeyRound size={14} /> Save</button>
              <button className='secondary' onClick={testKey} disabled={testing}>{testing ? <><Loader2 size={14} className='spin' /> Testing...</> : <><RefreshCcw size={14} /> Test</>}</button>
              <button className='secondary' onClick={() => setShowSettingsLocal({ ...showSettingsLocal, apiKey: '' })}>Clear</button>
            </div>
          </div>
          <div className='panel'>
            <h2>Local</h2>
            <label>Output directory <input value={showSettingsLocal.outputDir} onChange={e => setShowSettingsLocal({ ...showSettingsLocal, outputDir: e.target.value })} /></label>
            <div className='field-grid'>
              <label>Poll interval <input type='number' min='10' value={showSettingsLocal.pollIntervalSeconds} onChange={e => setShowSettingsLocal({ ...showSettingsLocal, pollIntervalSeconds: Number(e.target.value) })} /></label>
              <label>Timeout (min) <input type='number' min='5' value={showSettingsLocal.timeoutMinutes} onChange={e => setShowSettingsLocal({ ...showSettingsLocal, timeoutMinutes: Number(e.target.value) })} /></label>
            </div>
            <label className='toggle'><input type='checkbox' checked={showSettingsLocal.requireExpensiveConfirmation} onChange={e => setShowSettingsLocal({ ...showSettingsLocal, requireExpensiveConfirmation: e.target.checked })} /> Confirm expensive generations</label>
          </div>
          <div className='panel'>
            <h2>Ollama</h2>
            <label>Base URL <input value={showSettingsLocal.ollamaBaseUrl} onChange={e => setShowSettingsLocal({ ...showSettingsLocal, ollamaBaseUrl: e.target.value })} placeholder='http://localhost:11434' /></label>
          </div>
        </div>
      </div>
    );
  }

  async function saveSettings() {
    if (!showSettingsLocal) return;
    try {
      const u = await api.request<any>('/api/settings', { method: 'PATCH', body: JSON.stringify(showSettingsLocal) });
      setSettings(u);
      upd({ message: 'Settings saved.' });
    } catch (e) { upd({ message: getErr(e) }); }
  }

  async function testKey() {
    setTesting(true);
    upd({ message: 'Testing...' });
    try {
      const r = await api.request<any>('/api/settings/test', { method: 'POST', body: JSON.stringify({ apiKey: showSettingsLocal?.apiKey }) });
      upd({ message: r.ok ? 'Success! ' + r.count + ' models.' : 'Failed: ' + (r.error || 'Unknown') });
    } catch (e) { upd({ message: 'Test failed: ' + getErr(e) }); }
    finally { setTesting(false); }
  }

  // ==================== Main Render ====================

  return (
    <div className='app'>
      <aside className='sidebar'>
        <div className='brand'><Wand2 size={22} /><div><strong>Mandarin AI Studio</strong><span>AI Creative Suite</span></div></div>
        <nav>
          <SBtn icon={<MessageSquare size={18} />} label='Create' active={tab === 'chat'} onClick={() => setTab('chat')} />
          <SBtn icon={<Eye size={18} />} label='Artifacts' active={tab === 'artifacts'} onClick={() => { setTab('artifacts'); void loadAll(); }} />
          <SBtn icon={<Play size={18} />} label='Sessions' active={tab === 'sessions'} onClick={() => { setTab('sessions'); void loadAll(); }} />
          <SBtn icon={<LayoutGrid size={18} />} label='Models' active={tab === 'models'} onClick={() => setTab('models')} />
          <SBtn icon={<Settings size={18} />} label='Settings' active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>
        <div className='sidebar-status'><span className={settings?.hasApiKey ? 'dot ok' : 'dot'} />{settings?.hasApiKey ? 'API key saved' : 'API key missing'}</div>
      </aside>

      <main className='content'>
        {tab === 'chat' && renderChat()}
        {tab === 'artifacts' && renderArtifacts()}
        {tab === 'sessions' && renderSessions()}
        {tab === 'models' && renderModels()}
        {tab === 'settings' && renderSettings()}
      </main>

      {modelModal && (
        <div className='modal-overlay' onClick={() => setModelModal(null)}>
          <div className='modal' onClick={e => e.stopPropagation()}>
            <div className='modal-header'><h3>{modelModal.name || modelModal.id}</h3><button className='icon-btn' onClick={() => setModelModal(null)}><X size={18} /></button></div>
            <div className='modal-body'>
              <code className='modal-id'>{modelModal.id}</code>
              {modelModal.description && <p className='modal-desc'>{modelModal.description}</p>}
              <div className='modal-meta'>
                {modelModal.context_length && <span className='tag'>Context: {fmtCtx(modelModal.context_length)}</span>}
                <span className='tag'>{fmtPrice(modelModal.pricing)}</span>
                {modelModal.input_modalities?.map((m: string) => <span key={m} className='tag in'>{m}</span>)}
                {modelModal.output_modalities?.map((m: string) => <span key={m} className='tag out'>{m}</span>)}
              </div>
              <a href={modelUrl(modelModal.id)} target='_blank' rel='noopener noreferrer' className='modal-link'><ExternalLink size={14} /> View on OpenRouter</a>
            </div>
            <div className='modal-footer'>
              <button className='primary' onClick={() => handleSelectModel(modelModal)}><Check size={14} /> Select This Model</button>
              <button className='secondary' onClick={() => setModelModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className='empty-state'>{icon}<strong>{title}</strong><span>{text}</span></div>;
}

function SearchIcon({ size }: { size: number }) {
  return <svg xmlns='http://www.w3.org/2000/svg' width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='11' cy='11' r='8' /><path d='m21 21-4.3-4.3' /></svg>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
