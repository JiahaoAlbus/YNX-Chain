package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

type invoiceMoneyFixture struct {
	*abciRevocationFixture
	bootstrap     *ConsensusBootstrap
	authorization *PQInvoiceAuthorization
}

// Funding, account policy and both registrations come through the original
// native/ABCI APIs. No balances, nonces or policy records are injected.
func newInvoiceMoneyFixture(t *testing.T) *invoiceMoneyFixture {
	t.Helper()
	f := newABCIRevocationFixture(t)
	for _, owner := range []string{f.owner, f.other} {
		if _, err := f.d.Faucet(owner, 500); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	m, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, v := range m.Validators {
		private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(101 + i)}, ed25519.SeedSize))
		public := private.Public().(ed25519.PublicKey)
		sum := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(sum[:20]))})
		clear(private)
	}
	f.m, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCometGenesis(f.m, time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	b, err := NewConsensusBootstrap(raw, ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: f.m.OriginalGenesisHash, MigrationStateHash: f.m.StateHash}, f.m)
	if err != nil {
		t.Fatal(err)
	}
	f.path = filepath.Join(t.TempDir(), "invoice-original.json")
	f.a, err = NewPersistentApplicationWithBootstrap(f.m, f.path, b)
	if err != nil {
		t.Fatal(err)
	}
	vf := &validatorRegistryFixture{doc: doc}
	if _, err = f.a.InitChain(context.Background(), vf.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	x := &invoiceMoneyFixture{abciRevocationFixture: f, bootstrap: b}
	h := f.a.committed.Height + 1
	x.commit(t, []bool{true, true}, mustPQEnvelope(t, PQMigrationType, f.registration(t, false, uint64(h+1))), mustPQEnvelope(t, PQMigrationType, f.registration(t, true, uint64(h+1))))
	x.authorization, _ = invoiceAuthorizationFor(t, f.a)
	// This test activates at its very next committed block; the independently
	// supplied pin is built from the actual initialized registration checkpoint.
	s, _ := x.authorization.Schedule()
	s.ActivationHeight = s.AuthorizedAt
	x.authorization = invoiceAuthorizationFrom(t, s)
	f.a, err = NewPersistentApplicationWithInvoiceAuthorization(f.m, f.path, b, nil, nil, x.authorization)
	if err != nil {
		t.Fatal(err)
	}
	return x
}

func (f *invoiceMoneyFixture) request(raw ...[]byte) *abci.RequestFinalizeBlock {
	h := f.a.committed.Height + 1
	return &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(1900000000+h, 0).UTC(), NextValidatorsHash: bytes.Clone(f.a.bootstrap.validatorSetHash), Txs: raw}
}

func invoiceMoneyProjection(t *testing.T, s CommittedState) []byte {
	t.Helper()
	return mustJSON(t, struct {
		Accounts  []chain.ConsensusAccount
		Lots      map[string]chain.TrustTraceLot
		Ledger    *PQInvoiceLedger
		History   []PQCommittedAuthorization
		Fees      []BFTFeeEvent
		Transfers []BFTNativeTransfer
	}{s.Accounts, s.TraceLots, s.InvoiceLedger, s.PQHistory, s.FeeEvents, s.NativeTransfers})
}

