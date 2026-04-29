# OpenRouter Video Studio MVP Spec

## 1. Project Summary

**OpenRouter Video Studio** is a local-first, open-source desktop/web studio for generating AI videos through OpenRouter's video generation API.

The goal is not to build a giant creative suite. The goal is to make the simplest trustworthy local tool for:

- browsing OpenRouter video models
- generating text-to-video
- generating image-to-video
- generating start/end-frame videos
- tracking async jobs
- saving outputs locally
- comparing model results
- iterating on prompts quickly

Positioning:

> A simple local studio for OpenRouter video models: prompt, upload frames, generate, compare, download.

## 2. Shrimp Verdict

**Shrimp-Yes. Build it.**

This is timely because OpenRouter's video API is new, the model lineup is already useful, and the surrounding tooling is immature. Existing open-source options are either too raw, too complex, or tied to other API gateways.

The product should win by being boring, local, transparent, and easy to trust.

## 3. Why This Idea

OpenRouter now exposes video models behind one API, including models like:

- `google/veo-3.1`
- `google/veo-3.1-fast`
- `google/veo-3.1-lite`
- `kwaivgi/kling-video-o1`
- `bytedance/seedance-2.0`
- `bytedance/seedance-2.0-fast`
- `bytedance/seedance-1-5-pro`
- `alibaba/wan-2.7`
- `alibaba/wan-2.6`
- `openai/sora-2-pro`
- `minimax/hailuo-2.3`

But creators and builders do not just need an API. They need a workflow:

- Which model supports which duration/resolution/aspect ratio?
- Which models support first-frame or last-frame image conditioning?
- What did I generate last time?
- Which prompt/model combo worked best?
- Can I retry the same idea across multiple models?
- Can I download and organize outputs locally?

That is the gap.

## 4. Product Principle

Keep it simple.

Do not build:

- accounts
- cloud hosting
- team workspaces
- a social feed
- a giant node canvas
- MCP-first agent integrations
- Postgres/Redis infrastructure
- multi-provider abstraction beyond OpenRouter

Build:

- a local studio
- clean model browsing
- generation modes
- job tracking
- local gallery
- prompt iteration
- comparison

## 5. Target User

Primary users:

- AI video experimenters
- YouTubers and short-form creators
- indie builders testing OpenRouter video models
- prompt engineers comparing models
- developers who want a local UI instead of writing scripts

Secondary users:

- people building AI media workflows
- educators/demo creators
- open-source contributors interested in OpenRouter tooling

## 6. Competitor / Adjacent Landscape

### OpenVideoUI

Repo: `Kxrbx/OpenVideoUI`

Pros:

- real OpenRouter API integration
- supports text/image/video
- has model sync, Postgres, Redis, worker, local asset storage
- builds and tests pass

Cons:

- too much infrastructure for a simple local tool
- Postgres + Redis + Docker assumptions
- huge frontend component
- local-first auth is not production auth
- BYOK and server-side worker design are awkward together

Use as reference, not as foundation.

### OpenRouter Studio

Repo: `doomL/OpenRouter-Studio`

Pros:

- visual node canvas
- ambitious workflow-builder direction
- OpenRouter-native concept

Cons:

- much heavier than needed
- accounts/auth/database/S3-style storage
- more like ComfyUI for OpenRouter than a simple video studio

Use as inspiration only.

### Open Generative AI

Repo: `Anil-matcha/Open-Generative-AI`

Pros:

- polished creative studio concept
- image/video/lip-sync UI
- model categories and galleries

Cons:

- Muapi-based, not OpenRouter-based
- would require API client rewrite
- broader scope than needed

Not the right base.

## 7. Core Product Concept

A local-first app with these main tabs:

1. **Generate**
2. **Jobs**
3. **Gallery**
4. **Models**
5. **Settings**

The user enters their OpenRouter key locally, picks a model, chooses a generation mode, submits a job, waits for polling, then previews/downloads the result.

## 8. MVP Scope

### 8.1 Settings

Required:

- OpenRouter API key input
- local key storage
- test key button
- clear key button
- choose local output directory

Nice-to-have:

- show OpenRouter account/balance if API supports it
- hide/reveal key toggle
- import/export settings

Security note:

- For MVP, local storage is acceptable if app is clearly local-only.
- If using browser localStorage, warn that this is not for public hosted use.
- If using Electron/Tauri, prefer OS keychain later.

### 8.2 Model Browser

Fetch models from:

```text
GET https://openrouter.ai/api/v1/videos/models
```

Display:

- model ID
- display name
- supported resolutions
- supported aspect ratios
- supported durations
- supported frame image types, e.g. `first_frame`, `last_frame`
- audio support
- pricing fields
- provider-specific passthrough parameters

Useful filters:

- text-to-video capable
- image-to-video capable
- supports first + last frame
- supports audio
- supports 1080p
- supports vertical 9:16
- provider/model search

### 8.3 Generation Modes

#### Mode A: Text to Video

Inputs:

- prompt
- model
- duration
- resolution
- aspect ratio
- generate audio toggle if supported
- optional negative prompt if model supports it

