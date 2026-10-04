# Exact Testnet submitted-position risk bounds

Source commit: 793828cf0fe2edbf9393295b41254c482f69c416.
Tree: 6fa05e6a0614b2b8681e9155902f2e13fcbddec1.

The existing Testnet risk path summed persisted submitted order amounts in int64 and compared `abs(position + signedAmount)` to the mandate limit. Two maximum buys plus a buy of 2 wrap to zero; a maximum sell plus a sell of 1 produces MinInt64 whose absolute value also remains negative. Either could falsely pass the position bound.

Admission now sums exact signed amounts using math/big (already an engine dependency), then compares the exact projected absolute amount against the existing mandate limit. This is independent of Go map iteration order; offsetting large historical submissions are not rejected merely because an intermediate int64 sum would overflow. Nonpositive historical amounts or unknown sides for this mandate's submitted orders fail closed before reservation, audit, save or Broker invocation. No mandate, authorization, fee, settlement or venue protocol was changed.

Actual regression uses controlled persisted legacy state and the original engine: positive wrap-to-zero, negative MinInt64 projection, positive projection wrap, unknown side, zero/negative historical amount, and large offsetting submissions. Rejected cases assert zero Broker calls, unchanged in-memory state and unchanged durable state after reopening. Only the valid net-offset case makes one controlled Broker call.

Checks executed:

- `go test -race ./internal/quantlab -run TestTestnetPositionBoundsAreExactAcrossPersistedHistory -count=10`: PASS, 1.873 seconds (7 cases repeated 10 times).
- `go test -race ./internal/quantlab -count=1 -timeout=180s`: PASS, 5.661 seconds.
- gofmt and `git diff --check`: PASS.

No opt-in PostgreSQL URL was configured, so this run does not claim new PostgreSQL acceptance. No live provider approval, account signature, Testnet execution, public deployment or installed release was performed. The position remains the service's submitted-order exposure measure, not an assertion of venue fills or settlement. Formal composition/deployment and direct authorized business verification remain separate A-owned gates.
