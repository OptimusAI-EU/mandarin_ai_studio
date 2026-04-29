# Contributing

Thanks for your interest in Open Video Studio.

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Checks

Run before opening a pull request:

```bash
npm run check
npm audit --audit-level=high
```

## Scope

Keep the project local-first and OpenRouter-focused. Avoid adding accounts, cloud hosting, team features, provider abstractions, MCP, or a timeline editor without a clear issue and discussion first.

## Pull Requests

- Keep changes focused.
- Include screenshots for UI changes.
- Do not commit `.ovstudio/`, generated videos, API keys, `node_modules/`, or `dist/`.
- Document user-facing changes in `README.md` when relevant.