// Exercise actual read-only admission, adversarial Process/Finalize, atomic
// publication and the original durable writer for every candidate batch.
func (f *invoiceMoneyFixture) commit(t *testing.T, success []bool, raw ...[]byte) *abci.ResponseFinalizeBlock {
	t.Helper()
	if len(success) != len(raw) {
		t.Fatal("fixture result count")
	}
	ctx := context.Background()
	a := f.a
	r := f.request(raw...)
	before := mustJSON(t, a.committed)
	disk, readErr := os.ReadFile(f.path)
	if readErr != nil && !os.IsNotExist(readErr) {
		t.Fatal(readErr)
	}
	prepared, err := a.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: r.Height, Time: r.Time, NextValidatorsHash: r.NextValidatorsHash, MaxTxBytes: math.MaxInt64, Txs: raw})
	if err != nil {
		t.Fatal(err)
	}
	var accepted [][]byte
	for i, ok := range success {
		if ok {
			accepted = append(accepted, raw[i])
		}
	}
	if len(prepared.Txs) != len(accepted) {
		t.Fatalf("prepare count %d != %d", len(prepared.Txs), len(accepted))
	}
	for i := range accepted {
		if !bytes.Equal(prepared.Txs[i], accepted[i]) {
			t.Fatal("prepare changed exact accepted original")
		}
	}
	proposal, err := a.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: r.Height, Time: r.Time, NextValidatorsHash: r.NextValidatorsHash, Txs: raw})
	if err != nil {
		t.Fatal(err)
	}
	if (proposal.Status == abci.ResponseProcessProposal_ACCEPT) != (len(accepted) == len(raw)) {
		t.Fatal("process admitted invalid invoice candidate", proposal.Status)
	}
	valid, err := a.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: r.Height, Time: r.Time, NextValidatorsHash: r.NextValidatorsHash, Txs: accepted})
	if err != nil || valid.Status != abci.ResponseProcessProposal_ACCEPT {
		t.Fatal("prepared originals were not executable", err)
	}
	if !bytes.Equal(before, mustJSON(t, a.committed)) || a.pending != nil {
		t.Fatal("admission changed committed invoice/account state")
	}
	response, err := a.FinalizeBlock(ctx, r)
	if err != nil {
		t.Fatal("finalize invoice block", err)
	}
	for i, want := range success {
		if (response.TxResults[i].Code == 0) != want {
			t.Fatalf("tx %d success=%v: code=%d log=%s", i, want, response.TxResults[i].Code, response.TxResults[i].Log)
		}
	}
	if !bytes.Equal(before, mustJSON(t, a.committed)) {
		t.Fatal("Finalize published an uncommitted invoice")
	}
	if after, afterErr := os.ReadFile(f.path); !bytes.Equal(disk, after) || os.IsNotExist(readErr) != os.IsNotExist(afterErr) || (readErr == nil) != (afterErr == nil) {
		t.Fatal("Finalize changed original disk")
	}
	if len(accepted) == 0 && a.committed.InvoiceLedger != nil && !bytes.Equal(invoiceMoneyProjection(t, a.committed), invoiceMoneyProjection(t, *a.pending)) {
		t.Fatal("all rejected candidates changed balances/nonce/lots/slot/history/fees")
	}
	if _, err = a.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal("commit invoice block", err)
	}
	return response
}

func (f *invoiceMoneyFixture) check(t *testing.T, raw []byte, success bool) {
	t.Helper()
	before := mustJSON(t, f.a.committed)
	disk, _ := os.ReadFile(f.path)
	r, e := f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
	if e != nil || (r.Code == 0) != success {
		t.Fatalf("invoice CheckTx success=%v response=%+v err=%v", success, r, e)
	}
	if !bytes.Equal(before, mustJSON(t, f.a.committed)) {
		t.Fatal("CheckTx changed invoice/account state")
	}
	if after, _ := os.ReadFile(f.path); !bytes.Equal(disk, after) {
		t.Fatal("CheckTx changed original file")
	}
}

func (f *invoiceMoneyFixture) wire(t *testing.T, other bool, kind string, payload any, nonce uint64) []byte {
	t.Helper()
	key, owner := f.key, f.owner
	if other {
		key, owner = f.otherKey, f.other
	}
	wire := pqABCIContractWire(t, f.abciRevocationFixture, key, owner, kind, payload, nonce, ynxauth.InvoiceActionFee)
	raw, e := EncodePQNativeActionTransaction(wire)
	if e != nil {
		t.Fatal(e)
	}
	return raw
}

func (f *invoiceMoneyFixture) terms(id string, amount uint64) ynxauth.InvoiceTermsPayload {
	return ynxauth.InvoiceTermsPayload{InvoiceID: id, SessionID: "session-original", Recipient: f.owner, Payer: f.other, AssetID: "YNXT", UnitVersion: "1", FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: 1, Amount: amount, MaxFee: 1, ExpiresAt: 1000}
}