Payload shape:

```json
{
  "model": "google/veo-3.1",
  "prompt": "A cinematic shot of a golden retriever running across a beach at sunset.",
  "duration": 8,
  "resolution": "1080p",
  "aspect_ratio": "16:9",
  "generate_audio": true
}
```

#### Mode B: Image to Video

Inputs:

- first frame image upload
- prompt
- model
- duration
- resolution
- aspect ratio
- generate audio toggle if supported

Payload shape:

```json
{
  "model": "google/veo-3.1",
  "prompt": "The subject slowly turns toward the camera as the background comes alive.",
  "duration": 8,
  "resolution": "1080p",
  "aspect_ratio": "16:9",
  "frame_images": [
    {
      "type": "image_url",
      "frame_type": "first_frame",
      "image_url": {
        "url": "data:image/png;base64,..."
      }
    }
  ]
}
```

#### Mode C: Start + End Frame

Inputs:

- first frame image
- last frame image
- prompt
- model
- duration
- resolution
- aspect ratio

Only enable this mode if model metadata includes both:

```text
first_frame
last_frame
```

Payload shape:

```json
{
  "model": "kwaivgi/kling-video-o1",
  "prompt": "Smooth cinematic motion from the first image to the final image.",
  "duration": 5,
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "frame_images": [
    {
      "type": "image_url",
      "frame_type": "first_frame",
      "image_url": { "url": "data:image/png;base64,..." }
    },
    {
      "type": "image_url",
      "frame_type": "last_frame",
      "image_url": { "url": "data:image/png;base64,..." }
    }
  ]
}
```

### 8.4 Job Submission and Polling

Submit:

```text
POST https://openrouter.ai/api/v1/videos
```

Headers:

```text
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
X-OpenRouter-Title: OpenRouter Video Studio
HTTP-Referer: project URL if applicable
```

Expected response includes:

- job ID
- status
- polling URL, if provided

Poll:

```text
GET https://openrouter.ai/api/v1/videos/{jobId}
```

Download:

```text
GET https://openrouter.ai/api/v1/videos/{jobId}/content
```

Job statuses:

- `draft` local only
- `submitting`
- `queued`
- `processing`
- `completed`
- `failed`
- `timeout`

Polling behavior:

- poll every 10-20 seconds
- stop after configurable timeout, e.g. 30 minutes
- persist job state so reload does not lose jobs
- allow manual refresh
- allow retry/duplicate

### 8.5 Gallery

Each completed generation should show:

- video preview
- model
- prompt
- date/time
- duration/resolution/aspect
- source images if used
- status
- local file path
- download/open button
- duplicate job button
- copy prompt button

Gallery views:

- grid
- list
- by project/folder, optional
- filter by model
- filter by mode

### 8.6 Compare Outputs

MVP comparison feature:

- select 2-4 videos
- play side-by-side
- show prompt/model/settings below each

This is a killer feature because users will often test the same prompt across Veo, Kling, Seedance, Wan, etc.

## 9. Storage

For MVP, use one of:

### Option A: SQLite

Recommended.

Pros:

- structured
- easy history queries
- durable
- local-first
- no server required

Tables:

```sql
settings
models_cache
jobs
assets
projects
```

### Option B: JSON files

Acceptable for ultra-fast prototype.

Pros:

- simplest
- easy to inspect

Cons:

- annoying once history grows
- concurrency bugs easier

Recommendation:

> Use SQLite if using Electron/Tauri/local backend. Use JSON only for a throwaway prototype.

## 10. Suggested Tech Stack

### Fast MVP

```text
Vite + React + TypeScript
Node/Express local backend
SQLite
OpenRouter REST API
```

Pros:

- fast to build
- easy to open-source
- familiar web stack
- can become Electron/Tauri later

### Desktop MVP

```text
Tauri + React + TypeScript
SQLite
Rust/Node sidecar for filesystem/API calls
```

Pros:

- real desktop feel
- better local file handling
- easier OS-level polish later

Cons:

- more setup complexity

### Recommendation

Start with:

```text
Vite + React + local Node backend + SQLite
```

Then package later with Electron or Tauri if the tool proves useful.

## 11. Internal API Design

Even before MCP, expose a clean local backend API.

```text
GET    /api/settings
PATCH  /api/settings

GET    /api/models/video
POST   /api/models/sync

POST   /api/jobs
GET    /api/jobs
GET    /api/jobs/:id
POST   /api/jobs/:id/poll
POST   /api/jobs/:id/retry
POST   /api/jobs/:id/duplicate
DELETE /api/jobs/:id

GET    /api/gallery
GET    /api/assets/:id
POST   /api/assets/upload
```

This makes future CLI/MCP integration easy.

## 12. Future CLI

Before MCP, add a CLI wrapper:

```bash
ovstudio models
ovstudio generate --model google/veo-3.1 --prompt "..." --duration 8 --aspect 16:9
ovstudio jobs
ovstudio poll <job-id>
ovstudio open <job-id>
```

This gives Hermes/Claude Code basic automation without needing MCP immediately.

## 13. Future MCP Integration

