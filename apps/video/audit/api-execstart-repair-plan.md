# Video API restart recovery — completed

The Viewer delivery itself did not restart API. The coordinator subsequently authorized this separate same-binary repair and one ordered restart, completed at `2026-09-06T03:38:05Z`.

- Installed only `/etc/systemd/system/ynx-videod.service.d/20260906-executable.conf`, SHA-256 `eb80c78f51caa0ec902e6afe59a6281ee508331cd1620af73c67748c5f5f3788`.
- Verified the absolute disk binary and running process SHA match, executable access for user `ynx`, persistent environment-file binding, and systemd verification before restart.
- PID changed `3108210 → 2109198`, active with `NRestarts=0`, running the same `1883d406...` binary.
- `/health`, `/version` and guest catalog SHA-256 values are identical before/after; catalog is still `[]`.
- Viewer PID `2106183`, Creator PID `2803386`, their start times, unit/response hashes, Caddy and shared-current target are unchanged.
- Existing `/etc/ynx/ynx-videod.env` binding remains in place. No secret values were read or printed.
- Script: `apps/video/scripts/repair-api-execstart-20260906.sh`. Exact receipt: `api-restart-repair-receipt.txt`.

The pre-execution plan below remains as the rationale and recovery guidance. Do not restore the old dangling path and restart it.

## Current evidence

Fresh read-only SSH used the project source's primary-host binding in `scripts/ops/legacy-inventory.sh`: `ubuntu@43.153.202.237`, `/Users/huangjiahao/Downloads/Huang.pem`, BatchMode, IdentitiesOnly, and the existing known-host entry. No private key or environment contents were printed.

- `ynx-videod.service` is active, PID `3108210`, listening on `127.0.0.1:6493`.
- Unit SHA-256: `d86450cae478510c94b0b7af9d78fb4241ebd691a41e3864ca296eefe16a2e4f`.
- Unit `ExecStart=/opt/ynx-video/current/ynx-videod`; that file does not exist.
- `/opt/ynx-video/current` currently resolves to `/opt/ynx-video/releases/p0205-creator-studio-0e1a53c5`.
- The running process executable resolves to `/opt/ynx-video/releases/1883d406f77f94cb81171b79fe9518882ede0b16/ynx-videod`.
- Running executable SHA-256: `6fb91e9030a00a7b0ea88a11629f1442a6f6e4d8dea8720f64fd997e98b7831d`.
- `/health` and `/version` report source `1883d406f77f94cb81171b79fe9518882ede0b16`, release `ynx-video-1883d406`; `/health` reports healthy dependencies.
- User/group: `ynx:ynx`; existing persistent environment file: `/etc/ynx/ynx-videod.env`; no drop-ins currently present.

Evidence: `remote-mapping.txt`, `remote-readonly-details.txt`, `remote-exact-preflight.txt`.

## Proposed isolated repair

After coordinator scheduling, recheck the unit hash, the binary on disk, `sudo -u ynx test -x` on the absolute binary, environment-file existence/readability, all existing drop-ins, and the health/version identity. Do not copy secret environment values into a script or use another process's environment.

Add only `/etc/systemd/system/ynx-videod.service.d/20260906-executable.conf`:

```ini
[Service]
ExecStart=
ExecStart=/opt/ynx-video/releases/1883d406f77f94cb81171b79fe9518882ede0b16/ynx-videod
```

The base unit continues to supply the persistent `EnvironmentFile=/etc/ynx/ynx-videod.env`, user, group, port and data path. This repair must not modify the shared current link, Creator 6495, Viewer 6494 or Caddy.

Run `systemd-analyze verify ynx-videod.service`, then `systemctl daemon-reload` and inspect the resulting `ExecStart` and `EnvironmentFiles` before a separately coordinated API restart. The unit text can be repaired without restarting the running API immediately.

On the coordinated restart, capture the old/new PID and verify 6493, `/health`, `/version`, anonymous catalog and media, then check Creator/Viewer identities and responses. Do not treat an empty anonymous catalog as a playback pass.

## Rollback limits

Before any API restart, removing only this drop-in and running `daemon-reload` returns the old unit configuration while leaving the current process running.

After a restart, the old `ExecStart` is already broken and is **not** a usable executable rollback. Keep the verified absolute `1883d406...` binary and its existing persistent environment as the operational recovery target. If a later API version is introduced, retain this working absolute binary as its rollback. Do not restore the dangling shared-path command and then restart it.

## Guest content gate

The actual unauthenticated API returns `[]`; no published media URL is available to play. Source `1883d406...` contains `internal/video/testdata/ynx-owned-test.mp4` with SHA-256 `be414db1d01558b11c7592b7d4dc69d0fee8da158997dc477e2fdaf6b9e3ee39`. Its README describes a repository-generated Klein-blue field and 642 Hz tone for processing tests, with no third-party content.

The coordinator allows clearly identified Testnet demonstration data, but upload and publication routes require `auth.Account`, Product Session and idempotency. No authenticated session was available in this run; no authentication bypass, direct store edit, synthetic user or fake view count was used. A real authorized create-channel → upload → process → rights/review → publish → anonymous playback flow remains required.