func invoiceEffect(t *testing.T, result *abci.ExecTxResult) PQInvoiceEffect {
	t.Helper()
	var effect PQInvoiceEffect
	if result.Code != 0 || json.Unmarshal(result.Data, &effect) != nil || effect.Version != PQInvoiceEffectVersion {
		t.Fatal("missing actual committed invoice result", result)
	}
	return effect
}

func invoiceHashBytes(t *testing.T, s string) []byte {
	t.Helper()
	b, e := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if e != nil || len(b) != 32 {
		t.Fatal("invalid actual hash", s, e)
	}
	return b
}

func (f *invoiceMoneyFixture) settle(t *testing.T, terms PQInvoiceEffect, amount, nonce uint64) []byte {
	return f.wire(t, true, ynxauth.ActionInvoiceSettle, ynxauth.InvoiceSettlePayload{Merchant: f.owner, InvoiceID: terms.InvoiceID, TermsHash: invoiceHashBytes(t, terms.TermsHash), Amount: amount}, nonce)
}

func (f *invoiceMoneyFixture) refund(t *testing.T, terms, paid PQInvoiceEffect, id string, amount, nonce uint64) []byte {
	return f.wire(t, false, ynxauth.ActionInvoiceRefund, ynxauth.InvoiceRefundPayload{InvoiceID: terms.InvoiceID, RefundID: id, TermsHash: invoiceHashBytes(t, terms.TermsHash), SettlementHash: invoiceHashBytes(t, paid.NativeHash), Amount: amount}, nonce)
}

func invoiceLotTotal(a chain.ConsensusAccount) int64 {
	var n int64
	for _, v := range a.Lots {
		n += v
	}
	return n
}

func (f *invoiceMoneyFixture) cold(t *testing.T) {
	t.Helper()
	before := mustJSON(t, f.a.committed)
	original, _ := os.ReadFile(f.path)
	a, e := NewPersistentApplicationWithInvoiceAuthorization(f.m, f.path, f.bootstrap, nil, nil, f.authorization)
	if e != nil {
		t.Fatal("cold invoice checkpoint", e)
	}
	response, e := a.Query(context.Background(), &abci.RequestQuery{Path: "/state"})
	if e != nil || response.Code != 0 {
		t.Fatal("cold actual state query", e)
	}
	var state CommittedState
	if json.Unmarshal(response.Value, &state) != nil || !bytes.Equal(before, mustJSON(t, state)) {
		t.Fatal("cold state query lost invoice originals")
	}
	if after, _ := os.ReadFile(f.path); !bytes.Equal(original, after) {
		t.Fatal("cold query/recovery changed source bytes")
	}
	f.a = a
}

