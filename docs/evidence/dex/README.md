# DEX candidate evidence

`current-public-state-candidate-2026-08-10.json` is local candidate evidence produced from an integrity-checked copy of the public state at height 931436. Four independent application instances committed the same six DEX actions, reached the same AppHash and durable-state digest, rejected an expired swap, and restored identical state after restart.

The capacity slice performs 400 exact concurrent committed-state reads with 25 local workers after restart. Its class is deliberately recorded as `local-one-process-current-public-state-copy-not-public-slo`: it is useful regression and shared-use evidence, but is not a public availability, multi-host, sustained-load, or million-user claim.

Public cutover remains blocked until all real validator hosts are reachable and the protected four-validator migration, quorum, stop/restart/catch-up, rollback, and public ingress gates pass.
