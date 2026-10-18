package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func signGatewayMember(t *testing.T, key *ynxbatch.PrivateKey, network []byte, owner, purpose string, message []byte) []byte {
	t.Helper()
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: purpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func pqMemberPOST(t *testing.T, endpoint, route string, wire []byte) (int, PQMemberView) {
	t.Helper()
	r, err := http.Post(endpoint+route, "application/octet-stream", bytes.NewReader(wire))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var view PQMemberView
	if err := json.NewDecoder(r.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	if r.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("PQ result can be cached")
	}
	return r.StatusCode, view
}

func pqMemberGET(t *testing.T, endpoint string) (int, PQMemberView) {
	t.Helper()
	r, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var view PQMemberView
	if err := json.NewDecoder(r.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	return r.StatusCode, view
}

func setGatewayMemberOriginal(t *testing.T, m *pqMockComet, kind string, wire []byte, height uint64) {
	t.Helper()
	payload, err := consensus.EncodePQTransaction(kind, wire)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.f.wire, m.f.payload, m.height = bytes.Clone(wire), payload, height
}

func newGatewayMemberFixture(t *testing.T) *pqGatewayFixture {
	t.Helper()
	f := newPQGatewayFixture(t)
	f.wire = signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 2, 7))
	var err error
	f.payload, err = consensus.EncodePQTransaction(consensus.PQTransferType, f.wire)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func newGatewayMigrationFixture(t *testing.T) (*pqGatewayFixture, string, *secp256k1.PrivateKey) {
	t.Helper()
	f := &pqGatewayFixture{}
	classic := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(215)))
	recipient := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(216)))
	var err error
	f.owner, err = consensus.NativeAddress(classic.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	f.recipient, err = consensus.NativeAddress(recipient.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	f.d, err = chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{f.owner, f.recipient} {
		if _, err := f.d.Faucet(owner, 100); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	if err := f.d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	f.migration, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.network, err = hex.DecodeString(f.migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	var public ynxbatch.PublicKey
	f.key, public, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.key.Destroy)
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(message)
	f.wire, err = (ynxauth.Migration{Intent: intent, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize(), NewKeyProof: signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	f.payload, err = consensus.EncodePQTransaction(consensus.PQMigrationType, f.wire)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	f.a, err = consensus.NewPersistentApplication(f.migration, path)
	if err != nil {
		t.Fatal(err)
	}
	return f, path, classic
}

func assertGatewayMemberCommit(t *testing.T, view PQMemberView, wire, payload []byte, height uint64, owner, recipient string, amount int64, nonce uint64) {
	t.Helper()
	if view.Status != "committed" || !view.Committed || view.Source != "comet-rpc" || view.NativeTransactionHash != consensus.SignedTransactionHash(wire) || view.ABCITransactionHash != consensus.SignedTransactionHash(payload) || view.NativeTransactionHash == view.ABCITransactionHash || !bytes.Equal(view.Wire, wire) || view.ExecutionHeight != height || view.CometIndex == nil || *view.CometIndex != 0 || view.Transaction == nil || view.Transaction.Hash != view.NativeTransactionHash || view.From != owner || view.To != recipient || view.Amount != amount || view.Fee != 1 || view.Nonce != nonce || view.Transaction.Nonce != nonce {
		t.Fatalf("original execution not preserved: %+v", view)
	}
}

func TestGatewayPQMemberActualTransferAndOriginalReadback(t *testing.T) {
	f := newGatewayMemberFixture(t)
	before := queryPQGatewayAccount(t, f.a, f.owner)
	receiverBefore := queryPQGatewayAccount(t, f.a, f.recipient)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	code, view := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", f.wire)
	if code != http.StatusOK {
		t.Fatalf("HTTP %d: %+v", code, view)
	}
	assertGatewayMemberCommit(t, view, f.wire, f.payload, 3, f.owner, f.recipient, 7, 2)
	after := queryPQGatewayAccount(t, f.a, f.owner)
	receiverAfter := queryPQGatewayAccount(t, f.a, f.recipient)
	if after.Balance != before.Balance-8 || after.Nonce != 2 || receiverAfter.Balance != receiverBefore.Balance+7 || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+1 {
		t.Fatal("actual fee, nonce, amount or usage differs from projected execution")
	}
	var moved int64
	for id, prior := range before.Lots {
		delta := prior - after.Lots[id]
		moved += delta
		if receiverAfter.Lots[id]-receiverBefore.Lots[id] != delta {
			t.Fatal("actual lot flow inconsistent")
		}
	}
	if moved != 7 {
		t.Fatal("N1 transfer fee incorrectly consumed principal lots")
	}
	for _, path := range []string{view.ReadbackURL, "/txs/" + view.ABCITransactionHash} {
		code, got := pqMemberGET(t, server.URL+path)
		if code != http.StatusOK || !reflect.DeepEqual(got, view) {
			t.Fatalf("original readback mismatch: %d %+v", code, got)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.posts != 1 {
		t.Fatal("readback repeated the original write")
	}
}

func assertGatewayPQPolicyFee(t *testing.T, a *consensus.Application, before, feeBefore chain.ConsensusAccount, kind, abciHash string, height int64, eventCount int) {
	t.Helper()
	after := queryPQGatewayAccount(t, a, before.Address)
	feeAfter := queryPQGatewayAccount(t, a, feeBefore.Address)
	usage := before.ResourceUsage
	usage.BandwidthUsed++
	if after.Balance != before.Balance-1 || after.Nonce != before.Nonce+1 || !reflect.DeepEqual(after.ResourceUsage, usage) || feeAfter.Balance != feeBefore.Balance+1 || feeAfter.Nonce != feeBefore.Nonce || !reflect.DeepEqual(feeAfter.ResourceUsage, feeBefore.ResourceUsage) {
		t.Fatalf("policy fee effects differ: owner balance %d -> %d, nonce %d -> %d, recipient balance %d -> %d", before.Balance, after.Balance, before.Nonce, after.Nonce, feeBefore.Balance, feeAfter.Balance)
	}
	// Migration uses chargeApplicationAction; revocation has its own explicit
	// one-lot fee flow. Both move fee lots, unlike N1 transfer's balance-only fee.
	ids := map[string]bool{}
	for _, lots := range []map[string]int64{before.Lots, after.Lots, feeBefore.Lots, feeAfter.Lots} {
		for id := range lots {
			ids[id] = true
		}
	}
	var moved int64
	for id := range ids {
		debit := before.Lots[id] - after.Lots[id]
		if debit < 0 || debit > 1 || feeAfter.Lots[id]-feeBefore.Lots[id] != debit || after.Lots[id] < 0 {
			t.Fatalf("policy fee lot %s was not conserved between owner and recipient", id)
		}
		moved += debit
	}
	if moved != 1 {
		t.Fatalf("policy fee moved %d lot units, want 1", moved)
	}
	response, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: "/economics/fees"})
	if err != nil || response.Code != 0 {
		t.Fatalf("fee event query: %v", err)
	}
	var events []consensus.BFTFeeEvent
	if err := json.Unmarshal(response.Value, &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != eventCount {
		t.Fatalf("fee event count = %d, want %d", len(events), eventCount)
	}
	found := 0
	for _, event := range events {
		if event.TxHash != abciHash {
			continue
		}
		found++
		sum := sha256.Sum256([]byte("YNX_FEE_EVENT_V1\x00" + abciHash))
		if event.ID != "fee_"+hex.EncodeToString(sum[:12]) || event.PolicyVersion != consensus.FeePolicyVersion || event.TransactionType != kind || event.Payer != before.Address || event.Recipient != feeBefore.Address || event.GrossFeeYNXT != 1 || event.ValidatorYNXT != 1 || event.BurnYNXT != 0 || event.ProviderYNXT != 0 || event.ProtocolYNXT != 0 || event.TreasuryYNXT != 0 || event.Sponsored || event.Source != consensus.FixedFeeSource || event.BlockHeight != height || !event.RecordedAt.Equal(time.Unix(height, 0).UTC()) || len(event.AuditHash) != 64 {
			t.Fatalf("actual policy fee event differs from executed original: %+v", event)
		}
	}
	if found != 1 {
		t.Fatalf("original has %d fee events, want 1", found)
	}
}

func TestGatewayPQMemberMigrationRotationRestartAndHistoricalRevocation(t *testing.T) {
	f, statePath, classic := newGatewayMigrationFixture(t)
	m := newPQMock(t, f)
	m.height = 2
	server := gatewayPQServer(t, m)
	route := "/accounts/" + f.owner + "/authorization/migrate"
	before := queryPQGatewayAccount(t, f.a, f.owner)
	feeRecipient := ""
	for _, validator := range f.migration.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	if feeRecipient == "" || feeRecipient == f.owner {
		t.Fatal("fixture requires its actual distinct active fee recipient")
	}
	feeBefore := queryPQGatewayAccount(t, f.a, feeRecipient)
	code, initial := pqMemberPOST(t, server.URL, route, f.wire)
	if code != http.StatusOK {
		t.Fatalf("initial migration: %d %+v", code, initial)
	}
	assertGatewayMemberCommit(t, initial, f.wire, f.payload, 2, f.owner, f.owner, 0, 1)
	assertGatewayPQPolicyFee(t, f.a, before, feeBefore, consensus.PQMigrationType, initial.ABCITransactionHash, 2, 1)
	wire := signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 2, 7))
	setGatewayMemberOriginal(t, m, consensus.PQTransferType, wire, 3)
	code, transfer := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", wire)
	if code != http.StatusOK {
		t.Fatalf("transfer after activation: %d %+v", code, transfer)
	}
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 3, ActivateAt: 5}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	rotation, err := (ynxauth.Migration{Intent: intent, CurrentPQProof: signGatewayMember(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, message), NewKeyProof: signGatewayWhole(t, key, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	beforeRotation := queryPQGatewayAccount(t, f.a, f.owner)
	feeBeforeRotation := queryPQGatewayAccount(t, f.a, feeRecipient)
	for _, branch := range []string{"current-A", "current-B", "classic-fallback"} {
		invalid, err := ynxauth.DecodeMigration(rotation)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "classic-fallback" {
			digest := sha256.Sum256(message)
			invalid.CurrentPQProof = nil
			invalid.ClassicPublicKey = classic.PubKey().SerializeCompressed()
			invalid.ClassicSignature = ecdsa.Sign(classic, digest[:]).Serialize()
		} else {
			proof, err := ynxbatch.DecodeMember(invalid.CurrentPQProof)
			if err != nil {
				t.Fatal(err)
			}
			if branch == "current-A" {
				proof.Certificate.SigmaA[0] ^= 1
			} else {
				proof.Certificate.SigmaB[0] ^= 1
			}
			invalid.CurrentPQProof, err = ynxbatch.EncodeMember(proof)
			if err != nil {
				t.Fatal(err)
			}
		}
		bad, err := invalid.Encode()
		if err != nil {
			t.Fatal(err)
		}
		setGatewayMemberOriginal(t, m, consensus.PQMigrationType, bad, 4)
		code, rejected := pqMemberPOST(t, server.URL, route, bad)
		if code != http.StatusUnprocessableEntity || rejected.Committed || rejected.Status != "rejected" {
			t.Fatalf("invalid rotation %s accepted: HTTP %d", branch, code)
		}
		if !reflect.DeepEqual(beforeRotation, queryPQGatewayAccount(t, f.a, f.owner)) {
			t.Fatal("invalid rotation consumed account state")
		}
	}
	setGatewayMemberOriginal(t, m, consensus.PQMigrationType, rotation, 4)
	code, rotated := pqMemberPOST(t, server.URL, route, rotation)
	if code != http.StatusOK {
		t.Fatalf("current dual-key rotation: %d %+v", code, rotated)
	}
	assertGatewayMemberCommit(t, rotated, rotation, f.payload, 4, f.owner, f.owner, 0, 3)
	assertGatewayPQPolicyFee(t, f.a, beforeRotation, feeBeforeRotation, consensus.PQMigrationType, rotated.ABCITransactionHash, 4, 3)
	restarted, err := consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = restarted
	m.mu.Unlock()
	old := signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 4, 1))
	setGatewayMemberOriginal(t, m, consensus.PQTransferType, old, 5)
	code, rejected := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", old)
	if code != http.StatusUnprocessableEntity || rejected.Committed || rejected.Status != "rejected" {
		t.Fatal("superseded key authorized after restart")
	}
	current := signGatewayMember(t, key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 4, 1))
	setGatewayMemberOriginal(t, m, consensus.PQTransferType, current, 5)
	code, latest := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", current)
	if code != http.StatusOK {
		t.Fatalf("current key rejected: %d %+v", code, latest)
	}
	beforeRevocation := queryPQGatewayAccount(t, f.a, f.owner)
	feeBeforeRevocation := queryPQGatewayAccount(t, f.a, feeRecipient)
	// Commit a real terminal revocation through the existing Application. This
	// is history validation coverage, not an unimplemented gateway revoke route.
	revoke := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, AuthorizingRevision: 2, ThroughRevision: 2, LedgerNonce: 5, ExecuteAt: 6, RevokeAt: 7}
	message, err = revoke.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	revokeWire, err := (ynxauth.Revocation{Intent: revoke, CurrentPQProof: signGatewayMember(t, key, f.network, f.owner, ynxauth.RevocationPurpose, message)}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	revokePayload, err := consensus.EncodePQTransaction(consensus.PQRevocationType, revokeWire)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range []int64{6, 7} {
		var txs [][]byte
		if h == 6 {
			txs = [][]byte{revokePayload}
		}
		out, err := f.a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: txs})
		if err != nil || h == 6 && (len(out.TxResults) != 1 || out.TxResults[0].Code != 0) {
			t.Fatalf("revocation/empty block: %+v %v", out, err)
		}
		if _, err := f.a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	assertGatewayPQPolicyFee(t, f.a, beforeRevocation, feeBeforeRevocation, consensus.PQRevocationType, consensus.SignedTransactionHash(revokePayload), 6, 5)
	restarted, err = consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = restarted
	m.mu.Unlock()
	for _, original := range []PQMemberView{initial, transfer, rotated, latest} {
		code, got := pqMemberGET(t, server.URL+original.ReadbackURL)
		if code != http.StatusOK || !reflect.DeepEqual(got, original) {
			t.Fatalf("later revocation reinterpreted original: %d %+v", code, got)
		}
	}
	account := queryPQGatewayAccount(t, f.a, f.owner)
	if account.Nonce != 5 || account.Balance != before.Balance-13 {
		t.Fatal("restart duplicated or lost actual charges")
	}
}

func TestGatewayPQMemberUnknownKeepsOriginalAndNeverRetries(t *testing.T) {
	for _, mode := range []string{"connection-loss", "lost-response", "wrong-hash", "missing-data", "wrong-height", "wrong-id", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			f := newGatewayMemberFixture(t)
			m := newPQMock(t, f)
			m.mode = mode
			server := gatewayPQServer(t, m)
			code, view := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", f.wire)
			if code != http.StatusAccepted || view.Status != "unknown" || view.Committed || view.Transaction != nil || view.Amount != 0 || view.Fee != 0 || view.Nonce != 0 || view.NativeTransactionHash != consensus.SignedTransactionHash(f.wire) || view.ABCITransactionHash != consensus.SignedTransactionHash(f.payload) || !bytes.Equal(view.Wire, f.wire) {
				t.Fatalf("UNKNOWN original lost or fabricated: %d %+v", code, view)
			}
			code, read := pqMemberGET(t, server.URL+view.ReadbackURL)
			if mode == "redirect" {
				if code != http.StatusAccepted || read.Committed {
					t.Fatal("unsubmitted original fabricated commit")
				}
			} else if code != http.StatusOK || !read.Committed || read.NativeTransactionHash != view.NativeTransactionHash || read.ABCITransactionHash != view.ABCITransactionHash {
				t.Fatalf("original not recoverable: %d %+v", code, read)
			}
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.posts != 1 {
				t.Fatal("ambiguous original was retried")
			}
		})
	}
}