Do not build MCP first. Add it after the studio works.

Potential MCP tools:

```text
video_studio_list_models
video_studio_generate_video
video_studio_get_job
video_studio_list_jobs
video_studio_download_result
video_studio_duplicate_job
video_studio_compare_jobs
```

Guardrails:

- max duration
- max resolution
- allowed models
- daily spend cap
- confirmation required for expensive models
- reject bulk jobs unless explicitly approved

## 14. Out of Scope for MVP

Do not build these initially:

- cloud accounts
- team collaboration
- public hosting
- Stripe/payment gating
- prompt marketplace
- social sharing feed
- giant node canvas
- arbitrary model/provider abstraction
- full media editing timeline
- MCP integration
- agent auto-generation loops
- mobile app

## 15. Risks and Mitigations

### Risk: OpenRouter video API changes

Mitigation:

- keep API client isolated in one module
- cache raw model metadata
- design model controls dynamically from capabilities

### Risk: Cost surprises

Mitigation:

- show estimated cost before generate when possible
- show duration/resolution/model pricing
- add optional local spend/session caps
- require confirmation for 4K/expensive models

### Risk: Public-hosting security issues

Mitigation:

- explicitly position as local-first
- do not ship public auth in MVP
- warn users not to deploy publicly with their key

### Risk: Scope creep

Mitigation:

- no node canvas
- no accounts
- no MCP until v2
- no cloud sync
- keep MVP to generation/history/comparison

### Risk: Image uploads are too big

Mitigation:

- resize/compress uploaded images before sending
- show dimensions/file size
- optionally auto-convert to JPEG/WebP
- cap upload size

## 16. Acceptance Criteria

MVP is done when:

- user can enter and save OpenRouter key locally
- app can fetch video models from OpenRouter
- model browser shows capabilities
- user can generate text-to-video
- user can upload first-frame image and generate image-to-video
- user can upload first + last frame if model supports it
- jobs persist across reloads
- app polls jobs until completion/failure
- completed videos can be previewed
- videos can be downloaded/saved locally
- prompt/model/settings are saved with each job
- user can duplicate a previous job
- user can compare at least two completed videos side-by-side

## 17. Implementation Plan

### Phase 1: Skeleton

- create Vite React TypeScript app
- create local Node backend
- setup SQLite
- settings page with API key
- OpenRouter client module

### Phase 2: Model Browser

- fetch `/videos/models`
- cache model metadata
- render model list
- filters by capability

### Phase 3: Generate Flow

- build generation form
- mode switching
- capability-aware controls
- image upload to data URL
- submit job

### Phase 4: Job System

- persist jobs in SQLite
- poll manually and automatically
- update job statuses
- download completed video

### Phase 5: Gallery

- preview videos
- show prompt/settings
- duplicate job
- download/open local file

### Phase 6: Compare

- select multiple videos
- side-by-side playback
- show metadata

### Phase 7: Polish

- cost estimate display
- error handling
- model presets
- README
- screenshots/demo video
- release binary, optional

## 18. Suggested Repository Name

Options:

- `openrouter-video-studio`
- `or-video-studio`
- `routercut`
- `videorouter-studio`
- `local-video-router`

Recommendation:

```text
openrouter-video-studio
```

Boring name, obvious SEO, good for GitHub search.

## 19. Handoff Prompt for Claude Code / Codex

Use this prompt to start implementation:

```text
Build an open-source local-first app called OpenRouter Video Studio.

Goal: a simple local studio for OpenRouter video generation models. Do not build accounts, cloud hosting, MCP, team features, or a node canvas.

Tech stack:
- Vite + React + TypeScript frontend
- local Node/Express backend
- SQLite for local persistence
- OpenRouter REST API

Core features:
1. Settings page to save OpenRouter API key locally.
2. Model browser that fetches GET https://openrouter.ai/api/v1/videos/models and displays capabilities: resolutions, aspect ratios, durations, first_frame/last_frame support, audio support, pricing.
3. Generate page with modes:
   - Text to Video
   - Image to Video using first_frame upload
   - Start + End Frame using first_frame + last_frame uploads when supported
4. Submit jobs to POST https://openrouter.ai/api/v1/videos.
5. Poll jobs with GET https://openrouter.ai/api/v1/videos/{jobId}.
6. Download completed videos from GET https://openrouter.ai/api/v1/videos/{jobId}/content.
7. Persist jobs, prompts, model settings, statuses, and local output paths in SQLite.
8. Gallery page to preview/download/duplicate jobs.
9. Compare view to show 2-4 completed videos side-by-side with their model/prompt/settings.

Keep the code simple and modular. Put all OpenRouter API calls in one client module. Build capability-aware UI so unsupported controls are disabled based on model metadata.
```

## 20. Final Recommendation

Build from scratch.

Use OpenVideoUI as a reference implementation only. The clean product is smaller, simpler, and more likely to become useful quickly.

The first public release should be positioned as:

> A simple local OpenRouter video generation studio for testing Veo, Kling, Seedance, Wan, Sora, and other video models.

Keep it boring. Ship it fast. Then iterate.