func TestPQInvoiceLedgerRealMoneySlotRefundFeesAndColdRecovery(t *testing.T) {
	f := newInvoiceMoneyFixture(t)
	merchantBefore, payerBefore, feeBefore := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, f.other), queryConsensusAccount(t, f.a, f.a.feeRecipient)
	termsRaw := f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("invoice-100", 100), 2)
	f.check(t, termsRaw, true)
	terms := invoiceEffect(t, f.commit(t, []bool{true}, termsRaw).TxResults[0])
	cheap := f.settle(t, terms, 1, 2)
	f.check(t, cheap, false)
	f.commit(t, []bool{false}, cheap)
	if f.a.committed.InvoiceLedger.Records[0].Settlement != nil {
		t.Fatal("one-atom attack occupied the hundred-atom slot")
	}
	paidRaw, nextNonce := f.settle(t, terms, 100, 2), f.settle(t, terms, 100, 3)
	f.check(t, paidRaw, true)
	f.check(t, paidRaw, true)
	paid := invoiceEffect(t, f.commit(t, []bool{true, false}, paidRaw, nextNonce).TxResults[0])
	refundRaw := f.refund(t, terms, paid, "refund-30", 30, 3)
	f.check(t, refundRaw, true)
	refund := invoiceEffect(t, f.commit(t, []bool{true}, refundRaw).TxResults[0])
	if paid.Principal != 100 || paid.Fee != 1 || paid.Paid != 100 || refund.Principal != 30 || refund.Fee != 1 || refund.Refunded != 30 || refund.NetPaid != 70 || refund.Recipient != f.other || terms.Principal != 0 || terms.Fee != 1 {
		t.Fatal("actual result conflated principal, fee or refund", terms, paid, refund)
	}
	merchant, payer, fee := queryConsensusAccount(t, f.a, f.owner), queryConsensusAccount(t, f.a, f.other), queryConsensusAccount(t, f.a, f.a.feeRecipient)
	if merchant.Balance != merchantBefore.Balance+68 || payer.Balance != payerBefore.Balance-71 || fee.Balance != feeBefore.Balance+3 || merchant.Nonce != 3 || payer.Nonce != 2 || merchant.ResourceUsage.BandwidthUsed != merchantBefore.ResourceUsage.BandwidthUsed+2 || payer.ResourceUsage.BandwidthUsed != payerBefore.ResourceUsage.BandwidthUsed+1 || merchant.ResourceUsage.PayCreditsUsed != merchantBefore.ResourceUsage.PayCreditsUsed+2 || payer.ResourceUsage.PayCreditsUsed != payerBefore.ResourceUsage.PayCreditsUsed+1 || merchant.ResourceUsage.ComputeUsed != merchantBefore.ResourceUsage.ComputeUsed || payer.ResourceUsage.ComputeUsed != payerBefore.ResourceUsage.ComputeUsed {
		t.Fatal("real balances/nonces/resources do not conserve 100/30 plus separate fees")
	}
	if invoiceLotTotal(merchant) != invoiceLotTotal(merchantBefore)+68 || invoiceLotTotal(payer) != invoiceLotTotal(payerBefore)-71 || invoiceLotTotal(fee) != invoiceLotTotal(feeBefore)+3 {
		t.Fatal("principal and fees did not move real traceable lots")
	}
	lotTotals := func(accounts ...chain.ConsensusAccount) map[string]int64 {
		lots := map[string]int64{}
		for _, account := range accounts {
			for id, amount := range account.Lots {
				lots[id] += amount
			}
		}
		return lots
	}
	if !bytes.Equal(mustJSON(t, lotTotals(merchantBefore, payerBefore, feeBefore)), mustJSON(t, lotTotals(merchant, payer, fee))) {
		t.Fatal("original per-lot lineage was replaced or destroyed by principal/fee movement")
	}
	for _, e := range []PQInvoiceEffect{terms, paid, refund} {
		expectedPayer := f.owner
		if e.Kind == ynxauth.ActionInvoiceSettle {
			expectedPayer = f.other
		}
		count := 0
		for _, v := range f.a.committed.FeeEvents {
			if v.TxHash == e.ABCIHash {
				count++
				if v.GrossFeeYNXT != 1 || v.BlockHeight != e.Height || v.Recipient != f.a.feeRecipient || v.Payer != expectedPayer || v.BurnYNXT != 0 {
					t.Fatal("wrong actual invoice fee receipt")
				}
			}
		}
		if count != 1 {
			t.Fatal("invoice fee not recorded exactly once", e.Kind, count)
		}
	}
	f.cold(t)
	duplicate := f.refund(t, terms, paid, "refund-30", 1, 4)
	tooLarge := f.refund(t, terms, paid, "refund-over", 71, 4)
	f.check(t, duplicate, false)
	f.check(t, tooLarge, false)
	f.commit(t, []bool{false, false}, duplicate, tooLarge)
	first, second := f.refund(t, terms, paid, "refund-first", 50, 4), f.refund(t, terms, paid, "refund-second", 50, 5)
	e := invoiceEffect(t, f.commit(t, []bool{true, false}, first, second).TxResults[0])
	if e.Refunded != 80 || e.NetPaid != 20 {
		t.Fatal("concurrent refunds exceeded original principal")
	}
	h := uint64(f.a.committed.Height + 1)
	f.commit(t, []bool{true}, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 5, h, 1)))
	postRevoke := f.refund(t, terms, paid, "after-revoke", 1, 6)
	f.check(t, postRevoke, false)
	f.commit(t, []bool{false}, postRevoke)
	f.cold(t)
}

