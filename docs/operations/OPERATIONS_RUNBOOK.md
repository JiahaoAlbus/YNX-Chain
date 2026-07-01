# Operations Runbook

Local service: `make devnet`; health: `curl /health`; status: `curl /status`; logs: process stdout.

Remote systemd service names, log paths, nginx hosts, backup paths, and TLS renewal commands are generated after real inventory is supplied.

Emergency process: stop public writes, preserve logs, snapshot state, communicate incident, roll back only from verified backups.

