# Economics Disclosure SLO and Capacity Plan

## Evidence boundary

The only measured capacity evidence is `evidence/performance/economics-local-benchmark.json`, bound to source commit `9b5ed34efd7b62c88bed6150a2f38bf9b862e768`. It measured the read-only `/api/economics/disclosure` handler in one Go process over loopback on an 8-logical-CPU Apple arm64 host. It is not a public, staging, network, multi-instance, sustained-load, or concurrent-user result.

| Measure | Direct result | Coverage boundary |
| --- | ---: | --- |
| Requests / workers | 2,000 / 16 | 50 warmups; short local run |
| First request | 0.964 ms | Process already started; not deployment cold boot |
| p50 / p95 / p99 | 0.436 / 1.178 / 1.471 ms | Client-observed loopback latency |
| Maximum | 1.941 ms | Same run only |
| Throughput | 29,106.93 requests/s | Local burst, not an ingress commitment |
| Errors | 0 (0 bps) | Same 2,000-request sample |
| Response / allocation | 1,828 bytes / 25,011 allocated bytes per request | Runtime allocation delta, not RSS |
| Queue | Not measured | Handler has no application queue |
| Storage growth | 0 bytes/request | Handler does not persist request state |
| Provider latency | Not applicable to reference response | No third-party call is made |
| Rate limit | Not configured | Public ingress is not deployed |

## Candidate service levels

These are pre-deployment targets, not achieved SLO claims: 99.9% monthly availability; p95 below 250 ms and p99 below 750 ms at the public edge; error rate below 0.1% excluding valid 4xx; health and source freshness checked every minute. The disclosure must fail visibly when its reference model cannot be produced. Candidate alerts are a 5-minute error ratio above 1%, p99 above 1 second for 10 minutes, health failure for 2 checks, or reference `asOf` outside the approved release window.

Before `deployedStaging` can become true, run 30-minute and 6-hour tests through the real ingress at 1x and 2x forecast traffic, record CPU/RSS/GC/network saturation, validate ingress limits, and test instance loss. Before `deployedPublic`, use actual traffic to set autoscaling and concurrency limits; do not extrapolate the loopback burst into user capacity.

## Recovery objectives

The disclosure endpoint is stateless; its candidate RTO is 15 minutes by redeploying the immutable build and its candidate RPO is zero request data because it stores none. These values are not yet drill-proven. YUSD sandbox state is separate: local hash-preserving restore correctness is tested by `make yusd-restore-drill`, but elapsed RTO, off-host backup, retention and staging RPO are unmeasured and therefore have no achieved objective.