func invoiceDamageBranch(t *testing.T, raw []byte, branch string) []byte {
	t.Helper()
	wire, _, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		t.Fatal(err)
	}
	if branch == "A" {
		member.Certificate.SigmaA[0] ^= 1
	} else {
		member.Certificate.SigmaB[0] ^= 1
	}
	wire, err = ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	result, err := EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestPQInvoiceLedgerCurrentANDNetworkEpochAndInsufficientFundsAreAtomic(t *testing.T) {
	f := newInvoiceMoneyFixture(t)
	ctx := context.Background()
	terms := f.terms("normal", 100)
	valid := f.wire(t, false, ynxauth.ActionInvoiceTerms, terms, 2)
	disabled, err := NewPersistentApplicationWithBootstrap(f.m, f.path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	before := mustJSON(t, disabled.committed)
	off, err := disabled.CheckTx(ctx, &abci.RequestCheckTx{Tx: valid})
	if err != nil || off.Code == 0 || !bytes.Equal(before, mustJSON(t, disabled.committed)) {
		t.Fatal("default-off invoice action was admitted")
	}
	wrongEpoch := terms
	wrongEpoch.InvoiceID = "wrong-epoch"
	wrongEpoch.KeyEpoch = 2
	overflow := terms
	overflow.InvoiceID = "overflow"
	overflow.Amount = math.MaxInt64
	network := bytes.Clone(f.network)
	network[0] ^= 1
	body, _ := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceTerms, terms)
	message, err := (ynxauth.Action{ChainID: network, NativeChainID: uint64(f.m.Network.ChainID), Owner: f.owner, Nonce: 2, Fee: 1, Kind: ynxauth.ActionInvoiceTerms, Payload: body}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, wire := consensusPQProof(t, f.key, network, f.owner, ynxauth.TransactionPurpose, message)
	wrongNetwork, err := EncodePQNativeActionTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	wrongKeyWire := pqABCIContractWire(t, f.abciRevocationFixture, f.otherKey, f.owner, ynxauth.ActionInvoiceTerms, terms, 2, 1)
	wrongKey, err := EncodePQNativeActionTransaction(wrongKeyWire)
	if err != nil {
		t.Fatal(err)
	}
	bad := [][]byte{f.wire(t, false, ynxauth.ActionInvoiceTerms, wrongEpoch, 2), f.wire(t, false, ynxauth.ActionInvoiceTerms, overflow, 2), f.wire(t, false, ynxauth.ActionInvoiceTerms, terms, 9), wrongNetwork, wrongKey, invoiceDamageBranch(t, valid, "A"), invoiceDamageBranch(t, valid, "B")}
	for _, raw := range bad {
		f.check(t, raw, false)
	}
	f.commit(t, make([]bool, len(bad)), bad...)
	large := invoiceEffect(t, f.commit(t, []bool{true}, f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("too-large-for-payer", 1000), 2)).TxResults[0])
	insufficient := f.settle(t, large, 1000, 2)
	f.check(t, insufficient, false)
	f.commit(t, []bool{false}, insufficient)
	if len(f.a.committed.InvoiceLedger.Records) != 1 || f.a.committed.InvoiceLedger.Records[0].Settlement != nil || queryConsensusAccount(t, f.a, f.other).Nonce != 1 {
		t.Fatal("insufficient balance consumed slot or payer nonce")
	}
	normal := invoiceEffect(t, f.commit(t, []bool{true}, f.wire(t, false, ynxauth.ActionInvoiceTerms, terms, 3)).TxResults[0])
	selfTerms := f.terms("self-recipient", 100)
	selfTerms.Recipient = f.other
	self := invoiceEffect(t, f.commit(t, []bool{true}, f.wire(t, false, ynxauth.ActionInvoiceTerms, selfTerms, 4)).TxResults[0])
	selfPay := f.settle(t, self, 100, 2)
	f.check(t, selfPay, false)
	p := ynxauth.InvoiceSettlePayload{Merchant: f.owner, InvoiceID: normal.InvoiceID, TermsHash: invoiceHashBytes(t, normal.TermsHash), Amount: 100}
	wrongPayer := f.wire(t, false, ynxauth.ActionInvoiceSettle, p, 5)
	f.check(t, wrongPayer, false)
	good := f.settle(t, normal, 100, 2)
	badPay := [][]byte{selfPay, wrongPayer, invoiceDamageBranch(t, good, "A"), invoiceDamageBranch(t, good, "B")}
	f.commit(t, []bool{false, false, false, false}, badPay...)
	paid := invoiceEffect(t, f.commit(t, []bool{true}, good).TxResults[0])
	refund := ynxauth.InvoiceRefundPayload{InvoiceID: normal.InvoiceID, RefundID: "wrong-owner", TermsHash: invoiceHashBytes(t, normal.TermsHash), SettlementHash: invoiceHashBytes(t, paid.NativeHash), Amount: 1}
	wrongMerchant := f.wire(t, true, ynxauth.ActionInvoiceRefund, refund, 3)
	refund.RefundID = "wrong-settlement"
	refund.SettlementHash[0] ^= 1
	wrongOriginal := f.wire(t, false, ynxauth.ActionInvoiceRefund, refund, 5)
	goodRefund := f.refund(t, normal, paid, "legitimate", 30, 5)
	badRefund := [][]byte{wrongMerchant, wrongOriginal, invoiceDamageBranch(t, goodRefund, "A"), invoiceDamageBranch(t, goodRefund, "B")}
	for _, raw := range badRefund {
		f.check(t, raw, false)
	}
	f.commit(t, make([]bool, len(badRefund)), badRefund...)
	f.commit(t, []bool{true}, goodRefund)
	f.cold(t)
}

