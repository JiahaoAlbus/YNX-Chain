#!/usr/bin/env python3
"""Idempotently add dedicated public Shop hosts to the canonical Caddy file."""

from pathlib import Path
import shutil
import sys


PUBLIC_BLOCK = """

shop.ynxweb4.com {
  redir / /shop/ 302
  reverse_proxy 127.0.0.1:18095
}

shop-api.ynxweb4.com {
  reverse_proxy 127.0.0.1:18095
}
"""


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: install-public-routes.py CADDYFILE BACKUP")
    caddyfile = Path(sys.argv[1])
    backup = Path(sys.argv[2])
    text = caddyfile.read_text()
    if "shop.ynxweb4.com {" in text or "shop-api.ynxweb4.com {" in text:
        if PUBLIC_BLOCK.strip() in text:
            return 0
        raise SystemExit("refusing to replace an unexpected existing Shop host block")
    shutil.copy2(caddyfile, backup)
    caddyfile.write_text(text.rstrip() + PUBLIC_BLOCK + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