func TestGatewayPQMemberRejectsEitherSignatureAndInvalidNonce(t *testing.T) {
	f := newGatewayMemberFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	before := queryPQGatewayAccount(t, f.a, f.owner)
	original := bytes.Clone(f.wire)
	for _, branch := range []string{"A", "B", "nonce"} {
		member, err := ynxbatch.DecodeMember(original)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		wire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "nonce" {
			wire = signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 99, 7))
		}
		setGatewayMemberOriginal(t, m, consensus.PQTransferType, wire, 3)
		code, view := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", wire)
		if code != http.StatusUnprocessableEntity || view.Status != "rejected" || view.Committed || view.Transaction != nil {
			t.Fatalf("invalid %s executed: %d %+v", branch, code, view)
		}
		if !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) {
			t.Fatal("CheckTx rejection changed live account")
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.indexed) != 0 || m.posts != 3 {
		t.Fatal("rejected Member executed or retried")
	}
}

func TestGatewayPQMemberMigrationUnknownAndImportedOriginalBoundary(t *testing.T) {
	f, _, _ := newGatewayMigrationFixture(t)
	m := newPQMock(t, f)
	m.height, m.mode = 2, "lost-response"
	server := gatewayPQServer(t, m)
	code, view := pqMemberPOST(t, server.URL, "/accounts/"+f.owner+"/authorization/migrate", f.wire)
	if code != http.StatusAccepted || view.Status != "unknown" || view.Committed || view.Transaction != nil || !bytes.Equal(view.Wire, f.wire) || view.NativeTransactionHash != consensus.SignedTransactionHash(f.wire) || view.ABCITransactionHash != consensus.SignedTransactionHash(f.payload) {
		t.Fatal("lost migration response lost original identity or fabricated commitment")
	}
	code, read := pqMemberGET(t, server.URL+view.ReadbackURL)
	if code != http.StatusOK {
		t.Fatalf("migration original recovery: HTTP %d", code)
	}
	assertGatewayMemberCommit(t, read, f.wire, f.payload, 2, f.owner, f.owner, 0, 1)
	if account := queryPQGatewayAccount(t, f.a, f.owner); account.Nonce != 1 || account.Balance != 99 {
		t.Fatal("migration recovery repeated a charge")
	}
	m.mu.Lock()
	if m.posts != 1 {
		t.Fatal("UNKNOWN migration was resent")
	}
	m.mu.Unlock()

	imported := newGatewayMemberFixture(t)
	importedMock := newPQMock(t, imported)
	importedServer := gatewayPQServer(t, importedMock)
	var originalHash string
	for _, block := range imported.migration.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Type == consensus.PQMigrationType {
				originalHash = tx.Hash
			}
		}
	}
	if originalHash == "" {
		t.Fatal("missing actual imported migration fixture")
	}
	code, read = pqMemberGET(t, importedServer.URL+"/transactions/pq/originals/"+originalHash)
	if code != http.StatusAccepted || read.Committed || read.Transaction != nil || read.ABCITransactionHash != "" || read.CometIndex != nil || read.NativeTransactionHash != originalHash {
		t.Fatal("source import invented a Comet index or commit")
	}
	// Explicit native lookup is separate. An absent Comet ABCI lookup is not a
	// reason to silently fall back to source/native history under /txs.
	code, _ = pqMemberGET(t, importedServer.URL+"/txs/"+originalHash)
	if code != http.StatusNotFound {
		t.Fatal("ABCI lookup silently reinterpreted a native wire hash")
	}
	importedMock.mu.Lock()
	defer importedMock.mu.Unlock()
	if importedMock.posts != 0 || len(importedMock.indexed) != 0 {
		t.Fatal("source import caused a new submission")
	}
}

