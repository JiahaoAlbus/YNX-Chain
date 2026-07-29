# Governance UI design and accessibility audit

Evidence commit: `0ed74c9e737ca6d5bbdf226f6ca487dc398b4755`

## Implemented local surface

The independent read-only React application now renders the authoritative public proposal contract without a fake wallet, unsigned voting, or inferred execution success. It includes:

- proposal list, filtering, truthful loading, error, retry, and empty states;
- proposal scope, machine-readable parameter diff, vote totals and signed vote records;
- timelock state and bounded execution timing;
- technical, economic, security, migration, and rollback disclosures;
- conflict disclosure and recusal records;
- execution manifest and receipt fields when the API provides them;
- audit-hashed proposal transition history and evidence links.

The interface supports English, Simplified Chinese, Traditional Chinese, Spanish, French, German, Japanese, Korean, Brazilian Portuguese, Russian, Arabic, and Hindi. Server-provided proposal content remains byte-faithful and is not falsely presented as translated. Arabic sets a localized `lang` boundary and `dir="rtl"`; dates use the selected locale.

## Accessibility and responsive evidence

- semantic headings, navigation, sections, links, buttons, form labels, live loading status, and alert errors;
- proposal cards are native keyboard-operable buttons rather than click-only containers;
- filter state uses `aria-pressed`;
- controls wrap at narrow widths and proposal grids use a bounded responsive minimum;
- local Chrome test at 390 × 844 verified no document-level horizontal overflow;
- the same browser test selected Arabic, verified the RTL boundary, focused a proposal, activated it with Enter, and verified conflict, execution, and audit sections.

## Repeatable gates

```text
npm --prefix apps/governance run lint
npm --prefix apps/governance test
npm --prefix apps/governance run build
npm --prefix apps/governance run test:browser
npm --prefix apps/governance audit --audit-level=moderate
```

On 2026-07-29 these gates passed with 2 locale/render tests, 1 real-Chrome browser test, a production build, and zero known npm vulnerabilities.

This is local product evidence only. It does not establish a public deployment, shared-Testnet integration, third-party accessibility certification, or production acceptance.
