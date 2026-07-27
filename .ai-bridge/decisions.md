# YNX Developer Decisions

## 2026-07-27 — API Studio architecture

1. **API Studio is part of the existing IDE bottom tool area.** It is not a separate dashboard or a static success page.
2. **OpenAPI input is JSON-only for this checkpoint.** YAML is rejected explicitly so the exact imported document can be reviewed and diffed without adding an unpinned parser dependency.
3. **External OpenAPI references fail closed.** API Studio never fetches an imported schema dependency implicitly.
4. **Credential values never enter browser JavaScript.** Browser state carries only opaque `credential-ref:` identifiers.
5. **Secured requests use a host broker.** The injected `globalThis.ynxCredentialBroker.send` boundary returns a Fetch-compatible response and must not return credential values.
6. **Sandbox execution requires preview, explicit approval, HTTPS or localhost, and a reviewed origin.**
7. **Provider templates are contract candidates, not provider activation claims.** Canonical owners must accept or migrate their fields.
8. **API Studio does not create central audit authority.** Candidate events are handed to Data Fabric and Integration for freezing.
9. **Historical desktop evidence remains attached to its historical source commit.** API Studio is not marked installed in the existing macOS or Windows artifacts.
10. **Current release truth remains local.** Central, staging, public, hosted, signed and store states stay false without direct evidence.

## 2026-07-27 — API Studio localization and accessibility

1. **Localized failures retain the machine error code.** Human-facing text maps to a bounded localized class while the stable code remains visible for support and audit correlation.
2. **Locale changes may translate empty-state text but must not overwrite generated previews, responses, manifests or validation evidence.**
3. **Arabic RTL is scoped to interaction surfaces.** Source code, JSON, structured output and URL fields remain LTR for technical correctness.
4. **Bottom-panel navigation follows the tab keyboard model.** One tab is in the tab order; ArrowLeft/ArrowRight/Home/End move and activate focus.
5. **Static accessibility tests are `testedLocal`, not installed or public proof.** Installed-browser, screen-reader, zoom and visual evidence remain required.
6. **Validation scanners must not treat a missing scanner binary as success.** `rg` remains preferred; the fallback distinguishes findings, clean results and scanner execution failure.

## Safety decisions

- No private key, signing material, credential value or production secret may be requested in chat, written to repository state, or exposed to the browser.
- No static response, fixture, template, HTTP status or generated client may be described as provider connectivity, settlement, deployment or production success.
- Conflicting central schemas must be versioned and submitted to `29-integration`; Developer will not silently maintain two canonical versions.
