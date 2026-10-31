package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type invoiceGatewayFixture struct {
	*pqGatewayFixture
	identity      *pqIdentityFixture
	authorization *consensus.PQInvoiceAuthorization
	buyer         *ynxbatch.PrivateKey
	mock          *pqMockComet
	server        *httptest.Server
}

func newInvoiceGatewayFixture(t *testing.T) *invoiceGatewayFixture {
	t.Helper()
	merchant := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(231)))
	buyer := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(232)))
	owner, err := consensus.NativeAddress(merchant.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	recipient, err := consensus.NativeAddress(buyer.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	f := &pqGatewayFixture{owner: owner, recipient: recipient}
	identity := newPQIdentityFixture(t, func(d *chain.Devnet) {
		f.d = d
		for _, address := range []string{owner, recipient} {
			if _, err := d.Faucet(address, 300); err != nil {
				t.Fatal(err)
			}
		}
		if err := d.EnableAccountPQ(2); err != nil {
			t.Fatal(err)
		}
	})
	f.a, f.migration = identity.app, identity.migration
	f.network, err = hex.DecodeString(f.migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	var merchantPub, buyerPub ynxbatch.PublicKey
	f.key, merchantPub, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.key.Destroy)
	buyerKey, buyerPub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(buyerKey.Destroy)
	var registration [][]byte
	for i, classic := range []*secp256k1.PrivateKey{merchant, buyer} {
		key, pub, address := f.key, merchantPub, owner
		if i == 1 {
			key, pub, address = buyerKey, buyerPub, recipient
		}
		intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: address, PKA: pub.PKA, PKB: pub.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 4}
		message, e := intent.SigningBytes()
		if e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(message)
		wire, e := (ynxauth.Migration{Intent: intent, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize(), NewKeyProof: signGatewayWhole(t, key, f.network, address, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
		if e != nil {
			t.Fatal(e)
		}
		raw, e := consensus.EncodePQTransaction(consensus.PQMigrationType, wire)
		if e != nil {
			t.Fatal(e)
		}
		registration = append(registration, raw)
	}
	out, err := f.a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: 3, Time: time.Unix(3, 0).UTC(), NextValidatorsHash: identity.set.Hash(), Txs: registration})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range out.TxResults {
		if r.Code != 0 {
			t.Fatal("real invoice registration", r.Log)
		}
	}
	if _, err = f.a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	s := &consensus.PQInvoiceSchedule{Version: 1, ChainID: identity.commit.Header.ChainID, NativeChainID: f.migration.Network.ChainID, CometGenesisSHA256: identity.pins.CometGenesisSHA256, OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash, PreviousHeight: 3, PreviousAppHash: hex.EncodeToString(out.AppHash), AuthorizedAt: 4, ActivationHeight: 4}
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := s.Hash()
	if err != nil {
		t.Fatal(err)
	}
	auth, err := consensus.NewPQInvoiceAuthorization(b, hash)
	if err != nil {
		t.Fatal(err)
	}
	f.a, err = consensus.NewPersistentApplicationWithInvoiceAuthorization(f.migration, identity.statePath, identity.bootstrap, nil, nil, auth)
	if err != nil {
		t.Fatal(err)
	}
	m := newPQMock(t, f)
	m.nextValidatorsHash = identity.set.Hash()
	m.height = 4
	return &invoiceGatewayFixture{pqGatewayFixture: f, identity: identity, authorization: auth, buyer: buyerKey, mock: m, server: gatewayPQServer(t, m)}
}

func (f *invoiceGatewayFixture) post(t *testing.T, other bool, kind string, payload any, nonce, height uint64) PQActionView {
	t.Helper()
	signer := *f.pqGatewayFixture
	if other {
		signer.owner, signer.key = f.recipient, f.buyer
	}
	// A nonzero index in a complete legal four-member certificate stays supported.
	wire := gatewayActionWire(t, &signer, kind, payload, nonce, 1, 4)
	setGatewayAction(t, f.mock, wire, nil, height)
	code, v := actionHTTP(t, f.server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", wire)
	if code != 200 || !v.Committed || v.Type != kind || len(v.ExecutionData) == 0 {
		t.Fatalf("real invoice HTTP broadcast %d %+v", code, v)
	}
	if _, err := consensus.ValidatePQInvoiceEffectData(v.Wire, v.Transport, height, v.ExecutionData); err != nil {
		t.Fatal(err)
	}
	return v
}

func invoiceGatewayEffect(t *testing.T, v PQActionView) consensus.PQInvoiceEffect {
	t.Helper()
	var e consensus.PQInvoiceEffect
	if json.Unmarshal(v.ExecutionData, &e) != nil {
		t.Fatal("missing actual invoice data")
	}
	return e
}

func invoiceGatewayHash(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil || len(b) != 32 {
		t.Fatal("hash", err)
	}
	return b
}

func invoiceHTTP(t *testing.T, endpoint string) (int, consensus.PQInvoiceView) {
	t.Helper()
	r, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var v consensus.PQInvoiceView
	if r.StatusCode == 200 {
		if err = json.NewDecoder(r.Body).Decode(&v); err != nil {
			t.Fatal(err)
		}
	}
	if r.StatusCode != http.StatusNotFound && r.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("invoice observation cacheable")
	}
	return r.StatusCode, v
}

func TestGatewayPQInvoiceBroadcastQueryOriginalAndColdRecovery(t *testing.T) {
	f := newInvoiceGatewayFixture(t)
	terms := f.post(t, false, ynxauth.ActionInvoiceTerms, ynxauth.InvoiceTermsPayload{InvoiceID: "gateway-original", SessionID: "original-session", Recipient: f.owner, Payer: f.recipient, AssetID: "YNXT", UnitVersion: "1", FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: 1, Amount: 11, MaxFee: 1, ExpiresAt: 100}, 2, 4)
	te := invoiceGatewayEffect(t, terms)
	paid := f.post(t, true, ynxauth.ActionInvoiceSettle, ynxauth.InvoiceSettlePayload{Merchant: f.owner, InvoiceID: te.InvoiceID, TermsHash: invoiceGatewayHash(t, te.TermsHash), Amount: 11}, 2, 5)
	refund := f.post(t, false, ynxauth.ActionInvoiceRefund, ynxauth.InvoiceRefundPayload{InvoiceID: te.InvoiceID, RefundID: "returned-1", TermsHash: invoiceGatewayHash(t, te.TermsHash), SettlementHash: invoiceGatewayHash(t, paid.NativeTransactionHash), Amount: 4}, 3, 6)
	url := f.server.URL + "/invoices/pq/" + f.owner + "/" + te.InvoiceID
	code, v := invoiceHTTP(t, url)
	if code != 200 || v.Record.RefundedAtoms != 4 || v.Record.Settlement.From != f.recipient || len(v.History) != 3 {
		t.Fatal("invoice current complete record", code)
	}
	if err := consensus.ValidatePQInvoiceView(v, f.owner, te.InvoiceID, 6); err != nil {
		t.Fatal(err)
	}
	for _, original := range []PQActionView{terms, paid, refund} {
		for _, route := range []string{original.ReadbackURL, original.ABCIReadbackURL} {
			status, got := actionHTTP(t, f.server.URL+route, "", nil)
			if status != 200 || !bytes.Equal(got.ExecutionData, original.ExecutionData) || !bytes.Equal(got.Transport, original.Transport) {
				t.Fatal("historical invoice readback changed", status)
			}
		}
	}
	var err error
	f.a, err = consensus.NewPersistentApplicationWithInvoiceAuthorization(f.migration, f.identity.statePath, f.identity.bootstrap, nil, nil, f.authorization)
	if err != nil {
		t.Fatal(err)
	}
	if status, got := invoiceHTTP(t, url); status != 200 || !reflect.DeepEqual(v, got) {
		t.Fatal("cold invoice HTTP changed", status)
	}
	for _, suffix := range []string{"?height=6", "/extra"} {
		if status, _ := invoiceHTTP(t, url+suffix); status == 200 {
			t.Fatal("unbound invoice query accepted")
		}
	}
	// A plausible result with another session passes the small DATA arithmetic
	// check, but must fail the full original signed-terms history comparison.
	f.mock.mu.Lock()
	f.mock.lookupMutation = func(tx *cometTx) {
		if tx.Hash == strings.ToUpper(strings.TrimPrefix(paid.ABCITransactionHash, "0x")) {
			var e consensus.PQInvoiceEffect
			_ = json.Unmarshal(tx.TxResult.Data, &e)
			e.SessionID = "forged-session"
			tx.TxResult.Data, _ = json.Marshal(e)
		}
	}
	f.mock.mu.Unlock()
	if status, got := actionHTTP(t, f.server.URL+paid.ReadbackURL, "", nil); status == 200 || got.Committed {
		t.Fatal("indexed invoice data bypassed actual merchant terms")
	}
}

func TestGatewayPQInvoiceFinalityExactResultsSuccessorAndTamper(t *testing.T) {
	f, _, _ := newGatewayMigrationFixture(t)
	engine := newPQActionFinalityEngine(t, f)
	buyerClassic := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(216)))
	buyerKey, buyerPub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer buyerKey.Destroy()
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.recipient, PKA: buyerPub.PKA, PKB: buyerPub.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(message)
	registration, err := (ynxauth.Migration{Intent: intent, ClassicPublicKey: buyerClassic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(buyerClassic, digest[:]).Serialize(), NewKeyProof: signGatewayWhole(t, buyerKey, f.network, f.recipient, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	buyerRaw, err := consensus.EncodePQTransaction(consensus.PQMigrationType, registration)
	if err != nil {
		t.Fatal(err)
	}
	h, registered := engine.apply(t, f.payload, buyerRaw)
	for _, r := range registered.TxResults {
		if r.Code != 0 {
			t.Fatal("actual original registration", r.Log)
		}
	}
	genesis, err := cmtjson.Marshal(engine.doc)
	if err != nil {
		t.Fatal(err)
	}
	genesisHash := sha256.Sum256(genesis)
	schedule := &consensus.PQInvoiceSchedule{Version: 1, ChainID: engine.doc.ChainID, NativeChainID: f.migration.Network.ChainID, CometGenesisSHA256: hex.EncodeToString(genesisHash[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash, PreviousHeight: h, PreviousAppHash: hex.EncodeToString(registered.AppHash), AuthorizedAt: h + 1, ActivationHeight: h + 1}
	scheduleRaw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := consensus.NewPQInvoiceAuthorization(scheduleRaw, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	if err = engine.conns.Stop(); err != nil {
		t.Fatal(err)
	}
	f.a, err = consensus.NewPersistentApplicationWithInvoiceAuthorization(f.migration, engine.path, engine.boot, nil, nil, authorization)
	if err != nil {
		t.Fatal(err)
	}
	engine.conns = proxy.NewAppConns(proxy.NewLocalClientCreator(f.a), proxy.NopMetrics())
	if err = engine.conns.Start(); err != nil {
		t.Fatal(err)
	}
	engine.bound = sm.WithConsensusAuthorityStore(engine.store, f.a)
	var terms, paid PQActionView
	for i, kind := range []string{ynxauth.ActionInvoiceTerms, ynxauth.ActionInvoiceSettle, ynxauth.ActionInvoiceRefund} {
		var payload any
		nonce := uint64(2)
		switch i {
		case 0:
			payload = ynxauth.InvoiceTermsPayload{InvoiceID: "finality-original", SessionID: "session", Recipient: f.owner, Payer: f.recipient, AssetID: "YNXT", UnitVersion: "1", FeeRule: "native-transfer-fee-one/v1", KeyEpoch: 1, Revision: 1, Amount: 9, MaxFee: 1, ExpiresAt: 100}
		case 1:
			e := invoiceGatewayEffect(t, terms)
			payload = ynxauth.InvoiceSettlePayload{Merchant: f.owner, InvoiceID: e.InvoiceID, TermsHash: invoiceGatewayHash(t, e.TermsHash), Amount: 9}
		case 2:
			e := invoiceGatewayEffect(t, terms)
			nonce = 3
			payload = ynxauth.InvoiceRefundPayload{InvoiceID: e.InvoiceID, RefundID: "r", TermsHash: invoiceGatewayHash(t, e.TermsHash), SettlementHash: invoiceGatewayHash(t, paid.NativeTransactionHash), Amount: 2}
		}
		signer := *f
		if i == 1 {
			signer.owner, signer.key = f.recipient, buyerKey
		}
		wire := gatewayActionWire(t, &signer, kind, payload, nonce, 1, 4)
		raw, err := consensus.EncodePQNativeActionTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		var sibling []byte
		if i == 0 {
			p := payload.(ynxauth.InvoiceTermsPayload)
			p.InvoiceID = "competing-nonce"
			other := gatewayActionWire(t, &signer, kind, p, nonce, 1, 4)
			sibling, err = consensus.EncodePQNativeActionTransaction(other)
			if err != nil {
				t.Fatal(err)
			}
		}
		transactions := [][]byte{raw}
		if sibling != nil {
			transactions = append(transactions, sibling)
		}
		height, results := engine.apply(t, transactions...)
		if results.TxResults[0].Code != 0 || sibling != nil && results.TxResults[1].Code == 0 {
			t.Fatal("real invoice execution outcomes", results.TxResults)
		}
		engine.apply(t)
		proofFixture := engine.observation(t, height, 0)
		g := actionFinalityGateway(t, proofFixture)
		original, err := g.lookupPQActionOriginal(context.Background(), consensus.SignedTransactionHash(wire))
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			terms = original
		}
		if i == 1 {
			paid = original
		}
		for _, route := range []string{original.ReadbackURL + "/pq-finality-proof", "/txs/" + original.ABCITransactionHash + "/pq-action-finality-proof"} {
			status, v := finalityRouteGET(t, g, route)
			if status != 200 || v.Status != "collected" || v.Proof == nil || v.IndependentFinality || v.ProofVerification != "not-performed" {
				t.Fatalf("invoice real result proof %s: HTTP%d %+v", kind, status, v)
			}
			var result abci.ExecTxResult
			if err = result.Unmarshal(v.Proof.ExecutionResult); err != nil || !bytes.Equal(result.Data, original.ExecutionData) {
				t.Fatal("proof lost exact deterministic invoice result", err)
			}
			var txProof cmttypes.TxProof
			var resultProof merkle.Proof
			if cmtjson.Unmarshal(v.Proof.TransactionProof, &txProof) != nil || txProof.Validate(proofFixture.blocks[0].DataHash) != nil || !bytes.Equal(txProof.Data, raw) || cmtjson.Unmarshal(v.Proof.ExecutionProof, &resultProof) != nil || resultProof.Verify(proofFixture.blocks[1].LastResultsHash, v.Proof.ExecutionResult) != nil || resultProof.Index != txProof.Proof.Index || resultProof.Total != txProof.Proof.Total {
				t.Fatal("real stored invoice Merkle paths lost exact original/result")
			}
			block := proofFixture.blocks[0]
			successor := proofFixture.blocks[1]
			nativeHash := sha256.Sum256(wire)
			expected := consensus.PQTransactionProofExpectation{Block: consensus.PQLightProofExpectation{ChainID: block.ChainID, HeaderHeight: block.Height, BlockHash: block.Header.Hash(), StateHeight: block.Height - 1, StateAppHash: block.AppHash}, Successor: consensus.PQLightProofExpectation{ChainID: successor.ChainID, HeaderHeight: successor.Height, BlockHash: successor.Header.Hash(), StateHeight: successor.Height - 1, StateAppHash: successor.AppHash}, TransactionType: consensus.PQActionType, Envelope: raw, NativeWire: wire, TransactionHash: proofFixture.tx.Hash, NativeWireHash: nativeHash[:], Index: 0}
			_, err = consensus.VerifyPQTransactionProof(consensus.PQLightProofTrust{}, expected, *v.Proof)
			var trustErr *consensus.PQLightProofError
			if !errors.As(err, &trustErr) || trustErr.Code != "invalid_trust" {
				t.Fatal("invoice RPC evidence became independent light trust", err)
			}
		}
		if sibling != nil {
			failed := engine.observation(t, height, 1)
			fg := actionFinalityGateway(t, failed)
			status, v := finalityRouteGET(t, fg, "/txs/"+consensus.SignedTransactionHash(sibling)+"/pq-action-finality-proof")
			if status != 200 || v.Proof == nil || v.ObservedExecutionStatus != "rejected" {
				t.Fatal("actual nonce competition lacks terminal rejection proof", status, v.Error)
			}
			var r abci.ExecTxResult
			if r.Unmarshal(v.Proof.ExecutionResult) != nil || r.Code == 0 || len(r.Data) != 0 {
				t.Fatal("rejected invoice acquired success data")
			}
		}
		proofFixture.status.SyncInfo.LatestBlockHeight = proofFixture.tx.Height
		proofFixture.status.SyncInfo.LatestBlockHash = proofFixture.blocks[0].Header.Hash()
		if status, v := finalityRouteGET(t, g, original.ReadbackURL+"/pq-finality-proof"); status != 202 || v.Status != "pending" || v.Proof != nil {
			t.Fatal("missing H+1 not pending", status)
		}
		proofFixture.status.SyncInfo.LatestBlockHeight++
		proofFixture.status.SyncInfo.LatestBlockHash = proofFixture.blocks[1].Header.Hash()
		old := bytes.Clone(proofFixture.tx.TxResult.Data)
		var e consensus.PQInvoiceEffect
		_ = json.Unmarshal(old, &e)
		e.NetPaid++
		proofFixture.tx.TxResult.Data, _ = json.Marshal(e)
		if status, v := finalityRouteGET(t, g, original.ReadbackURL+"/pq-finality-proof"); status == 200 || v.Proof != nil {
			t.Fatal("inconsistent indexed invoice result proved")
		}
		proofFixture.tx.TxResult.Data = old
		// A real cold application reads the same original state and history; no
		// block/result file is reconstructed from a response or replaced.
		if err = engine.conns.Stop(); err != nil {
			t.Fatal(err)
		}
		f.a, err = consensus.NewPersistentApplicationWithInvoiceAuthorization(f.migration, engine.path, engine.boot, nil, nil, authorization)
		if err != nil {
			t.Fatal(err)
		}
		engine.conns = proxy.NewAppConns(proxy.NewLocalClientCreator(f.a), proxy.NopMetrics())
		if err = engine.conns.Start(); err != nil {
			t.Fatal(err)
		}
		engine.bound = sm.WithConsensusAuthorityStore(engine.store, f.a)
		cold := engine.observation(t, height, 0)
		if status, v := finalityRouteGET(t, actionFinalityGateway(t, cold), original.ReadbackURL+"/pq-finality-proof"); status != 200 || v.Proof == nil {
			t.Fatal("cold invoice finality original unavailable", status)
		}
	}
}
