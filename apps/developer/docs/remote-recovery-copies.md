# Remote workspace file copies

This is a source candidate. Public Code deployment and real remote SSH/LXD
acceptance are separate release steps.

When a terminal disconnects or a command has an uncertain completion, Code
retains its workspace protection across gateway restarts. In Remote Explorer,
**Recover workspace files** shows the affected sessions for the current project.
Use **Collect a file copy**, then **Download copy** to save the retained text.
The download is a JSON document containing a `files` map, folders, omitted-file
counts and its session information. It does not replace the open project.

Collection is read-only. A remote process may still be writing, so the copy is
marked `unverified-live-copy`. Collection and download never clear the recovery
journal, allow a new terminal, or authorize removal of the protected directory.
A live interactive session must first be stopped using the process controls.

Each copy holds at most 256 text files, 256 folders and 2 MiB of text. Binary
files and symbolic links are omitted. Oversized or invalid snapshots fail as a
whole. Four copies per runtime, 16 per owner and 256 overall are retained; the
service refuses additional collection at capacity rather than deleting copies.
These limits include copies from earlier sessions. Earlier copies are shown
separately with their original project and session identity, so reusing an SSH
profile for another project does not relabel or mix its old files.
SSH recovery requires the original session's stored random directory identity.
Legacy entries without that identity remain protected and cannot guess a path.

The browser uses the existing signed workspace session. The API resolves its
owner on the server; a runtime ID or recovery ID does not grant access.

| Method and path | Result |
| --- | --- |
| `GET /runtime/profiles/recovery` | Current owner's protected sessions and saved-copy metadata |
| `GET /runtime/profiles/recovery/:runtimeId` | Session information, current copies and earlier copies |
| `POST /runtime/profiles/recovery/:runtimeId/copies` | Collect one bounded copy after explicit UI activation |
| `GET /runtime/profiles/recovery/:runtimeId/copies/:copyId` | Download an owner's saved JSON copy |

The collection body contains `protocolVersion: "ynx-code-recovery/v1"`,
`approval: "collect-recovery-copy-once"` and the current `recoveryId` from GET.
The service rechecks that session after body admission and after collection.
Requests for an active or changed session return 409; capacity returns 429;
failed or interrupted collection returns 503. Responses use `Cache-Control:
no-store`. The browser verifies the downloaded bytes against the saved SHA-256
before starting a file download.

This feature does not prove remote processes stopped and does not complete the
separate stop-receipt protocol or automatic project restoration. Local tests
exercise actual HTTP handlers and SQLite with synthetic remote transports;
they do not certify user SSH hosts, production LXD workspaces, or multi-user
production capacity.
