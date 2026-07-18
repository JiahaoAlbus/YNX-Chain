#!/usr/bin/env python3
"""Idempotently attach the Shop staging routes to the existing Web4 host."""

from pathlib import Path
import shutil
import sys


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: install-staging-routes.py CADDYFILE BACKUP")
    caddyfile = Path(sys.argv[1])
    backup = Path(sys.argv[2])
    old = """web4.ynxweb4.com {
  reverse_proxy 127.0.0.1:38091
}
"""
    new = """web4.ynxweb4.com {
  import /etc/caddy/shop-staging.routes
  reverse_proxy 127.0.0.1:38091
}
"""
    text = caddyfile.read_text()
    if new in text:
        return 0
    if text.count(old) != 1:
        raise SystemExit("refusing to edit an unexpected Web4 Caddy block")
    shutil.copy2(caddyfile, backup)
    caddyfile.write_text(text.replace(old, new))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
