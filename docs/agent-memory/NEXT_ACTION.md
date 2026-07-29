# YNX Monitor Next Action

Implement the typed backup, restore-drill, and rollback-proposal operator UI in `apps/monitor/src/App.tsx` and its API bindings.

The slice must:

1. Render capability-gated create, verify, and review actions for `backup:record`, `backup:verify`, `rollback:propose`, and `rollback:verify`.
2. Preserve explicit approval phrases and independent-verifier states from the existing server contracts.
3. Display evidence identity, SHA-256, retention, RPO/RTO, verification state, and the non-executing rollback boundary without implying that Monitor performed an infrastructure action.
4. Add focused component tests and managed desktop/mobile Playwright coverage.
5. Run `npm test`, `npm run build`, `npm run test:e2e`, and `npm run security:check` before committing.
