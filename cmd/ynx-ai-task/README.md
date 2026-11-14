# Independent AI task client

`ynx-ai-task` calls the existing AI daemon's task routes. It has no Web UI,
provider key, login substitute, Grant issuer, signing function or shell runner.
The daemon retains its original Wallet/session verification, task Grant checks,
fixed tool catalog, model disclosure gates, encrypted Store and recovery rules.

Build the client and original daemon from the same checkout:

```sh
go build -mod=readonly -o ynx-ai-task ./cmd/ynx-ai-task
go build -mod=readonly -o ynx-ai-daemon ./apps/ai
./ynx-ai-task -action health -daemon http://127.0.0.1:6438
```

Start the daemon using its existing private runtime environment described in
`apps/ai/README.md`. Do not enable fixture authentication to run real accounts.
No Source or account credentials are supplied by building this candidate.

Every private request takes a **fresh** canonical Wallet V2 proof from a private
regular `0600` file. The original Wallet must issue the correct route scope;
the client cannot mint, refresh or repurpose a proof. Proofs and prompts do not
belong in command-line arguments. This release connects only to an explicit
loopback IP/port, with no proxies, redirects, cookies, bearer-token fallback or
automatic retry. It does not install a native Wallet login policy; the original
daemon's registered session policy still applies.

For task creation, put `{"conversationId":"the-original-conversation-id"}` in
a private request file. Then:

```sh
./ynx-ai-task -action task-create -data-file /private/create.json \
  -proof-file /private/fresh-proof -journal /private/task-delivery \
  -operation create-original-1
./ynx-ai-task -action operation-show -journal /private/task-delivery \
  -operation create-original-1
./ynx-ai-task -action task-show -task task_original \
  -proof-file /private/fresh-proof
```

`conversation-create`, `task-prepare`, `task-cancel`, `task-complete`, `task-handoff`,
`step-propose`, `step-approve`, `step-dispatch`, `step-reconcile`, `run-start`,
and `run-resume` accept the original daemon's JSON request body via `-data-file`.
`step-*` actions need `-task`/`-step`; `run-show` needs `-task`/`-run`.
`run-resume` sets the existing daemon's resume flag; it does not invent a new
run, retry an unknown tool effect or release a blocked final answer.
`step-result` and `run-show` display the original authorized response.
For a step with an authority operation ID reported by `task-show`, pass
`-expect-authority-operation ID` to `step-result`. The client withholds a
successful response body unless it matches the original step and operation.
`task-show -after-cursor N` reads the next bounded event page. No mutation or
poll is automatic, so each invocation can obtain a fresh appropriate proof.

Each mutation first reserves an exclusive original delivery ID in the private
journal and syncs it to disk. Existing IDs are never resent, including PENDING,
UNKNOWN and already received responses. The journal stores IDs, endpoint/route,
hashes and delivery status, **not** proof, Grant reference, prompt or result
plaintext. After response loss, inspect the task or original run/step and invoke
the original `step-reconcile` route with a new *query delivery ID*, keeping the
same remote task/step/operation. Never use a new effect ID to bypass UNKNOWN.
If even a create response is lost, PENDING/UNKNOWN is retained. Use `task-list`
with a fresh `ai:conversations` proof to discover owned task metadata; each page
contains at most 100 tasks, and `-after-task` carries its `nextId`. Identify the
original task explicitly; discovery is not automatic operation reconciliation.
The client does not guess that creation failed or retry it. A received HTTP response is not a
business receipt; daemon task/step state and verified result remain authoritative.

The explicit local command below reads a real regular file through the user's
OS permissions and prints its byte count and SHA-256/SHA3-512. It does not send
contents anywhere or mark an AI task completed:

```sh
./ynx-ai-task -action inspect-file -file /absolute/path/to/file
```

The result explicitly has `taskGrant:false` and `modelDisclosed:false`. This is
a human-invoked local inspection, separate from registered AI tools. Symlinks,
non-regular files, changes during the read and files larger than 16 MiB are
rejected. It cannot authorize model disclosure or replace the original Auth
grant for a model-selected local file or a Shop order.

Current acceptance boundaries: client/daemon compilation, local process
startup, actual file read, PUBLIC-controlled session/Store regressions, genuine
Wallet login, actual authorized tool execution, installation and public release
are separate. Missing Source/issuer admission keeps affected execution closed.

`task-handoff` uses the canonical POST `/open/v1/tasks/{id}/handoffs` with the
original version, distinct new holder and authorization reference from a private
JSON file. It remains UNREGISTERED until the matching original Auth Source and
V6 action verifier are installed. A local session or CLI flag cannot transfer a
Grant. Keep the original delivery ID after any lost response; query its original
record rather than issue another handoff. The API alias has no separate handler
or authorization capability.
