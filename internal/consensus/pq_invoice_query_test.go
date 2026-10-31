package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
)

func invoiceQuery(t *testing.T, f *invoiceMoneyFixture, id string) PQInvoiceView {
	t.Helper()
	r, err := f.a.Query(context.Background(), &abci.RequestQuery{Path: PQInvoiceQueryPath + f.owner + "/" + id})
	var v PQInvoiceView
	if err != nil || r.Code != 0 || strictPQActionJSON(r.Value, &v) != nil {
		t.Fatalf("real invoice query: %v %+v", err, r)
	}
	if err = ValidatePQInvoiceView(v, f.owner, id, r.Height); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestPQInvoiceQueryOriginalPrefixRecoveryAndResultProofContract(t *testing.T) {
	f := newInvoiceMoneyFixture(t)
	termsRaw := f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("query-original", 17), 2)
	terms := invoiceEffect(t, f.commit(t, []bool{true}, termsRaw).TxResults[0])
	paidRaw := f.settle(t, terms, 17, 2)
	paid := invoiceEffect(t, f.commit(t, []bool{true}, paidRaw).TxResults[0])
	refundRaw := f.refund(t, terms, paid, "refund-one", 5, 3)
	refund := invoiceEffect(t, f.commit(t, []bool{true}, refundRaw).TxResults[0])
	current := invoiceQuery(t, f, terms.InvoiceID)
	if current.Record.RefundedAtoms != 5 || len(current.History) != 3 || len(current.Authorizations) != 2 {
		t.Fatal("incomplete original invoice query")
	}
	for i, raw := range [][]byte{termsRaw, paidRaw, refundRaw} {
		wire, _, err := DecodePQActionTransport(raw)
		if err != nil {
			t.Fatal(err)
		}
		v := actionHistoryQuery(t, f.a, SignedTransactionHash(wire))
		data, err := PQInvoiceActionResult(v, f.a.committed.Height)
		if err != nil {
			t.Fatal(err)
		}
		want := []PQInvoiceEffect{terms, paid, refund}[i]
		if !bytes.Equal(data, mustJSON(t, want)) {
			t.Fatal("later refund rewrote earlier invoice result")
		}
		got, err := ValidatePQInvoiceEffectData(wire, raw, uint64(want.Height), data)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatal("effect original binding", err)
		}
		outcome, ok, _, err := pqTransactionOutcome(PQActionType, wire, raw, want.Height, &abci.ExecTxResult{Data: data})
		if err != nil || !ok || outcome != "succeeded" {
			t.Fatal("actual finality result contract", err)
		}
		if _, _, _, err = pqTransactionOutcome(PQActionType, wire, raw, want.Height, &abci.ExecTxResult{Code: 1, Data: data}); err == nil {
			t.Fatal("failed execution accepted successful invoice data")
		}
		if _, _, _, err = pqTransactionOutcome(PQActionType, wire, raw, want.Height, &abci.ExecTxResult{Data: []byte(SignedTransactionHash(raw))}); err == nil {
			t.Fatal("invoice accepted old hash-only success data")
		}
	}
	f.cold(t)
	if after := invoiceQuery(t, f, terms.InvoiceID); !reflect.DeepEqual(current, after) {
		t.Fatal("cold query lost exact invoice originals")
	}
	// Finalize changes only pending; a query cannot publish the next refund.
	raw := f.refund(t, terms, paid, "refund-two", 2, 4)
	if _, err := f.a.FinalizeBlock(context.Background(), f.request(raw)); err != nil {
		t.Fatal(err)
	}
	if after := invoiceQuery(t, f, terms.InvoiceID); !reflect.DeepEqual(current, after) {
		t.Fatal("pending invoice leaked into committed query")
	}
	if _, err := f.a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	paidWire, _, err := DecodePQActionTransport(paidRaw)
	if err != nil {
		t.Fatal(err)
	}
	h := uint64(f.a.committed.Height + 1)
	f.commit(t, []bool{true}, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 5, h, 1)))
	f.commit(t, []bool{})
	f.cold(t)
	postRevoke := invoiceQuery(t, f, terms.InvoiceID)
	if postRevoke.Record.RefundedAtoms != 7 || len(postRevoke.History) != 4 {
		t.Fatal("later revocation removed historical invoice execution")
	}
	historical := actionHistoryQuery(t, f.a, SignedTransactionHash(paidWire))
	data, err := PQInvoiceActionResult(historical, f.a.committed.Height)
	if err != nil || !bytes.Equal(data, mustJSON(t, paid)) {
		t.Fatal("later revocation reclassified original lawful invoice payment", err)
	}
}

