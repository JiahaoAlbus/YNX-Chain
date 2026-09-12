#!/usr/bin/env python3
"""One bounded local inference, only inside a coordinator-assigned CPU window.

Run on the existing model host. No daemon startup, model download, external
provider, private data, Wallet approval, or default Gateway reconfiguration.
This is provider evidence only, not authenticated AI product acceptance.
"""

import argparse
import json
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window-id", required=True)
    parser.add_argument("--model", choices=["qwen2.5:1.5b", "qwen3:1.7b"],
                        default="qwen2.5:1.5b")
    args = parser.parse_args()
    if not args.window_id.strip():
        parser.error("A coordinator-assigned resource window is required")
    request = {
        "model": args.model,
        "prompt": "In two short sentences, explain why connecting a wallet does not authorize a money transfer. Do not request credentials or perform any action.",
        "stream": False,
        "keep_alive": "30s",
        "options": {"num_predict": 96, "num_thread": 1, "num_ctx": 1024,
                    "temperature": 0, "seed": 7},
    }
    if args.model.startswith("qwen3:"):
        request["think"] = False
    start = time.monotonic()
    try:
        result = subprocess.run(
            ["curl", "--silent", "--show-error", "--fail", "--noproxy", "*",
             "--connect-timeout", "3", "--max-time", "60",
             "--max-filesize", "131072", "-H", "Content-Type: application/json",
             "--data-binary", "@-", "http://127.0.0.1:11434/api/generate"],
            input=json.dumps(request), capture_output=True, text=True, timeout=65,
            check=True,
        )
        response = json.loads(result.stdout)
        answer = response.get("response", "")
        answer = answer.strip() if isinstance(answer, str) else ""
        complete = (response.get("done") is True and
                    response.get("done_reason") == "stop" and bool(answer) and
                    response.get("model") == args.model and
                    "<think>" not in answer and "</think>" not in answer)
        receipt = {
            "windowId": args.window_id, "requestedModel": args.model,
            "returnedModel": response.get("model"),
            "elapsedSeconds": round(time.monotonic() - start, 3),
            "done": response.get("done"), "doneReason": response.get("done_reason"),
            "evalCount": response.get("eval_count"),
            "thinkingPresent": bool(response.get("thinking")),
            "finalAnswer": answer, "completeFinalAnswer": complete,
            "qualityAccepted": False, "productLifecycleAccepted": False,
        }
        print(json.dumps(receipt, ensure_ascii=True))
        return 0 if complete else 2
    except (subprocess.SubprocessError, ValueError, OSError) as error:
        print(json.dumps({"windowId": args.window_id, "model": args.model,
                          "failureClass": type(error).__name__,
                          "elapsedSeconds": round(time.monotonic() - start, 3),
                          "qualityAccepted": False,
                          "productLifecycleAccepted": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
