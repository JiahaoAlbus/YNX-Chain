# YNX Search

YNX Search is a bounded, persistent index over sources with recorded indexing
authorization. It never claims global web coverage or neutrality. Every result
includes its source URL and fetch/index freshness; empty and failed index states
remain visible.

```bash
npm run check
YNX_SEARCH_ADMIN_TOKEN='<operator secret>' npm start
```

Registering and indexing a source is an authenticated operator action:

```text
POST /api/sources
Authorization: Bearer <YNX_SEARCH_ADMIN_TOKEN>
{"url":"https://docs.example/","label":"Docs","authorizationEvidence":"ticket-1234","robotsPolicy":"respect"}

POST /api/sources/<source-id>/index
Authorization: Bearer <YNX_SEARCH_ADMIN_TOKEN>
```

Public endpoints include `/api/search`, `/api/index/status`, `/api/removal`,
`/api/correction`, and `/api/appeal`. Cases retain audit events and appeals must
link to an existing case. The web UI submits all three case types with source,
reason, evidence URLs, and the required parent case for appeals; it shows the
persistent case ID and current Trust-referral boundary after submission.

The interface supports 12 locales (English, Simplified and Traditional Chinese,
Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic, and
Indonesian); Arabic renders right-to-left. Security and coverage language comes
from the shared contract so translations cannot silently turn limited coverage
or bounded privacy into a stronger claim. The optional AI flow uses
`YNX_AI_GATEWAY_URL` and
`YNX_AI_GATEWAY_CLIENT_TOKEN`; without both it returns an honest unavailable
state. Context preview and explicit consent precede streaming, and citation
metadata is rejected unless every URL belongs to the retrieved indexed set.
