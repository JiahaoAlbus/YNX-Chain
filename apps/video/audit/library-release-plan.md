# Video library v2 release

Source: 48fe3824cc6a38ba944427776e48d076f27f54f5

Deployed API then Viewer with apps/video/scripts/deploy-library-v2-20260906.sh, SHA256 5ae9feb0e6dc54be1f21d6d7ce4edb34f3509a75e133f17ead65a59ae6d372ee. Both exact artifact hashes were checked on host first. Every step checked user read/execute, drop-in precedence, inherited environment equality, systemd-analyze verify, health/version, unauthorized negatives, neighboring PID/config hashes, and full artifact identity. No Auth/Creator/data migration.

API release /opt/ynx-video/releases/audit-library-48fe3824cc6a38ba944427776e48d076f27f54f5, unique /etc/systemd/system/ynx-videod.service.d/20260906-v4-library.conf. Rollback: remove only that file, daemon-reload, restart only ynx-videod.service; retained052 absolute binary resumes.

Viewer release /opt/ynx-video-viewer-wallet/releases/ynx-video-48fe3824cc6a38ba944427776e48d076f27f54f5, unique /etc/systemd/system/ynx-video-viewer.service.d/20260906-library-v2.conf. Rollback: remove only that file, daemon-reload, restart only ynx-video-viewer.service; retainedd75 directory resumes.

Scripts are one-run and deliberately reject changed initial state; do not blindly rerun after successful deployment.
