package executionstate

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func ledgerFixture(t *testing.T, raw string) (*streamAudit, *Report) {
	t.Helper()
	m, err := decode([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	r := &Report{Streaming: &StreamEvidence{}}
	return &streamAudit{retained: m, r: r, limits: DefaultStreamLimits()}, r
}
func TestNativeLedgerDistinguishesUntracedLiquidAndPoolBacking(t *testing.T) {
	a, r := ledgerFixture(t, `{"accounts":{"private-account":{"balance":80,"staked":20,"lots":{"private-lot":70}}},"lots":{"private-lot":{"amount":100,"origin":"devnet faucet mint"}},"dexPools":{"private-pool":{"asset0":"YNXT","reserve0":30,"nativeLots0":{"private-lot":30}}}}`)
	if err := a.ledgerState(); err != nil {
		t.Fatal(err)
	}
	l := r.NativeLedger
	if !l.FinalStateComplete || l.ExecutionReplayProven || l.Amounts["backingMinusMetadata"] != "0" || l.Amounts["nativePoolLotsMinusReserves"] != "0" || l.AccountGroups["otherAccounts"].LotMinusLiquid != "-10" || len(r.Issues) != 0 {
		t.Fatal(l, r.Issues)
	}
	r.ledgerTransaction(map[string]any{"type": "private-payload", "memo": "private-memo", "amount": json.Number("1"), "from": "private-account"})
	b, _ := json.Marshal(l)
	if strings.Contains(string(b), "private-") || l.Transactions["other"].Count != 1 {
		t.Fatal("diagnostic leaked input values")
	}
}
func TestNativeLedgerDetectsOffsettingPerLotCorruption(t *testing.T) {
	a, r := ledgerFixture(t, `{"accounts":{"a":{"balance":100,"lots":{"x":60,"y":40}}},"lots":{"x":{"amount":50},"y":{"amount":50}}}`)
	if err := a.ledgerState(); err != nil {
		t.Fatal(err)
	}
	l := r.NativeLedger
	if l.Amounts["backingMinusMetadata"] != "0" || l.Counts["metadataLotsWithBackingDelta"] != 2 || l.Amounts["sumPositivePerLotBackingDelta"] != "10" || l.Amounts["sumNegativePerLotBackingDelta"] != "-10" || !has(*r, "NATIVE_LOT_BACKING_RECONCILIATION_FAILED") {
		t.Fatal(l, r.Issues)
	}
}
func TestNativeLedgerExactBigTotalsAndBudgetFailure(t *testing.T) {
	a, r := ledgerFixture(t, `{"accounts":{"a":{"balance":9223372036854775807,"lots":{"x":9223372036854775807}},"b":{"balance":9223372036854775807,"lots":{"y":9223372036854775807}}},"lots":{"x":{"amount":9223372036854775807},"y":{"amount":9223372036854775807}}}`)
	if err := a.ledgerState(); err != nil {
		t.Fatal(err)
	}
	if r.NativeLedger.Amounts["metadataLotIssued"] != "18446744073709551614" {
		t.Fatal(r.NativeLedger.Amounts)
	}
	a, r = ledgerFixture(t, `{"accounts":{"a":{"lots":{"unknown":1}}}}`)
	a.limits.MaxCaptureBytes = 1
	if err := a.ledgerState(); err == nil || r.NativeLedger.FinalStateComplete {
		t.Fatal("aggregate index exceeded budget without failing")
	}
}
func TestNativeLedgerStreamingKeepsProofFlagsFalse(t *testing.T) {
	m, o := streamFixture(t)
	b, o := seal(t, m, o)
	r := AuditNativeStream(bytes.NewReader(b), o, DefaultStreamLimits())
	if r.NativeLedger == nil || !r.NativeLedger.FinalStateComplete || r.NativeLedger.ExecutionReplayProven || r.MigrationSafe || r.Verified.CommittedStateBindingProven {
		t.Fatal("unexpected ledger evidence boundary")
	}
	r = AuditNativeStream(bytes.NewReader(b[:len(b)-1]), o, DefaultStreamLimits())
	if r.NativeLedger != nil && r.NativeLedger.FinalStateComplete {
		t.Fatal("incomplete stream marked complete")
	}
}
