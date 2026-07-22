# YNX Oracle Web

Independent, installable Oracle documentation and evidence console. It never
ships sample market values: the UI reads `/health`, `/version`, and `/prices`
only from the explicitly configured Oracle API.

## Local verification

Use Node.js 22.13 or newer.

```bash
npm ci
npm run lint
npm test
```

Set `NEXT_PUBLIC_ORACLE_API_BASE_URL` to a deployed HTTPS Oracle origin to
enable live probes. If it is absent, the UI reports that the public endpoint is
not configured and disables market queries.

The root and `/oracle` routes render the same product surface. The web app is
anonymous and read-only; it does not consume identity headers, wallet state, or
private provider credentials.
