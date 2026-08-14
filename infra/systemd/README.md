# systemd

This directory is part of the YNX Chain engineering surface. It is intentionally separated so runtime code, deployment assets, and review packages do not collapse into the website repository.

The Monitor uses `ynx-monitor.example.service` for the authenticated control plane and `ynx-monitor-publisher.example.service` plus its timer for the signed, fail-closed public service projection. Deployments must render `/etc/ynx/ynx-monitor.env` with the exact accepted source commit and release; the example environment deliberately does not carry a historical identity. Enable both the control service and publisher timer, then verify `/health`, `/version`, and `/status` through the scoped Caddy ingress.
