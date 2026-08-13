#!/usr/bin/env python3
"""Bounded HTTP concurrency probe for Calendar release verification."""

from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed


def request_once(url: str, timeout: float) -> tuple[str, float]:
    started = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            response.read()
            return str(response.status), time.monotonic() - started
    except urllib.error.HTTPError as error:
        error.read()
        return str(error.code), time.monotonic() - started
    except Exception as error:  # The exception class is part of the evidence.
        return type(error).__name__, time.monotonic() - started


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()
    if args.requests < 1 or args.concurrency < 1:
        parser.error("requests and concurrency must be positive")

    started = time.monotonic()
    results: list[tuple[str, float]] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [executor.submit(request_once, args.url, args.timeout) for _ in range(args.requests)]
        for future in as_completed(futures):
            results.append(future.result())

    durations = [duration for _, duration in results]
    statuses = Counter(status for status, _ in results)
    ordered = sorted(durations)
    p95_index = min(len(ordered) - 1, int(len(ordered) * 0.95))
    evidence = {
        "url": args.url,
        "requests": args.requests,
        "concurrency": args.concurrency,
        "statuses": dict(sorted(statuses.items())),
        "successes": statuses.get("200", 0),
        "wallSeconds": round(time.monotonic() - started, 4),
        "latencySeconds": {
            "average": round(statistics.fmean(durations), 4),
            "p95": round(ordered[p95_index], 4),
            "maximum": round(max(durations), 4),
        },
    }
    print(json.dumps(evidence, ensure_ascii=False, sort_keys=True))
    return 0 if statuses == {"200": args.requests} else 1


if __name__ == "__main__":
    raise SystemExit(main())