func TestPQInvoiceLedgerCommitUnknownKeepsOriginalAndReconcilesCold(t *testing.T) {
	for _, afterRename := range []bool{false, true} {
		name := "before-rename"
		if afterRename {
			name = "after-rename"
		}
		t.Run(name, func(t *testing.T) {
			f := newInvoiceMoneyFixture(t)
			ctx := context.Background()
			terms := invoiceEffect(t, f.commit(t, []bool{true}, f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("unknown", 100), 2)).TxResults[0])
			raw := f.settle(t, terms, 100, 2)
			f.check(t, raw, true)
			before, disk := mustJSON(t, f.a.committed), []byte(nil)
			disk, _ = os.ReadFile(f.path)
			request := f.request(raw)
			response, err := f.a.FinalizeBlock(ctx, request)
			if err != nil || response.TxResults[0].Code != 0 {
				t.Fatal(response, err)
			}
			pending := mustJSON(t, f.a.pending)
			injected := errors.New("invoice original commit failure")
			f.a.persistenceHooks = &committedPersistenceHooks{}
			if afterRename {
				f.a.persistenceHooks.syncDirectory = func(string) error { return injected }
			} else {
				f.a.persistenceHooks.beforeRename = func() error { return injected }
			}
			_, err = f.a.Commit(ctx, &abci.RequestCommit{})
			if !errors.Is(err, injected) || errors.Is(err, ErrCommittedStateDurabilityUncertain) != afterRename || !bytes.Equal(before, mustJSON(t, f.a.committed)) || !bytes.Equal(pending, mustJSON(t, f.a.pending)) {
				t.Fatal("UNKNOWN lost firstcause/original candidate", err)
			}
			if _, err = f.a.FinalizeBlock(ctx, request); err == nil {
				t.Fatal("UNKNOWN re-executed the submitted original")
			}
			cold, err := NewPersistentApplicationWithInvoiceAuthorization(f.m, f.path, f.bootstrap, nil, nil, f.authorization)
			if err != nil {
				t.Fatal(err)
			}
			if afterRename {
				if !bytes.Equal(pending, mustJSON(t, cold.committed)) {
					t.Fatal("cold reconciliation lost actually written settlement")
				}
				f.a = cold
				f.check(t, raw, false)
				f.cold(t)
			} else {
				if !bytes.Equal(before, mustJSON(t, cold.committed)) {
					t.Fatal("pre-rename failure changed cold state")
				}
				if after, _ := os.ReadFile(f.path); !bytes.Equal(disk, after) {
					t.Fatal("pre-rename failure changed original bytes")
				}
				f.a.persistenceHooks = nil
				if _, err = f.a.Commit(ctx, &abci.RequestCommit{}); err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(pending, mustJSON(t, f.a.committed)) {
					t.Fatal("durable original retry reapplied/replaced money candidate")
				}
				f.check(t, raw, false)
			}
		})
	}
}