func TestPQInvoiceQueryRejectsTamperedHistoryEffectsAndSubjects(t *testing.T) {
	f := newInvoiceMoneyFixture(t)
	raw := f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("query-negative", 13), 2)
	terms := invoiceEffect(t, f.commit(t, []bool{true}, raw).TxResults[0])
	paidRaw := f.settle(t, terms, 13, 2)
	paid := invoiceEffect(t, f.commit(t, []bool{true}, paidRaw).TxResults[0])
	refundRaw := f.refund(t, terms, paid, "r1", 3, 3)
	result := f.commit(t, []bool{true}, refundRaw).TxResults[0]
	view := invoiceQuery(t, f, terms.InvoiceID)
	clone := func() PQInvoiceView {
		var v PQInvoiceView
		if json.Unmarshal(mustJSON(t, view), &v) != nil {
			t.Fatal("clone")
		}
		return v
	}
	oversized := clone()
	for total := len(oversized.History[0]); total <= MaxPQWalletQueryBytes; total += len(oversized.History[0]) {
		oversized.History = append(oversized.History, oversized.History[0])
	}
	if err := ValidatePQInvoiceView(oversized, f.owner, terms.InvoiceID, view.CommittedHeight); err == nil || !strings.Contains(err.Error(), "bounded query input") {
		t.Fatal("oversized prefix did not fail before signature/replay work", err)
	}
	for name, mutate := range map[string]func(*PQInvoiceView){
		"terms-message":    func(v *PQInvoiceView) { v.Record.TermsMessage[0] ^= 1 },
		"omit-settlement":  func(v *PQInvoiceView) { v.History = append(v.History[:1], v.History[2:]...) },
		"current-refund":   func(v *PQInvoiceView) { v.Record.RefundedAtoms++ },
		"payer":            func(v *PQInvoiceView) { v.Record.Settlement.From = f.owner },
		"wrong-checkpoint": func(v *PQInvoiceView) { v.Authorizations[0].CommittedAppHash = "00" + v.CommittedAppHash[2:] },
		"extra-policy":     func(v *PQInvoiceView) { v.Authorizations = append(v.Authorizations, v.Authorizations[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			v := clone()
			mutate(&v)
			if ValidatePQInvoiceView(v, f.owner, terms.InvoiceID, v.CommittedHeight) == nil {
				t.Fatal("tampered invoice observation accepted")
			}
		})
	}
	wire, _, _ := DecodePQActionTransport(refundRaw)
	for _, branch := range []string{"A", "B"} {
		t.Run("prefix-signature-"+branch, func(t *testing.T) {
			v := clone()
			var entry PQCommittedAuthorization
			if err := json.Unmarshal(v.History[0], &entry); err != nil {
				t.Fatal(err)
			}
			_, signed, _, _, err := decodePQInvoiceHistory(entry)
			if err != nil {
				t.Fatal(err)
			}
			member, err := ynxbatch.DecodeMember(signed)
			if err != nil {
				t.Fatal(err)
			}
			if branch == "A" {
				member.Certificate.SigmaA[0] ^= 1
			} else {
				member.Certificate.SigmaB[0] ^= 1
			}
			badWire, err := ynxbatch.EncodeMember(member)
			if err != nil {
				t.Fatal(err)
			}
			badRaw, err := EncodePQNativeActionTransaction(badWire)
			if err != nil {
				t.Fatal(err)
			}
			entry.Transaction.Hash = SignedTransactionHash(badWire)
			entry.ABCITransactionHash = SignedTransactionHash(badRaw)
			entry.Transaction.Memo = pqInvoiceHistoryMemo + fmt.Sprintf("%x", badRaw)
			v.History[0] = mustJSON(t, entry)
			if ValidatePQInvoiceView(v, f.owner, terms.InvoiceID, v.CommittedHeight) == nil {
				t.Fatal("invalid original dual-signature branch accepted")
			}
		})
	}
	history := actionHistoryQuery(t, f.a, SignedTransactionHash(wire))
	for name, mutate := range map[string]func(*pqActionEffects){
		"missing-fee":            func(e *pqActionEffects) { e.Fee = nil },
		"wrong-fee-kind":         func(e *pqActionEffects) { e.Fee.TransactionType = PQActionType },
		"missing-transfer":       func(e *pqActionEffects) { e.Invoice.Transfer = nil },
		"wrong-transfer-account": func(e *pqActionEffects) { e.Invoice.Transfer.From = f.other },
		"wrong-historical-total": func(e *pqActionEffects) { e.Invoice.Result.Refunded++ },
	} {
		t.Run("history-"+name, func(t *testing.T) {
			v := history
			var e pqActionEffects
			if err := strictPQActionJSON(v.Effects, &e); err != nil {
				t.Fatal(err)
			}
			mutate(&e)
			v.Effects = mustJSON(t, e)
			if _, _, err := ValidatePQActionHistoryView(v, f.a.committed.Height); err == nil {
				t.Fatal("unexecuted invoice effect accepted")
			}
		})
	}
	var effect PQInvoiceEffect
	if json.Unmarshal(result.Data, &effect) != nil {
		t.Fatal("effect")
	}
	for name, mutate := range map[string]func(*PQInvoiceEffect){
		"native-hash": func(e *PQInvoiceEffect) { e.NativeHash = e.ABCIHash }, "height": func(e *PQInvoiceEffect) { e.Height++ }, "member": func(e *PQInvoiceEffect) { e.Member++ }, "event": func(e *PQInvoiceEffect) { e.Event++ }, "fee": func(e *PQInvoiceEffect) { e.Fee++ }, "genesis": func(e *PQInvoiceEffect) { e.Genesis = "00" + e.Genesis[2:] }, "asset": func(e *PQInvoiceEffect) { e.AssetID = "ETH" }, "principal": func(e *PQInvoiceEffect) { e.Principal++ }, "underflow": func(e *PQInvoiceEffect) { e.Refunded = e.Paid + 1 }, "self-refund": func(e *PQInvoiceEffect) { e.Payer = e.Merchant; e.Recipient = e.Merchant }, "settlement": func(e *PQInvoiceEffect) { e.SettlementNativeHash = e.NativeHash },
	} {
		t.Run("data-"+name, func(t *testing.T) {
			v := effect
			mutate(&v)
			if _, err := ValidatePQInvoiceEffectData(wire, refundRaw, uint64(effect.Height), mustJSON(t, v)); err == nil {
				t.Fatal("tampered invoice execution data accepted")
			}
		})
	}
	for _, data := range [][]byte{append(result.Data, ' '), append([]byte(`{"extra":1,`), result.Data[1:]...), append([]byte(`{"version":"ignored",`), result.Data[1:]...)} {
		if _, err := ValidatePQInvoiceEffectData(wire, refundRaw, uint64(effect.Height), data); err == nil {
			t.Fatal("noncanonical/duplicate/unknown effect accepted")
		}
	}
	for _, req := range []*abci.RequestQuery{{Path: PQInvoiceQueryPath + f.owner + "/" + terms.InvoiceID, Prove: true}, {Path: PQInvoiceQueryPath + f.owner + "/" + terms.InvoiceID, Height: 1}, {Path: PQInvoiceQueryPath + f.owner + "/" + terms.InvoiceID, Data: []byte{1}}, {Path: PQInvoiceQueryPath + f.owner + "/../" + terms.InvoiceID}, {Path: PQInvoiceQueryPath + f.other + "/" + terms.InvoiceID}} {
		r, err := f.a.Query(context.Background(), req)
		if err != nil || r.Code == 0 {
			t.Fatal("unbound invoice query accepted", err)
		}
	}
}
