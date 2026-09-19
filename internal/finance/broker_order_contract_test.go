package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func loadFinanceApprovalVector(t *testing.T) FinanceOrderApprovalV1 {
	t.Helper()
	raw, err := os.ReadFile("../../apps/finance/integration/wallet-auth/finance-order-approval-v1.vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Positive struct {
			Unsigned       FinanceOrderApprovalUnsignedV1 `json:"unsigned"`
			Signature      string                         `json:"signature"`
			ApprovalDigest string                         `json:"approvalDigest"`
			OrderHash      string                         `json:"orderHash"`
		} `json:"positive"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	approval := FinanceOrderApprovalV1{FinanceOrderApprovalUnsignedV1: envelope.Positive.Unsigned, Signature: envelope.Positive.Signature}
	digest, err := VerifyFinanceOrderApprovalV1(approval, time.Date(2026, 9, 19, 9, 1, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if digest != envelope.Positive.ApprovalDigest {
		t.Fatalf("digest=%s", digest)
	}
	if hash, err := FinanceOrderHash(approval.Order); err != nil || hash != envelope.Positive.OrderHash {
		t.Fatalf("hash=%s err=%v", hash, err)
	}
	return approval
}

func TestFinanceApprovalFrozenPositiveVector(t *testing.T) {
	approval := loadFinanceApprovalVector(t)
	subject, err := DeriveFinanceSubjectID(approval.Account)
	if err != nil || subject != approval.SubjectID {
		t.Fatalf("subject=%s err=%v", subject, err)
	}
}

func TestFinanceApprovalRejectsExactMoneyAndTamper(t *testing.T) {
	approval := loadFinanceApprovalVector(t)
	cases := []struct {
		name   string
		mutate func(*FinanceOrderApprovalV1)
	}{
		{"trailing-zero", func(value *FinanceOrderApprovalV1) { value.Order.LimitPrice = "125.340" }},
		{"wrong-cost", func(value *FinanceOrderApprovalV1) { value.Order.MaxCost = "251.92" }},
		{"fractional-share", func(value *FinanceOrderApprovalV1) { value.Order.Qty = "2.5" }},
		{"live", func(value *FinanceOrderApprovalV1) { value.TradingEnvironment = "live" }},
		{"native", func(value *FinanceOrderApprovalV1) { value.Platform = "native" }},
		{"subject", func(value *FinanceOrderApprovalV1) { value.SubjectID = "subject_" + string(make([]byte, 64)) }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			changed := approval
			test.mutate(&changed)
			if _, err := VerifyFinanceOrderApprovalV1(changed, time.Date(2026, 9, 19, 9, 1, 0, 0, time.UTC)); err == nil {
				t.Fatal("tamper accepted")
			}
		})
	}
}

func TestFinanceCanonicalDigestIsStable(t *testing.T) {
	value := map[string]any{"platform": "web", "account": "a", "applicationId": "b", "productClientId": "c"}
	want := sha256.Sum256([]byte("YNX_FINANCE_SUBJECT_V1\n{\"account\":\"a\",\"applicationId\":\"b\",\"platform\":\"web\",\"productClientId\":\"c\"}"))
	if got := digestFinanceCanonical(FinanceSubjectDomain, value); got != hex.EncodeToString(want[:]) {
		t.Fatalf("got %s", got)
	}
}

func TestFinanceApprovalCallbackStrictTransport(t *testing.T) {
	approval := loadFinanceApprovalVector(t)
	callback := map[string]any{"approval": approval, "callbackStateHash": approval.CallbackStateHash, "kind": "finance_order_approval_result", "requestId": approval.RequestID, "status": "approved", "version": "1"}
	raw := mustFinanceCanonical(callback)
	parsed, err := ParseFinanceOrderApprovalCallbackV1(raw)
	if err != nil || parsed.Approval == nil || parsed.RequestID != approval.RequestID {
		t.Fatalf("parsed=%+v err=%v", parsed, err)
	}
	duplicate := []byte(`{"kind":"finance_order_approval_result","kind":"finance_order_approval_result","status":"rejected","version":"1","requestId":"request_66666666-7777-4888-8999-000000000000","callbackStateHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reason":"USER_REJECTED"}`)
	if _, err := ParseFinanceOrderApprovalCallbackV1(duplicate); err == nil {
		t.Fatal("duplicate key accepted")
	}
	unknown := []byte(`{"kind":"finance_order_approval_result","status":"rejected","version":"1","requestId":"request_66666666-7777-4888-8999-000000000000","callbackStateHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reason":"USER_REJECTED","callback":"https://attacker.invalid"}`)
	if _, err := ParseFinanceOrderApprovalCallbackV1(unknown); err == nil {
		t.Fatal("arbitrary callback accepted")
	}
	nonCanonical, _ := json.MarshalIndent(callback, "", "  ")
	if _, err := ParseFinanceOrderApprovalCallbackV1(nonCanonical); err == nil {
		t.Fatal("non-canonical callback accepted")
	}
}

func TestManualAndAIDraftsUseSameDeterministicExactRules(t *testing.T) {
	input := BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "125.34"}
	order, err := BuildBrokerOrderDraft(input, "1.25", "operator_policy")
	if err != nil || order.MaxCost != "251.93" || order.OrderID == "" {
		t.Fatalf("order=%+v err=%v", order, err)
	}
	input.Side = "sell"
	order, err = BuildBrokerOrderDraft(input, "1.25", "operator_policy")
	if err != nil || order.MaxCost != "1.25" {
		t.Fatalf("sell=%+v err=%v", order, err)
	}
	input.Qty = "2.5"
	if _, err := BuildBrokerOrderDraft(input, "1.25", "operator_policy"); err == nil {
		t.Fatal("fractional AI draft accepted")
	}
}
