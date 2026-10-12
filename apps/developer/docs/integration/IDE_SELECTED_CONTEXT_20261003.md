# IDE selected project context

Status: SOURCE_ONLY. Parent: a675aa37bff4e31b438e10cfcb18dc18a7a0e9e0.

Agent Coder and Reviewer receive only explicitly approved files from the authenticated owner/project snapshot through the existing Gateway attachments contract. Planner has no file attachments. The request declares selected_files included only when attachments exist; conversation, chain records, trust records and product contexts remain excluded. Caller-supplied attachments are not an authority. The ordinary prompt carries intent and source metadata; Reviewer receives the compact generated patch.

Selection validation runs before approval advances: at most eight supported nonempty text files, name at most 160 UTF-8 bytes, each text at most 262144 UTF-8 bytes, and encoded Gateway body at most 2 MiB. Unsupported selections leave context review editable. Native Tools pasted text remains ordinary user prompt text.

The approved workspace revision is checked before dispatch, after asynchronous memory lookup, at actual queue dispatch and after the model returns. Changes produce agent_context_changed, save a failed request where one exists, and do not accept a stale answer or proposal. Identity and project ownership checks remain in the same dispatch boundary. The encrypted local AI store saves the reviewed prompt, exact attachments and context declarations, retaining existing project/owner/global quotas.

Verification: 90 related service checks and 16 Gateway checks passed; zero failures/skips. Four selected-context cases exercise actual HTTP/SQLite and controlled Gateway SSE. Original failures and corrected fixture assertions are preserved. Static check passed. All 71 frontend/protocol and package/lock build inputs match the prior build; its exact frontend artifact is reused.

A configured live model, real Wallet product return, full Linux OpenVSCode journey, capacity, installed/public release and MONSTER remain unverified. A owns shared IDE registration/proof/configuration and formal host publication. Network/package-egress/LXD remain stopped.
