# Original40091935654 qualified prepared certificate result

The complete independent original pair passes: frozen HEAD142dc802458590ce20e809089cb794897cb3fe91/CODE561bf6d03669cbe68dc3ef9b6e855610e59b45b9, exact13 frozen source/readers, normal push CI40091419741 SUCCESS, Root pressure1 once grant8091B/SHA69a6ade788e12590e5c29a5ecc33e26ffe223b562391c66eb460730ef4c75bbf, unique dispatch/run/job40091935654/120866232407, same VM/boot/source/fourELFs/environment, original two complete checker passes, original caps and launcher-only closure. Original frozen archive core recovered549 selected members/43,325,115B; independent verdict495,446B/SHAa7a3c65a1a21aa5eb3a869b9e1442b2da38bf6382539d27934ca3581443d304a reaudits all selected CRC/SHA with zero network and full signed8192×2 streams. This is selected-member identity, not a recomputed whole-ZIP digest. Raw captures/partial attempts/UNKNOWN and failed before join are retained on WD.

Both sides use Linux amd64/four logical CPUs, GOMAXPROCS1 per process/GOGC100/GOMEMLIMIT off,8submitters/four observers,2048senders×4rounds, bounded cadence/current-input reuse, Statusoff/canonicaloff/suffixoff, original signed native proofs/full state and history validation. Physical CPU model is not established by cpuCount. Only after explicitly selects prepared certificate publication. New cached-fee timestamp source is not present in this frozen run.

| Actual complete-window metric | Original strict publication | Prepared publication |
|---|---:|---:|
| rpcSubmissionsPerMeasurementSecond | 398.287104 | 408.792650 |
| checkTxAcceptedPerMeasurementSecond | 398.287104 | 408.792650 |
| effectiveBusinessIncludedPerMeasurementSecond | 398.287104 | 408.792650 |
| finalSubmittedPerMeasurementSecond | 398.287104 | 408.792650 |
| offeredInterarrivalRate | 426.637553 | 442.082073 |
| measurementWindowSeconds | 20.568077 | 20.039499 |

Final throughput improves2.6377% (398.287104→408.792650/s). All8192 inputs per side are signed/executed/effectively included/final with0 UNKNOWN/timeouts/notSubmitted/execution failures. Configured offered1000 is not actual offered1000: actual offer426.638→442.082/s. Both sides have24 business blocks per node. This finite roughly20s measurement is not sustained1000/600s or3–5k qualification. The earlier400872 host/run also reported4 logical CPUs but is a different environment/run;267→409 is not a causal same-condition source gain.

| Offer to completion latency upper bound P50 / P95 / P99 (ms) | Original | Prepared |
|---|---:|---:|
| Client authenticated effective inclusion | 1146.000 / 1477.000 / 1662.000 | 1093.000 / 1434.000 / 1645.000 |
| Client authenticated final observation | 1324.000 / 1653.000 / 1823.000 | 1258.000 / 1551.000 / 1701.000 |
| Endpoint node Finalize returned | 975.000 / 1276.000 / 1482.000 | 934.000 / 1234.000 / 1374.000 |
| Endpoint node durable Commit returned | 1005.000 / 1305.000 / 1519.000 | 961.000 / 1261.000 / 1406.000 |
| Node Commit to client final observation | 315.000 / 445.000 / 479.387 | 286.000 / 438.000 / 459.497 |

Node endpoint points are matched to transaction-height block hash with clock error envelopes20,330ns/7,481ns; full signed/native terminal streams remain separately checked. Earliest BFT quorum formation instant is not measured. Finalize return and durable Commit return are concrete later completion observations. Quantiles are not additive; do not add Commit P95 and observation P95 to manufacture final P95.

| Actual client wall totals (s) | Original | Prepared |
|---|---:|---:|
| readerWall.decodeNs | 5.242197 | 4.300656 |
| readerGate.waitNs | 6.909467 | 5.885545 |
| readerGate.holdNs | 5.738513 | 4.892970 |
| prefix.privateValidate.durationNs | 0.497816 | 0.630767 |
| prefix.suffixSetup.durationNs | 0.489279 | 0.465548 |
| prefix.suffixReplay.durationNs | 1.961322 | 1.891443 |
| prefix.suffixEncode.durationNs | 0.564154 | 0.667659 |
| prefix.certificatePublish.durationNs | 1.124222 | 0.147313 |
| certificate.strictJSON.durationNs | 0.924011 | 0.048423 |

Decode5.242197→4.300656s(-17.96%), strict JSON24 calls924.011→2 strict cold calls48.423ms;22 prepared publications replace22 hot strict roundtrips. After-only prepared subclocks: normalization60.284ms/JSON549.417ms/publicCopy57.659ms/fallback0, included in suffixEncode667.659ms. Baseline has no equivalent child clocks; never infer zero baseline child cost. Parent/child and concurrent wall totals overlap; do not sum all rows. Client CPU13.368001→12.617455s/64.994→62.963% of one core. Mean submission callback11.234→10.738ms, mean ready queue31.928→25.647ms; this does not isolate a unique remaining CPU/RPC bottleneck.

| Four-node business Commit mean (ms),96samples each | Original | Prepared |
|---|---:|---:|
| commit | 25.695453 | 25.380091 |
| validate | 21.665423 | 21.768986 |
| validate.app_hash | 13.553238 | 13.502320 |
| validate.semantics | 8.005828 | 8.142586 |
| delta_encode | 0.163893 | 0.215443 |
| write | 0.195888 | 0.191699 |
| file_sync | 1.465734 | 1.324275 |
| journal_maintenance | 2.038398 | 1.811899 |

Client publication changes do not change node implementation. Do not attribute node timing variation causally to prepared publication. Both nodes retain complete full Validate and historical audit; AppHash remains a measured dominant child of Commit. Four nodes executing each business transaction are not4× business TPS.

Sampled aggregate RSS1,036,263,424→992,063,488B(-44,199,936B/-4.27%), both within original1GiB admission. The after sampled margin is81,678,336B, not a hard RSS bound or stable leak repair. Private retained122,941,194→123,002,489B,build119,712,507B,threads66→68. Original45active+15cleanup/60case,pair120,thread320/concurrent10/recorded11roles/private256MiB each+aggregate512MiB/log2MiB/build1GiB/floors remain. Actual internal case27,878/27,489ms and pair56,039ms, no refused sample; post-fsync double scans retain only original launcher39319/start49188. Build remains inside original20minute job.

Joint finiteFinalRateIncreased/offerInclusionTailNotWorse/offerFinalTailNotWorse/finiteFinalP95Within3s/finiteJointImprovementObserved are all true; sustainedTPSQualified remains false. Keep original default; the explicitly selected prepared path can serve as a controlled candidate baseline in a separately granted next experiment, not a production promotion.

Reproduce with committed native-prepared-certificate-qualified-pair reader(source packet,capture,original complete CI raw,terminal gh JSON,new output), then comparison and node-resources; node-completion runs per original case. Exact source/grant/normalCI/once/raw/archive pins are in the machine comparison. The initially attempted before join strictly failed on missing original transactions.json before recovery completed; its raw is retained and new successful output uses02, without changing frozen readers.

Next implementation: finish explicit application/client selection and runtime evidence for cached-fee JSON under its new normal CI, keep default original and all native proof/persistence gates, then request a fresh same-condition pressure1 window. Do not reuse the consumed grant or repeat this run. Source/light work continues independently.
