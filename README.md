# Mandarin AI Studio

A local-first AI creative suite for generating and editing images, video, 3D, and audio through OpenRouter and Ollama.

## What Works

- Save an OpenRouter API key locally (stored in `.env` file).
- Sync all model metadata from OpenRouter, categorized by output modality (text, image, video, audio, 3D, others).
- **Text/Multimodal**: Chat with LLMs, code generation, translation, and text-based tasks.
- **Image**: Generate and edit images from text or image prompts.
- **Video**: Generate videos from text, images, or start/end frames.
- **Audio**: Text-to-speech, transcription, and voice cloning.
- **3D**: Generate 3D models and meshes (placeholder for future support).
- Per-modality chat sessions — conversations are preserved when switching between modules.
- Session management: create, browse, restore, and delete chat sessions.
- Artifact management: view, save, and delete generated assets (images, videos, audio, code).
- File, image, URL, and paste-to-attach support for conversation context.
- Regenerate responses and stop generation in progress.
- Search and filter models by modality and keyword.
- Persist sessions, jobs, artifacts, prompts, and settings in SQLite.
- Compare outputs across models.

## Modules

| Module | Capabilities |
|--------|-------------|
| **Text** | Chat, code generation, translation, multimodal (text+image) models |
| **Image** | Text-to-image, image-to-image, inpainting, upscaling |
| **Video** | Text-to-video, image-to-video, start/end frame interpolation |
| **Audio** | TTS, STT, voice cloning |
| **3D** | 3D model generation (coming soon) |

## Run Locally

```bash
npm install
npm run build
npm start
```

Open:

```text
http://127.0.0.1:4317
```

For development with Vite and the local API:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:5173
```

## Local Data

Runtime data is stored under `.ovstudio/`:

- `studio.sqlite` for settings, model cache, sessions, jobs, and assets
- `assets/` for uploaded files and images
- `outputs/` for generated media files
- `artifacts/` for generated assets linked to sessions

The app is designed for local use. Do not host it publicly with a saved API key.

## API Surface

The local backend exposes:

### Settings
- `GET /api/settings`
- `PATCH /api/settings`
- `POST /api/settings/test`

### Models
- `GET /api/models` — List all models
- `GET /api/models/:modality` — List models by modality
- `POST /api/models/sync` — Sync all models from OpenRouter

### Sessions
- `GET /api/sessions?modality=...` — List sessions
- `POST /api/sessions` — Create new session
- `GET /api/sessions/:id` — Get session with messages
- `DELETE /api/sessions/:id` — Delete session

### Generation
- `POST /api/generate/:modality` — Generate content (text/image/video/audio)

### Jobs
- `GET /api/jobs?modality=...&session_id=...` — List jobs
- `GET /api/jobs/:id` — Get job details
- `DELETE /api/jobs/:id` — Delete job
- `POST /api/jobs/:id/download` — Download job output
- `GET /api/jobs/:id/content` — Get job content

### Artifacts
- `GET /api/artifacts` — List all artifacts
- `GET /api/artifacts/:id` — Get artifact details
- `GET /api/artifacts/:id/content` — Get artifact file
- `DELETE /api/artifacts/:id` — Delete artifact

### Assets
- `POST /api/assets/upload` — Upload file/image
- `GET /api/assets/:id/content` — Get asset file

## Notes

Node 22's built-in SQLite module is used to avoid a native SQLite dependency. It may print an experimental warning depending on the installed Node build.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md). This app stores API keys locally and should not be hosted publicly with a saved key.

## License

MIT. See [LICENSE](LICENSE).
