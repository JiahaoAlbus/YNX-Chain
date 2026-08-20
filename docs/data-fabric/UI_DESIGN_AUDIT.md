# Data Fabric Operator UI Audit

Data Fabric is a headless data plane with an embedded read-only operator console
at `/operator/`. The console is intentionally not a Wallet authority and never
accepts browser Bearer tokens. It must show truthful health, version, source
and failure state without server paths, secrets, raw event payloads or private
identity data.

The repository has local source/smoke evidence only. There is no current public
console, screenshot, assistive-technology session, responsive-device audit or
Computer Control receipt. Those items remain unverified rather than inferred.
