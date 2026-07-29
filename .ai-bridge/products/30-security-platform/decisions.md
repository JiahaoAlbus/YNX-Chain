# YNX 30 Decisions

Updated: 2026-07-27T15:18:12Z

1. Treat repository and remote evidence as authoritative over archived chat summaries.
2. Keep the product ACTIVE even though current GitHub workflows are green, because artifact, clean-install, staging, public, hosting and production-signing gates remain incomplete.
3. Preserve the nine release states independently; a current local test pass does not change installation, integration, staging, public, hosting, signing or store states.
4. Do not mutate a cluster or contact a production provider until CI is green and current-source artifact evidence is complete; CI is now green, while artifact evidence remains incomplete.
5. Build new artifacts only from a clean Git archive and keep any local signature classified as test/ephemeral.
6. Do not rewrite historical artifact records. Add a current-source record and select it only after its verification passes.
7. Record GitHub TLS failures as an evidence-access blocker, not as a CI explanation; continue local reproduction until exact logs are available.
8. Maintain all external inputs as references/metadata only. Never request secret values, private keys, PEM material or production credentials in chat.
9. Protect the final branch immediately with strict Required Checks, review controls, linear history, force-push/deletion denial and conversation resolution.
10. Keep administrator enforcement disabled only during active recovery so verified checkpoints can still be pushed directly; enable it during the final repository lock.
11. Do not enable required signed commits until an approved commit-signing identity and compatibility plan exist; artifact signing remains a separate external-signer gate.