func TestGatewayPQMemberReadbackRejectsMutatedEvidence(t *testing.T) {
	f := newGatewayMemberFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	code, original := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", f.wire)
	if code != http.StatusOK {
		t.Fatalf("positive original: %d %+v", code, original)
	}
	for name, mutate := range map[string]func(*cometTx){
		"outer-hash":     func(tx *cometTx) { tx.Hash = strings.Repeat("0", 64) },
		"height":         func(tx *cometTx) { tx.Height = "4" },
		"execution-data": func(tx *cometTx) { tx.TxResult.Data = []byte(original.NativeTransactionHash) },
		"missing-data":   func(tx *cometTx) { tx.TxResult.Data = nil },
		"wire":           func(tx *cometTx) { tx.Tx = append(bytes.Clone(tx.Tx), ' ') },
		"rejected":       func(tx *cometTx) { tx.TxResult.Code = 2; tx.TxResult.Data = nil },
	} {
		t.Run(name, func(t *testing.T) {
			m.mu.Lock()
			m.lookupMutation = mutate
			m.mu.Unlock()
			code, view := pqMemberGET(t, server.URL+original.ReadbackURL)
			if code != http.StatusAccepted || view.Status != "unknown" || view.Committed || view.Transaction != nil || view.NativeTransactionHash != original.NativeTransactionHash || view.ABCITransactionHash != original.ABCITransactionHash {
				t.Fatalf("mutated index accepted: %d %+v", code, view)
			}
		})
	}
	m.mu.Lock()
	m.lookupMutation = nil
	m.mu.Unlock()
	for name, mutate := range map[string]func(*consensus.PQWalletHistoryView){
		"amount":               func(h *consensus.PQWalletHistoryView) { h.Transaction.Amount++ },
		"fee":                  func(h *consensus.PQWalletHistoryView) { h.Transaction.Fee++ },
		"nonce":                func(h *consensus.PQWalletHistoryView) { h.Transaction.Nonce++ },
		"unexecuted-resource":  func(h *consensus.PQWalletHistoryView) { h.Transaction.Sponsor = h.Transaction.From },
		"outer-identity":       func(h *consensus.PQWalletHistoryView) { h.ABCITransactionHash = h.Transaction.Hash },
		"source-import":        func(h *consensus.PQWalletHistoryView) { h.Source = "source_import" },
		"policy-key":           func(h *consensus.PQWalletHistoryView) { h.Authorization.Policy.Records[0].PKA[0] ^= 1 },
		"network":              func(h *consensus.PQWalletHistoryView) { h.Authorization.NetworkID = strings.Repeat("0", 64) },
		"not-complete":         func(h *consensus.PQWalletHistoryView) { h.Authorization.RecordsComplete = false },
		"not-current-response": func(h *consensus.PQWalletHistoryView) { h.Authorization.CommittedHeight++ },
	} {
		t.Run(name, func(t *testing.T) {
			m.mu.Lock()
			m.queryMutation = func(path string, b []byte) []byte {
				if strings.HasPrefix(path, consensus.PQWalletHistoryPath) {
					var h consensus.PQWalletHistoryView
					if err := json.Unmarshal(b, &h); err != nil {
						t.Fatal(err)
					}
					mutate(&h)
					b, _ = json.Marshal(h)
				}
				return b
			}
			m.mu.Unlock()
			code, view := pqMemberGET(t, server.URL+original.ReadbackURL)
			if code != http.StatusAccepted || view.Status != "unknown" || view.Committed || view.Transaction != nil || view.NativeTransactionHash != original.NativeTransactionHash {
				t.Fatalf("mutated history accepted: %d %+v", code, view)
			}
		})
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.posts != 1 {
		t.Fatal("evidence failure retried write")
	}
}

func TestGatewayPQMemberMigrationRejectsRouteAndEitherNewKeyProof(t *testing.T) {
	f, _, classic := newGatewayMigrationFixture(t)
	m := newPQMock(t, f)
	m.height = 2
	server := gatewayPQServer(t, m)
	original := bytes.Clone(f.wire)
	code, _ := pqMemberPOST(t, server.URL, "/accounts/"+f.recipient+"/authorization/migrate", original)
	if code != http.StatusBadRequest {
		t.Fatal("route owner not bound to original intent")
	}
	before := queryPQGatewayAccount(t, f.a, f.owner)
	for _, branch := range []string{"A", "B", "classic"} {
		migration, err := ynxauth.DecodeMigration(original)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "classic" {
			message, err := migration.Intent.SigningBytes()
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(append(message, 1))
			migration.ClassicSignature = ecdsa.Sign(classic, digest[:]).Serialize()
		} else {
			proof, err := ynxbatch.DecodeWhole(migration.NewKeyProof)
			if err != nil {
				t.Fatal(err)
			}
			if branch == "A" {
				proof.Certificate.SigmaA[0] ^= 1
			} else {
				proof.Certificate.SigmaB[0] ^= 1
			}
			migration.NewKeyProof, err = ynxbatch.EncodeWhole(proof)
			if err != nil {
				t.Fatal(err)
			}
		}
		wire, err := migration.Encode()
		if err != nil {
			t.Fatal(err)
		}
		setGatewayMemberOriginal(t, m, consensus.PQMigrationType, wire, 2)
		code, view := pqMemberPOST(t, server.URL, "/accounts/"+f.owner+"/authorization/migrate", wire)
		if code != http.StatusUnprocessableEntity || view.Committed || view.Status != "rejected" {
			t.Fatalf("invalid migration %s accepted: %d %+v", branch, code, view)
		}
		if !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) {
			t.Fatal("rejected migration changed actual balance/nonce")
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.posts != 3 || len(m.indexed) != 0 {
		t.Fatal("route mismatch submitted or rejected migration executed")
	}
}

func TestGatewayPQMemberBoundedProfileAndSafeIntegerJSON(t *testing.T) {
	f := newGatewayMemberFixture(t)
	if _, _, err := decodeIngressPQMember(consensus.PQTransferType, f.wire); err != nil {
		t.Fatal(err)
	}
	member, err := ynxbatch.DecodeMember(f.wire)
	if err != nil {
		t.Fatal(err)
	}
	member.Certificate.N = 2
	member.PathA = [][]byte{make([]byte, 64)}
	member.PathB = [][]byte{make([]byte, 64)}
	wrong, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := decodeIngressPQMember(consensus.PQTransferType, wrong); err == nil {
		t.Fatal("N2 member admitted to N1 wallet profile")
	}
	for _, bad := range [][]byte{nil, append(bytes.Clone(f.wire), 0), make([]byte, MaxPQMemberIngressBytes+1)} {
		if _, _, err := decodeIngressPQMember(consensus.PQTransferType, bad); err == nil {
			t.Fatal("malformed or oversized Member admitted")
		}
	}
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	response, err := http.Post(server.URL+"/transactions/pq/broadcast", "application/json", bytes.NewReader(f.wire))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatal("wrong media type submitted")
	}
	code, _ := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", make([]byte, MaxPQMemberIngressBytes+1))
	if code != http.StatusRequestEntityTooLarge {
		t.Fatal("oversized Member not bounded")
	}
	m.mu.Lock()
	if m.posts != 0 {
		t.Fatal("invalid ingress reached Comet")
	}
	m.mu.Unlock()
	// Serialization-only boundary, not a fabricated execution or policy fixture.
	value := PQMemberView{Amount: math.MaxInt64, Fee: 1, Nonce: math.MaxUint64, ExecutionHeight: 1<<53 + 1}
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"amount":"9223372036854775807"`, `"fee":"1"`, `"nonce":"18446744073709551615"`, `"executionHeight":"9007199254740993"`} {
		if !bytes.Contains(b, []byte(expected)) {
			t.Fatalf("unsafe integer projection: %s", b)
		}
	}
}

func TestGatewayPQMemberActualCometJSONAndRequiredIndexFields(t *testing.T) {
	f := newGatewayMemberFixture(t)
	m := newPQMock(t, f)
	mode := ""
	redirects := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirected-index" {
			m.mu.Lock()
			redirects++
			m.mu.Unlock()
			http.Error(w, "redirect must not be followed", 500)
			return
		}
		if r.URL.Path != "/tx" {
			m.serve(w, r)
			return
		}
		m.mu.Lock()
		tx, exists := m.indexed[r.URL.Query().Get("hash")]
		responseMode := mode
		m.mu.Unlock()
		if !exists {
			http.Error(w, "no original", 404)
			return
		}
		if responseMode == "redirect" {
			w.Header().Set("Location", "/redirected-index")
			w.WriteHeader(http.StatusTemporaryRedirect)
			return
		}
		hash, err := hex.DecodeString(tx.Hash)
		if err != nil {
			t.Error(err)
			return
		}
		height, err := strconv.ParseInt(tx.Height, 10, 64)
		if err != nil {
			t.Error(err)
			return
		}
		gas, err := strconv.ParseInt(tx.TxResult.GasUsed, 10, 64)
		if err != nil {
			t.Error(err)
			return
		}
		// The real Comet codec, not the mock's standard-JSON result struct:
		// Index=0 is present, successful Code=0 is legitimately omitted.
		result, err := cmtjson.Marshal(coretypes.ResultTx{Hash: hash, Height: height, Index: tx.Index, Tx: tx.Tx, TxResult: abcitypes.ExecTxResult{Code: tx.TxResult.Code, Data: tx.TxResult.Data, Log: tx.TxResult.Log, GasUsed: gas}})
		if err != nil {
			t.Error(err)
			return
		}
		if !bytes.Contains(result, []byte(`"index":0`)) || bytes.Contains(result, []byte(`"code":0`)) {
			t.Error("unexpected actual Comet zero-field encoding")
			return
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(result, &fields); err != nil {
			t.Error(err)
			return
		}
		switch responseMode {
		case "missing-index":
			delete(fields, "index")
		case "null-index":
			fields["index"] = json.RawMessage("null")
		case "missing-result":
			delete(fields, "tx_result")
		case "null-result":
			fields["tx_result"] = json.RawMessage("null")
		}
		response := map[string]any{"result": fields}
		if responseMode == "mixed-error" {
			response["error"] = cometRPCError{Code: -32603, Message: "index unavailable"}
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer upstream.Close()
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(g.Handler())
	defer server.Close()
	code, original := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", f.wire)
	if code != http.StatusOK || !original.Committed {
		t.Fatalf("actual Comet omitted-zero response rejected: HTTP %d %s", code, original.Error)
	}
	for _, malformed := range []string{"missing-index", "null-index", "missing-result", "null-result", "mixed-error", "redirect"} {
		m.mu.Lock()
		mode = malformed
		m.mu.Unlock()
		code, view := pqMemberGET(t, server.URL+original.ReadbackURL)
		if code != http.StatusAccepted || view.Committed || view.Transaction != nil || view.NativeTransactionHash != original.NativeTransactionHash || view.ABCITransactionHash != original.ABCITransactionHash {
			t.Fatalf("malformed %s reported execution: HTTP %d", malformed, code)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if redirects != 0 || m.posts != 1 {
		t.Fatal("index evidence failure redirected or retried write")
	}
}
