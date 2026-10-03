# Review current IDE context

Status: SOURCE_ONLY. Parent cc3ee127bd34c5557db750723e224deea9d82eef.

Changed project files correctly invalidate prior approvals. The user can now explicitly choose Review current project context in context review, proposal generation or diff review. The server rebinds the run to the authenticated owner's current revision, clears old file approvals and unapplied proposal/review, and reopens file selection. It does not call the model, write files or reuse an earlier approval. Usage, saved requests, events and recoverable trash remain. An audit event records revoked paths and discarded proposal digest.

Removed planned reads/deletes are excluded; a planned create that now exists becomes a proposed read requiring approval. Running operations remain protected by per-run CAS. Applied/tested/Git/deployment stages cannot be reset through this operation.

Verification: 94 related service tests and 23 actual React/Chromium checks passed. Coverage includes stale-context recovery, new approval, current source dispatched to Coder/Reviewer, history preservation, no write-stage bypass, concurrent operation rejection and changed path reconciliation. TypeScript, Vite build and static check passed; 71 build inputs matched QA. Original failures and fixture correction retained. No dependency install/fetch/lifecycle execution.

A's formal release and real normal-user flows remain unverified; configured model, full native workbench, capacity and MONSTER are not proven by these fixtures. Rejected network/package-egress/LXD remain stopped.