func TestPQInvoiceLedgerResealedRecordsAndOriginalMembersCannotForgeHistory(t *testing.T) {
	f := newInvoiceMoneyFixture(t)
	terms := invoiceEffect(t, f.commit(t, []bool{true}, f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("immutable", 100), 2)).TxResults[0])
	paid := invoiceEffect(t, f.commit(t, []bool{true}, f.settle(t, terms, 100, 2)).TxResults[0])
	f.commit(t, []bool{true}, f.refund(t, terms, paid, "original-refund", 30, 3))
	f.cold(t)
	original, _ := os.ReadFile(f.path)
	for _, mode := range []string{"principal", "refund-total", "payer", "terms-message", "member-A", "member-B", "erase-history", "duplicate-history", "fee-removed"} {
		t.Run(mode, func(t *testing.T) {
			var bad CommittedState
			if err := json.Unmarshal(mustJSON(t, f.a.committed), &bad); err != nil {
				t.Fatal(err)
			}
			bad.bootstrap = f.a.bootstrap
			r := &bad.InvoiceLedger.Records[0]
			switch mode {
			case "principal":
				r.Settlement.Amount++
			case "refund-total":
				r.RefundedAtoms++
			case "payer":
				r.Settlement.From = f.owner
			case "terms-message":
				r.TermsMessage[len(r.TermsMessage)-1] ^= 1
			case "member-A", "member-B":
				entry := &bad.PQHistory[len(bad.PQHistory)-1]
				raw, _, _, _, err := decodePQInvoiceHistory(*entry)
				if err != nil {
					t.Fatal(err)
				}
				raw = invoiceDamageBranch(t, raw, strings.TrimPrefix(mode, "member-"))
				entry.Transaction.Memo = pqInvoiceHistoryMemo + hex.EncodeToString(raw)
			case "erase-history":
				bad.PQHistory = bad.PQHistory[:len(bad.PQHistory)-1]
			case "duplicate-history":
				bad.PQHistory = append(bad.PQHistory, bad.PQHistory[len(bad.PQHistory)-1])
			case "fee-removed":
				for i, e := range bad.FeeEvents {
					if e.TxHash == r.Refunds[0].ABCIHash {
						bad.FeeEvents = append(bad.FeeEvents[:i], bad.FeeEvents[i+1:]...)
						break
					}
				}
			}
			hash, err := bad.calculateHash()
			if err != nil {
				t.Fatal(err)
			}
			bad.AppHash = hash
			path := filepath.Join(t.TempDir(), "tampered-original.json")
			raw, err := json.Marshal(bad)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err = NewPersistentApplicationWithInvoiceAuthorization(f.m, path, f.bootstrap, nil, nil, f.authorization); err == nil {
				t.Fatal("resealed invoice forgery cold-loaded", mode)
			}
			if held, _ := os.ReadFile(path); !bytes.Equal(held, raw) {
				t.Fatal("rejected candidate was repaired or erased")
			}
		})
	}
	if after, _ := os.ReadFile(f.path); !bytes.Equal(after, original) {
		t.Fatal("negative candidate changed original ledger")
	}
}

