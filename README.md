# Open Video Studio

A local-first studio for generating and comparing AI videos through OpenRouter video models.

## What Works

- Save an OpenRouter API key locally.
- Sync video model metadata from OpenRouter.
- Generate text-to-video jobs.
- Generate first-frame and start/end-frame jobs when the selected model supports them.
- Persist jobs, prompts, payloads, model settings, and statuses in SQLite.
- Poll async jobs and save completed videos to a local output directory.
- Browse jobs, gallery items, and compare 2-4 completed local videos.
- Submit controlled batches with up to 3 selected models and up to 3 videos per model.

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

- `studio.sqlite` for settings, model cache, jobs, and assets
- `assets/` for uploaded frame images
- `outputs/` for downloaded videos unless changed in Settings

The app is designed for local use. Do not host it publicly with a saved API key.

## API Surface

The local backend exposes:

- `GET /api/settings`
- `PATCH /api/settings`
- `POST /api/settings/test`
- `GET /api/models/video`
- `POST /api/models/sync`
- `POST /api/assets/upload`
- `POST /api/jobs`
- `POST /api/batches`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs/:id/poll`
- `POST /api/jobs/:id/download`
- `POST /api/jobs/:id/retry`
- `POST /api/jobs/:id/duplicate`
- `DELETE /api/jobs/:id`
- `GET /api/gallery`

## Notes

Node 22's built-in SQLite module is used to avoid a native SQLite dependency. It may print an experimental warning depending on the installed Node build.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md). This app stores API keys locally and should not be hosted publicly with a saved key.

## License

MIT. See [LICENSE](LICENSE).
