# Finance P0-300 parent-preserving observer successor

Status: source request only. It does not authorize SSH, deployment, rollback, service control, Wallet prompts, signing, or transactions.

P0-298 is consumed and nonreusable. P0-299 proved that its rc137 attempt made no remote mutation and left every P0-298 remote path absent. A harmless local probe reproduced rc137 when the tracked top-level coordinator used Python `os.execve`; the same empty environment and exact Finance 25-argument pre-SSH checks pass under a parent-preserving Node child process.

The P0-300 observer first verifies the regular non-symlink observer contract against Central-frozen bytes and SHA-256. It then passes the frozen argument strings without shell reconstruction, keeps the parent process alive, uses an empty child environment with `shell:false` and `stdio:'inherit'`, and observes only status, signal, and error code. It never inspects or opens the declared Finance output and receipt paths.

P0-300 uses a wholly new namespace. Central must freshly sign its stdin, baseline, candidate and absence tuples, exact 25-element launcher argv, and direct Node observer invocation. Success retains exact signed candidate and rollback material with `current` on the candidate; automatic rollback restores the signed old runtime and removes only identity-bound P0-300 residues. No P0-298 value is a deployment authority.