func TestPQInvoiceLedgerMerchantRevokeOrRotateBeforePaymentRejectsOldTerms(t *testing.T) {
	for _, mode := range []string{"revoked", "rotated"} {
		t.Run(mode, func(t *testing.T) {
			f := newInvoiceMoneyFixture(t)
			issued := f.commit(t, []bool{true, true}, f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("already-paid", 100), 2), f.wire(t, false, ynxauth.ActionInvoiceTerms, f.terms("awaiting-payment", 100), 3))
			paidTerms, openTerms := invoiceEffect(t, issued.TxResults[0]), invoiceEffect(t, issued.TxResults[1])
			paid := invoiceEffect(t, f.commit(t, []bool{true}, f.settle(t, paidTerms, 100, 2)).TxResults[0])
			paidSlot := invoiceSlot(f.network, f.owner, paidTerms.InvoiceID)
			index, ok := invoiceRecordAt(f.a.committed.InvoiceLedger.Records, paidSlot)
			if !ok {
				t.Fatal("actual paid slot is missing")
			}
			paidOriginal := mustJSON(t, f.a.committed.InvoiceLedger.Records[index])
			h := uint64(f.a.committed.Height + 1)
			var next *ynxbatch.PrivateKey
			if mode == "revoked" {
				f.commit(t, []bool{true}, mustPQEnvelope(t, PQRevocationType, f.revocation(t, 4, h, 1)))
			} else {
				var public ynxbatch.PublicKey
				var err error
				next, public, err = ynxbatch.KeyGen()
				if err != nil {
					t.Fatal(err)
				}
				defer next.Destroy()
				wire := abciRegistrationWire(t, nil, f.key, next, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 4, ActivateAt: h + 1})
				f.commit(t, []bool{true}, mustPQEnvelope(t, PQMigrationType, wire))
			}
			queued := f.settle(t, openTerms, 100, 3)
			wire, _, err := DecodePQNativeActionTransaction(queued)
			if err != nil {
				t.Fatal(err)
			}
			member, err := ynxbatch.DecodeMember(wire)
			if err != nil {
				t.Fatal(err)
			}
			// The payer's complete current AND proof is still lawful. The new debit
			// must fail specifically because its merchant terms lost current authority.
			if err = f.a.pqCertificateCache.VerifyDecodedMember(f.a.committed.AccountPolicy, f.other, ynxauth.TransactionPurpose, member.Message, member, uint64(f.a.committed.Height+1)); err != nil {
				t.Fatal("payer positive control is not current", err)
			}
			f.check(t, queued, false)
			f.commit(t, []bool{false}, queued)
			if index, ok := invoiceRecordAt(f.a.committed.InvoiceLedger.Records, invoiceSlot(f.network, f.owner, openTerms.InvoiceID)); !ok || f.a.committed.InvoiceLedger.Records[index].Settlement != nil {
				t.Fatal("invalidated merchant terms acquired a new principal slot")
			}
			index, _ = invoiceRecordAt(f.a.committed.InvoiceLedger.Records, paidSlot)
			if !bytes.Equal(paidOriginal, mustJSON(t, f.a.committed.InvoiceLedger.Records[index])) {
				t.Fatal("later merchant authority change rewrote successful historical payment")
			}
			f.cold(t)
			oldRefund := f.refund(t, paidTerms, paid, "after-authority-change", 30, 5)
			f.check(t, oldRefund, false)
			if mode == "revoked" {
				f.commit(t, []bool{false}, oldRefund)
			} else {
				payload := ynxauth.InvoiceRefundPayload{InvoiceID: paidTerms.InvoiceID, RefundID: "after-authority-change", TermsHash: invoiceHashBytes(t, paidTerms.TermsHash), SettlementHash: invoiceHashBytes(t, paid.NativeHash), Amount: 30}
				member := pqABCIContractWire(t, f.abciRevocationFixture, next, f.owner, ynxauth.ActionInvoiceRefund, payload, 5, 1)
				current, err := EncodePQNativeActionTransaction(member)
				if err != nil {
					t.Fatal(err)
				}
				f.check(t, current, true)
				effect := invoiceEffect(t, f.commit(t, []bool{false, true}, oldRefund, current).TxResults[1])
				if effect.NetPaid != 70 || effect.Refunded != 30 || effect.Recipient != f.other {
					t.Fatal("current merchant could not refund the unchanged original payer")
				}
			}
			f.cold(t)
		})
	}
}
