# Finance legacy dynamic locale slice

Source-only, not a completed multilingual release. The registered default
remains English and the selectable languages remain en, zh-CN, zh-Hant, ja,
ko, es, fr, de, pt, ru, ar and id.

This slice adds 85 localized keys per language for source alerts, YNXT owned
activity, Pay receipts, budget planning, bounded statements, AI review and
Support recovery, five legacy section descriptions and AI order-intent
validation states and legacy form/table labels. These loaded sections re-render from the existing
account-bound data
when the user changes language; no new network read or write is triggered.
Budget category selection and selected AI record IDs survive re-render.
Provider strings, account records, raw progress, user-entered categories and
protocol payloads are not translated or changed.

Focused tests: locale completeness 392 keys across 12 languages, AI browser
selection/RTL behavior, and Broker browser regression passed. The release
verifier manifest is still pinned to earlier reviewed source and therefore
must remain fail-closed until a final source/bundle review.

Remaining: several legacy static form labels/paragraphs and other dynamic
Finance surfaces still have English-only UI. Public deployment, installed
Wallet, real account approval,
signatures, Broker execution and transactions remain unverified.
