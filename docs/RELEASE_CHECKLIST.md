# Release Checklist

## Before Tagging

- Run `npm ci`.
- Run `npm run check`.
- Run `npm audit --audit-level=high`.
- Start the app with `npm start`.
- Confirm `http://127.0.0.1:4317/api/health` returns `{"ok":true}`.
- Confirm `.ovstudio/`, generated videos, API keys, `dist/`, and `node_modules/` are not staged.
- Sync models in the app and smoke-test the Generate form without submitting a paid job.

## Manual Smoke Tests

- Save, test, and clear an OpenRouter API key.
- Sync video models.
- Verify model capability filters.
- Verify Generate prevents unsupported duration/resolution/aspect/size combinations.
- Verify batch selection is capped at 3 models.
- Verify batch cost estimates show per-model effective settings.
- Verify Jobs, Gallery, and Compare render with existing local jobs.

## Tagging

Use semantic versioning once releases begin:

```bash
git tag v0.1.0
git push origin v0.1.0
```
