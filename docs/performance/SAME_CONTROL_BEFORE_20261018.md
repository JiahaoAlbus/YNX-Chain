# Matched four-node before result

The before variant completed once with 1,024/1,024 effective business transactions finally observed in 7.552927125 seconds: 135.576576 transactions/s. Rejection, execution failure, UNKNOWN, timeout and observation failure were zero. This is an isolated loopback fixture, not public-network throughput or sustained capacity. The cached variant has not run.

| Client-observed latency, ms | P50 | P95 | P99 |
| --- | ---: | ---: | ---: |
| Submission to effective inclusion | 950.891 | 1365.555 | 1454.530 |
| Submission to qualified final observation | 1176.175 | 1767.880 | 1851.966 |
| Offer to qualified final observation | 1321.300 | 1809.345 | 1868.019 |

Offer-to-final percentiles sum the original monotonic queue and confirmation spans per transaction before ranking. They do not sum separate percentiles. Actual offer interarrival rate was 180.034/s versus configured ceiling 512/s; submission interarrival rate was 176.185/s. All workload-window stage rates were 135.576576/s. Steady-state TPS is unqualified.

The observer freshly hashed 10,593,751 bytes over 29 durable attempts, performed 23 snapshot validations and 1,024 independent observed transaction signature checks. The 15,384 historical replay inputs across 149 replayed blocks are repeated verification work, not new business transactions. The 8,079 interim observation error occurrences did not become terminal business failures.

Controller session 26119 exited 0 without a firstCause. Peak owned/control RSS was 551,845,888 bytes, peak data 22,335,488 bytes and sampled threads 72. Independent cleanup checked 58 original PID/group identities and all 12 loopback ports twice. Original databases and reports remain preserved. All-four stopped-node replay/account readback is still pending.

[Configuration, exact metrics and original file hashes](evidence/same-control-before-20261018.json). [Frozen common controls](SAME_CONTROL_COMPARISON_PREPARATION_20261018.md). Hardware: Apple M4, 10 logical CPUs, 24 GiB RAM; darwin/arm64, Go 1.25.7.

Pending offline proof command, only after a new Root light-window grant:

```sh
YNX_CHAIN_STOPPED_WINDOW="$PWD/artifacts/chain-network-performance/window-eEfGE7" artifacts/chain-performance-20261017/partial-reconciliation-client.test -test.run '^(TestStoppedNetworkReplay|TestStoppedReadySenderAccountReadback)$' -test.count=1 -test.timeout=45s
```

This reuses the retained older test binary for its existing completed-window checks, requires resource admission, and writes new exclusive evidence files. It does not compile the new partial-prefix source. It has not been executed for this window. No automatic cached run, retry, resubmission, reset or deployment is authorized.
