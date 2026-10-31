package main_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	cmttypes "github.com/cometbft/cometbft/types"
)

// These are rejection-only transport inputs. They do not contain real PQ
// signatures, bootstrap authority or an admitted engine snapshot, and must
// never produce a verified layer. Original positive math fixtures stay in CORE.
func pqNegativeTarget(t *testing.T) (*receipt.PQReceiptTrust, bftgateway.PQFinalityView, string) {
	t.Helper()
	wire := []byte("negative transport only; no signature or authority")
	envelope, err := consensus.EncodePQTransaction(consensus.PQTransferType, wire)
	if err != nil {
		t.Fatal(err)
	}
	outer, native := sha256.Sum256(envelope), sha256.Sum256(wire)
	trust := &receipt.PQReceiptTrust{Expected: consensus.PQTransactionProofExpectation{Block: consensus.PQLightProofExpectation{ChainID: "negative-test", HeaderHeight: 8, StateHeight: 7, BlockHash: bytes.Repeat([]byte{1}, 32), StateAppHash: bytes.Repeat([]byte{2}, 32)}, Successor: consensus.PQLightProofExpectation{ChainID: "negative-test", HeaderHeight: 9, StateHeight: 8, BlockHash: bytes.Repeat([]byte{3}, 32), StateAppHash: bytes.Repeat([]byte{4}, 32)}, TransactionType: consensus.PQTransferType, Envelope: envelope, NativeWire: wire, TransactionHash: outer[:], NativeWireHash: native[:], Index: 0}}
	index := uint32(0)
	light := consensus.PQLightProofRequest{Version: consensus.PQLightProofVersion, CommitResult: []byte("{}"), ValidatorsResult: []byte("{}")}
	proof := &consensus.PQTransactionProofRequest{Version: consensus.PQTransactionProofVersion, Block: light, Successor: light, TransactionProof: []byte("{}"), ExecutionResult: []byte{1}, ExecutionProof: []byte("{}")}
	view := bftgateway.PQFinalityView{Version: receipt.PQCollectorVersion, Source: "negative-test-rpc", Status: "collected", NativeTransactionHash: consensus.SignedTransactionHash(wire), ABCITransactionHash: consensus.SignedTransactionHash(envelope), ExecutionHeight: 8, CometIndex: &index, IndependentFinality: true, ProofVerification: "claimed-verified-by-peer", Proof: proof}
	return trust, view, "0x" + hex.EncodeToString(outer[:])
}
func pqCollectorBytes(t *testing.T, view bftgateway.PQFinalityView) []byte {
	t.Helper()
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func requirePQUnverified(t *testing.T, view receipt.PQProofView) {
	t.Helper()
	if view.Level != receipt.RPCOnly || view.ABCIResultVerified || view.FundsVerified || view.NativeGrant || view.MemberVerified || view.ExecutionVerified || view.SelectedMemberResultVerified {
		t.Fatalf("rejection-only input obtained a verified claim: %+v", view)
	}
}

func TestP09PQCollectorClaimsNeverSupplyIndependentTrust(t *testing.T) {
	_, view, tx := pqNegativeTarget(t)
	out := receipt.VerifyPQNetworkReceipt(tx, nil, pqCollectorBytes(t, view), time.Now())
	requirePQUnverified(t, out)
	if out.Reason != "NOT_SUPPLIED" || out.Source != view.Source {
		t.Fatalf("missing-trust boundary changed: %+v", out)
	}
	view.Proof = nil
	view.Status = "pending"
	view.ObservedExecutionStatus = "succeeded"
	requirePQUnverified(t, receipt.VerifyPQNetworkReceipt(tx, nil, pqCollectorBytes(t, view), time.Now()))
}
func TestP09PQRejectsBadTargetAndUntrustedMember(t *testing.T) {
	trust, view, tx := pqNegativeTarget(t)
	tests := []struct {
		name   string
		change func(*receipt.PQReceiptTrust, *bftgateway.PQFinalityView) string
	}{
		{"requested-other-hash", func(*receipt.PQReceiptTrust, *bftgateway.PQFinalityView) string {
			return "0x" + strings.Repeat("f", 64)
		}},
		{"changed-independent-envelope", func(c *receipt.PQReceiptTrust, _ *bftgateway.PQFinalityView) string {
			c.Expected.Envelope = append(append([]byte{}, c.Expected.Envelope...), byte(' '))
			return tx
		}},
		{"wrong-successor-coordinate", func(c *receipt.PQReceiptTrust, _ *bftgateway.PQFinalityView) string {
			c.Expected.Successor.HeaderHeight += 2
			return tx
		}},
		{"wrong-collector-height", func(_ *receipt.PQReceiptTrust, v *bftgateway.PQFinalityView) string { v.ExecutionHeight++; return tx }},
		{"wrong-collector-index", func(_ *receipt.PQReceiptTrust, v *bftgateway.PQFinalityView) string {
			wrong := uint32(3)
			v.CometIndex = &wrong
			return tx
		}},
		{"wrong-collector-native-hash", func(_ *receipt.PQReceiptTrust, v *bftgateway.PQFinalityView) string {
			v.NativeTransactionHash = "0x" + strings.Repeat("d", 64)
			return tx
		}},
		{"member-on-single-envelope", func(c *receipt.PQReceiptTrust, _ *bftgateway.PQFinalityView) string {
			index := uint32(1)
			c.Member = &index
			return tx
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, v := *trust, view
			target := tt.change(&c, &v)
			out := receipt.VerifyPQNetworkReceipt(target, &c, pqCollectorBytes(t, v), time.Now())
			requirePQUnverified(t, out)
			if out.Reason != "BAD_PROOF" {
				t.Fatalf("target not rejected: %+v", out)
			}
		})
	}
}
func TestP09PQUsesCurrentLocalClockAndRejectsExpiredContext(t *testing.T) {
	trust, view, tx := pqNegativeTarget(t)
	old := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	trust.Light.TrustedLightBlock = &cmttypes.LightBlock{SignedHeader: &cmttypes.SignedHeader{Header: &cmttypes.Header{Time: old}}}
	trust.Light.TrustingPeriod = time.Hour
	trust.Light.Now = old.Add(time.Minute) // The peer/caller's retained clock cannot renew expiry.
	now := old.Add(2 * time.Hour)
	out := receipt.VerifyPQNetworkReceipt(tx, trust, pqCollectorBytes(t, view), now)
	requirePQUnverified(t, out)
	if out.Reason != "EXPIRED" {
		t.Fatalf("local expiry lost: %+v", out)
	}
	if !trust.Light.Now.Equal(old.Add(time.Minute)) {
		t.Fatal("trusted caller context was mutated")
	}
	requirePQUnverified(t, receipt.VerifyPQNetworkReceipt(tx, trust, pqCollectorBytes(t, view), time.Time{}))
}
func TestP09PQMissingOrWrongSuccessorNeverVerifies(t *testing.T) {
	trust, view, tx := pqNegativeTarget(t)
	for _, kind := range []string{"missing-proof", "missing-successor", "wrong-successor-bytes", "incomplete-independent-snapshot"} {
		t.Run(kind, func(t *testing.T) {
			v := view
			p := *view.Proof
			v.Proof = &p
			switch kind {
			case "missing-proof":
				v.Proof = nil
			case "missing-successor":
				p.Successor = consensus.PQLightProofRequest{}
			case "wrong-successor-bytes":
				p.Successor.CommitResult = []byte(`{"header":"different-H+1"}`)
			}
			// No case supplies an admitted independent snapshot. Even an otherwise
			// correctly shaped collector must fail in the original trust verifier.
			out := receipt.VerifyPQNetworkReceipt(tx, trust, pqCollectorBytes(t, v), time.Now())
			requirePQUnverified(t, out)
		})
	}
}
func TestP09PQRejectsStrictOuterAndOriginalProofGrammar(t *testing.T) {
	trust, view, tx := pqNegativeTarget(t)
	good := pqCollectorBytes(t, view)
	inputs := map[string][]byte{
		"duplicate-claim":       bytes.Replace(good, []byte(`"independentFinality":true`), []byte(`"independentFinality":false,"independentFinality":true`), 1),
		"case-alias":            bytes.Replace(good, []byte(`"abciTransactionHash"`), []byte(`"ABCITransactionHash"`), 1),
		"case-shadow":           bytes.Replace(good, []byte(`"status":"collected"`), []byte(`"status":"collected","Status":"verified"`), 1),
		"peer-trust-field":      append(append([]byte{}, good[:len(good)-1]...), []byte(`,"trust":{"root":"self"}}`)...),
		"leading-zero-height":   bytes.Replace(good, []byte(`"executionHeight":"8"`), []byte(`"executionHeight":"08"`), 1),
		"null-claim":            bytes.Replace(good, []byte(`"independentFinality":true`), []byte(`"independentFinality":null`), 1),
		"unknown-proof-field":   bytes.Replace(good, []byte(`"transactionProof"`), []byte(`"trust":true,"transactionProof"`), 1),
		"duplicate-proof-field": bytes.Replace(good, []byte(`"executionResult":"AQ=="`), []byte(`"executionResult":"Ag==","executionResult":"AQ=="`), 1),
		"invalid-utf8":          bytes.Replace(good, []byte("negative-test-rpc"), []byte{0xff}, 1),
		"oversized":             bytes.Repeat([]byte{' '}, receipt.MaxPQNetworkReceiptBytes+1),
	}
	for name, raw := range inputs {
		t.Run(name, func(t *testing.T) {
			out := receipt.VerifyPQNetworkReceipt(tx, trust, raw, time.Now())
			requirePQUnverified(t, out)
			if out.Reason != "BAD_PROOF" {
				t.Fatalf("non-strict proof accepted: %+v", out)
			}
		})
	}
}

func TestP09PQBatchSelectionUsesOriginalMemberIdentity(t *testing.T) {
	// Codec-only negative Whole with all-zero placeholder signatures. It has no
	// admitted signature authority and is never asserted to verify cryptography.
	whole := ynxbatch.Whole{Certificate: ynxbatch.Certificate{Descriptor: ynxbatch.Descriptor{Context: ynxbatch.Context{ChainID: make([]byte, 32), Owner: "negative-codec-only", PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize), BatchID: make([]byte, 16), Purpose: "negative-test"}, N: 2, RootA: make([]byte, 64), RootB: make([]byte, 64)}, SigmaA: make([]byte, ynxbatch.SignatureASize), SigmaB: make([]byte, ynxbatch.SignatureBSize)}, Messages: [][]byte{[]byte("untrusted member zero"), []byte("untrusted member one")}}
	wire, err := ynxbatch.EncodeWhole(whole)
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := consensus.EncodePQTransaction(consensus.PQWholeType, wire)
	if err != nil {
		t.Fatal(err)
	}
	trust, view, _ := pqNegativeTarget(t)
	outer, native := sha256.Sum256(envelope), sha256.Sum256(wire)
	trust.Expected.TransactionType = consensus.PQWholeType
	trust.Expected.Envelope = envelope
	trust.Expected.NativeWire = wire
	trust.Expected.TransactionHash = outer[:]
	trust.Expected.NativeWireHash = native[:]
	view.NativeTransactionHash = consensus.SignedTransactionHash(wire)
	view.ABCITransactionHash = consensus.SignedTransactionHash(envelope)
	requested, err := chain.PQBatchTransactionHash(consensus.SignedTransactionHash(wire), 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, index := range []uint32{1, 2} {
		t.Run(string(rune('0'+index)), func(t *testing.T) {
			copy := *trust
			copy.Member = &index
			out := receipt.VerifyPQNetworkReceipt(requested, &copy, pqCollectorBytes(t, view), time.Now())
			requirePQUnverified(t, out)
			if out.Reason != "BAD_PROOF" || !strings.Contains(out.Detail, "所选批成员") {
				t.Fatalf("wrong member mapping not rejected before proof: %+v", out)
			}
		})
	}
}
