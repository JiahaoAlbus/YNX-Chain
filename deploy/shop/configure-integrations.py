#!/usr/bin/env python3
"""Wire Shop to co-located YNX services without printing or duplicating secrets."""

from pathlib import Path
import os
import sys
import tempfile


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def require(values: dict[str, str], key: str, source: Path) -> str:
    value = values.get(key, "")
    if not value:
        raise SystemExit(f"required {key} is missing from {source}")
    return value


def update_env(path: Path, updates: dict[str, str]) -> None:
    stat = path.stat()
    lines = path.read_text().splitlines()
    remaining = dict(updates)
    output: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in remaining:
                output.append(f"{key}={remaining.pop(key)}")
                continue
        output.append(line)
    if output and output[-1] != "":
        output.append("")
    output.extend(f"{key}={remaining[key]}" for key in sorted(remaining))
    output.append("")

    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write("\n".join(output))
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, stat.st_mode & 0o777)
        os.chown(temporary, stat.st_uid, stat.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    if len(sys.argv) != 5:
        raise SystemExit(
            "usage: configure-integrations.py SHOP_ENV PAY_ENV AI_ENV CHAIN_ENV"
        )
    shop_path, pay_path, ai_path, chain_path = map(Path, sys.argv[1:])
    pay = parse_env(pay_path)
    ai = parse_env(ai_path)
    chain = parse_env(chain_path)
    update_env(
        shop_path,
        {
            "YNX_SHOP_GATEWAY_URL": "http://127.0.0.1:6439",
            "YNX_SHOP_PAY_URL": "http://127.0.0.1:6430",
            "YNX_SHOP_PAY_KEY": require(pay, "YNX_PAY_API_KEY", pay_path),
            "YNX_SHOP_PAY_MERCHANT_ID": require(pay, "YNX_PAY_MERCHANT_ID", pay_path),
            "YNX_SHOP_PAY_PAYOUT_ADDRESS": require(
                chain, "TREASURY_ADDRESS", chain_path
            ),
            "YNX_SHOP_AI_URL": "http://127.0.0.1:6429",
            "YNX_SHOP_AI_KEY": require(ai, "YNX_AI_GATEWAY_API_KEY", ai_path),
        },
    )
    print("Shop integration environment updated; secret values were not displayed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
