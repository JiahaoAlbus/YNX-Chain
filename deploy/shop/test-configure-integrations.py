#!/usr/bin/env python3
"""Black-box safety test for configure-integrations.py."""

from pathlib import Path
import os
import subprocess
import tempfile


def main() -> None:
    script = Path(__file__).with_name("configure-integrations.py")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        shop = root / "shop.env"
        pay = root / "pay.env"
        ai = root / "ai.env"
        chain = root / "chain.env"
        shop.write_text("YNX_SHOP_STATE_HMAC_KEY=keep-me\n")
        pay.write_text("YNX_PAY_API_KEY=pay-secret\nYNX_PAY_MERCHANT_ID=merchant\n")
        ai.write_text("YNX_AI_GATEWAY_API_KEY=ai-secret\n")
        chain.write_text("TREASURY_ADDRESS=ynx1treasury\n")
        os.chmod(shop, 0o640)
        result = subprocess.run(
            [str(script), str(shop), str(pay), str(ai), str(chain)],
            check=True,
            capture_output=True,
            text=True,
        )
        content = shop.read_text()
        assert "YNX_SHOP_STATE_HMAC_KEY=keep-me" in content
        assert content.count("YNX_SHOP_PAY_KEY=pay-secret") == 1
        assert content.count("YNX_SHOP_AI_KEY=ai-secret") == 1
        assert content.count("YNX_SHOP_GATEWAY_URL=http://127.0.0.1:6439") == 1
        assert os.stat(shop).st_mode & 0o777 == 0o640
        assert "pay-secret" not in result.stdout
        assert "ai-secret" not in result.stdout


if __name__ == "__main__":
    main()
