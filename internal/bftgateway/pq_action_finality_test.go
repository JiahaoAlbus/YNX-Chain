package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
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
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/proxy"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// Real Application, handshake, BlockExecutor, complete original validator
// signatures and persisted block/results supply the HTTP collector. Only the
// RPC transport is substituted. No Node.Start, invented result/header, public
// network identity or independent light-trust claim is used by these tests.
type pqActionFinalityEngine struct {
	f      *pqGatewayFixture
	path   string
	boot   *consensus.ConsensusBootstrap
	doc    *cmttypes.GenesisDoc
	store  sm.Store
	bound  sm.Store
	blocks *blockstore.BlockStore
	conns  proxy.AppConns
	keys   map[string]ed25519.PrivKey
}

func newPQActionFinalityEngine(t *testing.T, f *pqGatewayFixture) *pqActionFinalityEngine {
	t.Helper()
	e := &pqActionFinalityEngine{f: f, path: filepath.Join(t.TempDir(), "action-state.json"), keys: map[string]ed25519.PrivKey{}}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, v := range f.migration.Validators {
		key := ed25519.GenPrivKeyFromSecret([]byte(fmt.Sprintf("typed-finality-original-validator-%d", i)))
		e.keys[string(key.PubKey().Address())] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(key.PubKey().Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(key.PubKey().Address()))})
	}
	var err error
	f.migration, err = f.migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	e.doc, err = consensus.BuildCometGenesis(f.migration, time.Date(2026, 10, 18, 1, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(e.doc)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	e.boot, err = consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(digest[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	f.a, err = consensus.NewPersistentApplicationWithBootstrap(f.migration, e.path, e.boot)
	if err != nil {
		t.Fatal(err)
	}
	db, blockDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blockDB.Close() })
	e.store, e.blocks = sm.NewStore(db, sm.StoreOptions{}), blockstore.NewBlockStore(blockDB)
	e.conns = proxy.NewAppConns(proxy.NewLocalClientCreator(f.a), proxy.NopMetrics())
	if err = e.conns.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.conns.Stop() })
	initial, err := sm.MakeGenesisState(e.doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = e.store.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(e.store, initial, e.blocks, e.doc)
	handshake.SetConsensusAuthoritySource(f.a)
	if err = handshake.Handshake(e.conns); err != nil {
		t.Fatal(err)
	}
	e.bound = sm.WithConsensusAuthorityStore(e.store, f.a)
	return e
}

func (e *pqActionFinalityEngine) apply(t *testing.T, txs ...[]byte) (int64, *abci.ResponseFinalizeBlock) {
	t.Helper()
	state, err := e.bound.Load()
	if err != nil {
		t.Fatal(err)
	}
	height, previous := state.LastBlockHeight+1, &cmttypes.Commit{}
	if state.LastBlockHeight == 0 {
		height = state.InitialHeight
	} else {
		previous = e.blocks.LoadSeenCommit(state.LastBlockHeight)
	}
	values := make(cmttypes.Txs, len(txs))
	for i := range txs {
		values[i] = bytes.Clone(txs[i])
	}
	block, err := state.MakeBlock(height, values, previous, nil, state.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	commit := &cmttypes.Commit{Height: height, BlockID: id}
	for _, v := range state.Validators.Validators {
		commit.Signatures = append(commit.Signatures, cmttypes.CommitSig{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: v.Address, Timestamp: block.Time.Add(time.Second)})
	}
	for i, v := range state.Validators.Validators {
		key, ok := e.keys[string(v.Address)]
		if !ok {
			t.Fatal("original validator key is unavailable")
		}
		commit.Signatures[i].Signature, err = key.Sign(commit.VoteSignBytes(e.doc.ChainID, int32(i)))
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = state.Validators.VerifyCommit(e.doc.ChainID, id, height, commit); err != nil {
		t.Fatal("actual original commit signatures:", err)
	}
	e.blocks.SaveBlock(block, parts, commit)
	executor := sm.NewBlockExecutor(e.bound, log.NewNopLogger(), e.conns.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, e.blocks)
	if _, err = executor.ApplyBlock(state, id, block); err != nil {
		t.Fatal("actual typed BlockExecutor:", err)
	}
	result, err := e.store.LoadFinalizeBlockResponse(height)
	if err != nil || result == nil {
		t.Fatal("actual stored result missing", err)
	}
	return height, result
}

func (e *pqActionFinalityEngine) observation(t *testing.T, height int64, index int) *pqFinalityFixture {
	t.Helper()
	block := e.blocks.LoadBlock(height)
	results, err := e.store.LoadFinalizeBlockResponse(height)
	if err != nil || block == nil || results == nil || index < 0 || index >= len(block.Data.Txs) || len(results.TxResults) != len(block.Data.Txs) || results.TxResults[index] == nil {
		t.Fatal("actual transaction/result unavailable", err)
	}
	tx := block.Data.Txs[index]
	wire, _, err := consensus.DecodePQActionTransport(tx)
	if err != nil {
		t.Fatal(err)
	}
	// Reuse the existing bounded RPC harness for every endpoint except its
	// single-Member history path. The Action query is the real Application query.
	copyFixture := *e.f
	copyFixture.wire, copyFixture.payload = wire, bytes.Clone(tx)
	v := &pqFinalityFixture{f: &copyFixture, statePath: e.path, bootstrap: e.boot, tx: coretypes.ResultTx{Hash: tx.Hash(), Height: height, Index: uint32(index), TxResult: *results.TxResults[index], Tx: tx, Proof: block.Data.Txs.Proof(index)}}
	v.results = coretypes.ResultBlockResults{Height: height, TxsResults: results.TxResults, FinalizeBlockEvents: results.Events, ValidatorUpdates: results.ValidatorUpdates, ConsensusParamUpdates: results.ConsensusParamUpdates, AppHash: results.AppHash}
	for i := range v.blocks {
		h := height + int64(i)
		b, commit := e.blocks.LoadBlock(h), e.blocks.LoadSeenCommit(h)
		if i == 0 {
			commit = e.blocks.LoadBlockCommit(h)
		}
		set, err := e.store.LoadValidators(h)
		if err != nil || b == nil || commit == nil || set == nil {
			t.Fatal("actual H/H+1 material missing", err)
		}
		v.blocks[i] = *coretypes.NewResultCommit(&b.Header, commit, i == 0)
		v.validators[i] = coretypes.ResultValidators{BlockHeight: h, Validators: set.Validators, Count: len(set.Validators), Total: len(set.Validators)}
	}
	v.status.NodeInfo.Network = e.doc.ChainID
	v.status.SyncInfo = coretypes.SyncInfo{LatestBlockHeight: height + 1, EarliestBlockHeight: e.doc.InitialHeight, LatestBlockHash: v.blocks[1].Header.Hash(), EarliestBlockHash: e.blocks.LoadBlock(e.doc.InitialHeight).Hash()}
	return v
}

func actionFinalityGateway(t *testing.T, f *pqFinalityFixture) *Gateway {
	t.Helper()
	other := f.serve(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/abci_query" {
			other.ServeHTTP(w, r)
			return
		}
		f.requests = append(f.requests, r.URL.RequestURI())
		if r.Method != http.MethodGet {
			t.Error("typed collector attempted a mutation")
			w.WriteHeader(405)
			return
		}
		path, err := strconv.Unquote(r.URL.Query().Get("path"))
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		result, err := f.f.a.Query(r.Context(), &abci.RequestQuery{Path: path})
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		raw, err := cmtjson.Marshal(&coretypes.ResultABCIQuery{Response: *result})
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		if f.mutate != nil {
			raw = f.mutate(r.URL.Path, raw)
		}
		_, _ = w.Write(append(append([]byte(`{"jsonrpc":"2.0","id":-1,"result":`), raw...), '}'))
	}))
	t.Cleanup(server.Close)
	g, err := New(Config{CometRPCURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func actionFinalityRoutes(f *pqFinalityFixture) (string, string) {
	return "/transactions/pq/actions/originals/" + consensus.SignedTransactionHash(f.f.wire) + "/pq-finality-proof", "/txs/" + consensus.SignedTransactionHash(f.f.payload) + "/pq-action-finality-proof"
}

func assertActionFinalityProof(t *testing.T, f *pqFinalityFixture, got PQFinalityView, rejected bool) {
	t.Helper()
	wantStatus := "committed"
	if rejected {
		wantStatus = "rejected"
	}
	if got.Status != "collected" || got.Source != "configured-comet-rpc" || got.ProofVerification != "not-performed" || got.IndependentFinality || got.ObservedExecutionStatus != wantStatus || got.NativeTransactionHash != consensus.SignedTransactionHash(f.f.wire) || got.ABCITransactionHash != consensus.SignedTransactionHash(f.f.payload) || got.NativeTransactionHash == got.ABCITransactionHash || got.CometIndex == nil || *got.CometIndex != f.tx.Index || got.ExecutionHeight != uint64(f.tx.Height) || got.Proof == nil {
		t.Fatalf("typed original proof identity/outcome missing: %+v", got)
	}
	raw, err := json.Marshal(got.Proof)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := consensus.DecodePQTransactionProofRequest(raw)
	if err != nil {
		t.Fatal("normal compiled proof decoder:", err)
	}
	var tx cmttypes.TxProof
	var result abci.ExecTxResult
	var resultProof merkle.Proof
	if cmtjson.Unmarshal(proof.TransactionProof, &tx) != nil || tx.Validate(f.blocks[0].DataHash) != nil || !bytes.Equal(tx.Data, f.f.payload) || result.Unmarshal(proof.ExecutionResult) != nil || cmtjson.Unmarshal(proof.ExecutionProof, &resultProof) != nil || resultProof.Verify(f.blocks[1].LastResultsHash, proof.ExecutionResult) != nil || tx.Proof.Index != int64(f.tx.Index) || resultProof.Index != tx.Proof.Index || resultProof.Total != tx.Proof.Total || result.Code != f.tx.TxResult.Code || (result.Code != 0) != rejected {
		t.Fatal("typed original did not retain real indexed bytes and deterministic result proof")
	}
	if rejected && len(result.Data) != 0 || !rejected && !bytes.Equal(result.Data, []byte(got.ABCITransactionHash)) {
		t.Fatal("typed execution Data lost the actual original outcome")
	}
	// No RPC response is promoted into a light-trust snapshot. The normal
	// compiled verifier must still refuse this proof without independent trust.
	header := func(b coretypes.ResultCommit) consensus.PQLightProofExpectation {
		return consensus.PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: b.Header.Hash(), StateHeight: b.Height - 1, StateAppHash: b.AppHash}
	}
	native := sha256.Sum256(f.f.wire)
	expected := consensus.PQTransactionProofExpectation{Block: header(f.blocks[0]), Successor: header(f.blocks[1]), TransactionType: consensus.PQActionType, Envelope: f.f.payload, NativeWire: f.f.wire, TransactionHash: f.tx.Tx.Hash(), NativeWireHash: native[:], Index: int64(f.tx.Index)}
	_, err = consensus.VerifyPQTransactionProof(consensus.PQLightProofTrust{}, expected, proof)
	var trustError *consensus.PQLightProofError
	if !errors.As(err, &trustError) || trustError.Code != "invalid_trust" {
		t.Fatal("typed proof must pass the normal transaction codec and stop at missing independent light trust", err)
	}
}

func TestGatewayPQActionFinalityOriginalsActualExecutorAndColdRead(t *testing.T) {
	f, _, classic := newGatewayMigrationFixture(t)
	e := newPQActionFinalityEngine(t, f)
	validator := f.migration.Validators[0].Address
	legacy, err := consensus.NewSignedApplicationAction(classic, f.migration.Network.ChainID, consensus.ActionStakeDelegate, consensus.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 1)
	if err != nil {
		t.Fatal(err)
	}
	original, err := consensus.EncodeSignedApplicationAction(legacy)
	if err != nil {
		t.Fatal(err)
	}
	_, first := e.apply(t, original)
	if len(first.TxResults) != 1 || first.TxResults[0].Code != 0 {
		t.Fatal("actual classic original failed", first)
	}
	migration, err := ynxauth.DecodeMigration(f.wire)
	if err != nil {
		t.Fatal(err)
	}
	migration.Intent.LedgerNonce, migration.Intent.ActivateAt = 2, 4
	message, err := migration.Intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(message)
	migration.ClassicSignature = ecdsa.Sign(classic, digest[:]).Serialize()
	migration.NewKeyProof = signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})
	migrationWire, err := migration.Encode()
	if err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := consensus.EncodePQTransaction(consensus.PQMigrationType, migrationWire)
	if err != nil {
		t.Fatal(err)
	}
	_, registered := e.apply(t, migrationRaw)
	if len(registered.TxResults) != 1 || registered.TxResults[0].Code != 0 {
		t.Fatal("actual migration failed", registered)
	}
	var payloads [][]byte
	for _, amount := range []uint64{7, 8} {
		wire := gatewayActionWire(t, f, ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: consensus.StakingDelegationID(f.owner, validator), AmountYNXT: amount}, 3, 1, 2)
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil || member.Certificate.N != 2 || member.Index != 1 {
			t.Fatal("fixture lost legal N2/index1")
		}
		raw, err := consensus.EncodePQStakingActionTransaction(wire, [][]byte{original})
		if err != nil {
			t.Fatal(err)
		}
		check, err := f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
		if err != nil || check.Code != 0 {
			t.Fatal("competing typed Member not independently admissible", err, check)
		}
		payloads = append(payloads, raw)
	}
	before := queryPQGatewayAccount(t, f.a, f.owner)
	height, results := e.apply(t, payloads...)
	if len(results.TxResults) != 2 || results.TxResults[0].Code != 0 || results.TxResults[1].Code == 0 || len(results.TxResults[1].Data) != 0 {
		t.Fatal("actual typed mixed outcomes differ", results)
	}
	e.apply(t)
	after := queryPQGatewayAccount(t, f.a, f.owner)
	if after.Nonce != 3 || after.Balance != before.Balance-1 || after.Staked != before.Staked-7 || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+1 {
		t.Fatal("rejected typed sibling changed fee/nonce/business usage")
	}
	good, failed := e.observation(t, height, 0), e.observation(t, height, 1)
	g := actionFinalityGateway(t, good)
	nativeRoute, outerRoute := actionFinalityRoutes(good)
	disk, err := os.ReadFile(e.path)
	if err != nil {
		t.Fatal(err)
	}
	var baseline PQFinalityView
	for _, route := range []string{nativeRoute, outerRoute} {
		code, got := finalityRouteGET(t, g, route)
		if code != 200 {
			t.Fatalf("normal typed collector: %d %s", code, got.Error)
		}
		assertActionFinalityProof(t, good, got, false)
		baseline = got
	}
	if *baseline.CometIndex != 0 {
		t.Fatal("Member index was substituted for actual Comet index")
	}
	_, _, retained, err := consensus.DecodePQStakingActionTransaction(payloads[0])
	if err != nil || len(retained) != 1 || !bytes.Equal(retained[0], original) {
		t.Fatal("fixture discarded original staking bytes")
	}
	for _, route := range []string{"/txs/" + baseline.ABCITransactionHash + "/pq-finality-proof", "/transactions/pq/originals/" + baseline.NativeTransactionHash + "/finality-proof"} {
		if code, got := finalityRouteGET(t, g, route); code != 502 || got.Proof != nil {
			t.Fatal("old single-Member route silently accepted typed transport")
		}
	}
	badGateway := actionFinalityGateway(t, failed)
	failedNative, failedOuter := actionFinalityRoutes(failed)
	code, rejected := finalityRouteGET(t, badGateway, failedOuter)
	if code != 200 {
		t.Fatalf("terminal typed rejection proof: %d %s", code, rejected.Error)
	}
	assertActionFinalityProof(t, failed, rejected, true)
	for _, path := range failed.requests {
		if strings.HasPrefix(path, "/abci_query") {
			t.Fatal("rejected typed proof demanded nonexistent successful history")
		}
	}
	if code, got := finalityRouteGET(t, badGateway, failedNative); code != 502 || got.Proof != nil {
		t.Fatal("absent rejected native history became a successful observation")
	}
	failed.mutate = func(path string, raw []byte) []byte {
		if path != "/tx" {
			return raw
		}
		var tx coretypes.ResultTx
		if cmtjson.Unmarshal(raw, &tx) != nil {
			t.Error("invalid actual rejected transaction")
			return nil
		}
		tx.TxResult.Data = []byte(consensus.SignedTransactionHash(failed.f.payload))
		b, err := cmtjson.Marshal(&tx)
		if err != nil {
			t.Error(err)
			return nil
		}
		return b
	}
	if code, got := finalityRouteGET(t, badGateway, failedOuter); code != 502 || got.Proof != nil {
		t.Fatal("rejected typed result gained success identity data")
	}
	failed.mutate = nil
	failed.status.SyncInfo.LatestBlockHeight, failed.status.SyncInfo.LatestBlockHash = failed.tx.Height, failed.blocks[0].Header.Hash()
	if code, got := finalityRouteGET(t, badGateway, failedOuter); code != 202 || got.Status != "pending" || got.ObservedExecutionStatus != "rejected" || got.Proof != nil {
		t.Fatal("rejected typed result claimed finality before successor commitment")
	}
	assertActionFinalityNegativeReads(t, good, g, nativeRoute, outerRoute)
	good.f.a, err = consensus.NewPersistentApplicationWithBootstrap(f.migration, e.path, e.boot)
	if err != nil {
		t.Fatal(err)
	}
	code, cold := finalityRouteGET(t, g, outerRoute)
	if code != 200 || !reflect.DeepEqual(cold, baseline) || !reflect.DeepEqual(after, queryPQGatewayAccount(t, good.f.a, f.owner)) {
		t.Fatal("cold typed proof changed committed original or account", code, cold.Error)
	}
	finalDisk, err := os.ReadFile(e.path)
	if err != nil || !bytes.Equal(disk, finalDisk) {
		t.Fatal("read-only collector modified original persisted state", err)
	}
}

func assertActionFinalityNegativeReads(t *testing.T, f *pqFinalityFixture, g *Gateway, nativeRoute, outerRoute string) {
	t.Helper()
	for _, mode := range []string{"wire", "originals", "index", "height", "native-history", "history-effects", "history-source", "history-height", "result", "successor-link", "unavailable"} {
		t.Run(mode, func(t *testing.T) {
			f.mutate = func(path string, raw []byte) []byte {
				marshal := func(value any) []byte {
					b, err := cmtjson.Marshal(value)
					if err != nil {
						t.Error(err)
						return nil
					}
					return b
				}
				if path == "/tx" {
					if mode == "unavailable" {
						return []byte("null")
					}
					var tx coretypes.ResultTx
					if cmtjson.Unmarshal(raw, &tx) != nil {
						t.Error("invalid fixture tx")
						return nil
					}
					switch mode {
					case "wire":
						tx.Hash = bytes.Repeat([]byte{1}, 32)
					case "originals":
						wire, _, _, err := consensus.DecodePQStakingActionTransaction(tx.Tx)
						if err != nil {
							t.Error(err)
							return nil
						}
						transport, err := consensus.EncodePQStakingActionTransaction(wire, nil)
						if err != nil {
							t.Error(err)
							return nil
						}
						tx.Tx = transport
						tx.Hash = tx.Tx.Hash()
					case "index":
						tx.Index++
					case "height":
						tx.Height++
					case "result":
						tx.TxResult.GasUsed++
					}
					return marshal(&tx)
				}
				if path == "/abci_query" {
					var q coretypes.ResultABCIQuery
					var history consensus.PQActionHistoryView
					if cmtjson.Unmarshal(raw, &q) != nil || json.Unmarshal(q.Response.Value, &history) != nil {
						t.Error("invalid real action query")
						return nil
					}
					switch mode {
					case "native-history":
						history.Transport = append(bytes.Clone(history.Transport), ' ')
					case "history-effects":
						history.Effects = []byte(`{}`)
					case "history-source":
						history.Source = "source_import"
					case "history-height":
						q.Response.Height++
					}
					q.Response.Value, _ = json.Marshal(history)
					return marshal(&q)
				}
				if mode == "successor-link" && path == "/commit" {
					var c coretypes.ResultCommit
					if cmtjson.Unmarshal(raw, &c) != nil {
						t.Error("invalid stored commit")
						return nil
					}
					if c.Height == f.tx.Height+1 {
						c.LastBlockID.PartSetHeader.Total++
					}
					return marshal(&c)
				}
				return raw
			}
			defer func() { f.mutate = nil }()
			for _, route := range []string{nativeRoute, outerRoute} {
				code, got := finalityRouteGET(t, g, route)
				if code != 502 || got.Proof != nil || got.Status != "unavailable" || got.IndependentFinality || got.ProofVerification != "not-performed" {
					t.Fatalf("%s accepted altered original/evidence: %d %+v", mode, code, got)
				}
			}
		})
	}
	oldStatus := f.status
	f.status.SyncInfo.LatestBlockHeight, f.status.SyncInfo.LatestBlockHash = f.tx.Height, f.blocks[0].Header.Hash()
	code, pending := finalityRouteGET(t, g, outerRoute)
	f.status = oldStatus
	if code != 202 || pending.Status != "pending" || pending.Proof != nil || pending.IndependentFinality {
		t.Fatal("typed H without H+1 was promoted to finality")
	}
	for _, route := range []string{nativeRoute + "?height=4", strings.Replace(outerRoute, "/0x", "/0X", 1)} {
		before := len(f.requests)
		code, _ := finalityRouteGET(t, g, route)
		if code != 400 || len(f.requests) != before {
			t.Fatal("noncanonical typed route reached RPC")
		}
	}
	redirectCalls := 0
	redirected := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectCalls++
		w.WriteHeader(http.StatusOK)
	}))
	defer redirected.Close()
	f.redirect = redirected.URL
	code, unknown := finalityRouteGET(t, g, outerRoute)
	f.redirect = ""
	if code != 502 || unknown.Proof != nil || unknown.ABCITransactionHash != consensus.SignedTransactionHash(f.f.payload) || redirectCalls != 0 {
		t.Fatal("typed collector followed an unknown redirect or lost the requested original")
	}
}

func TestGatewayPQActionFinalityRetainsCompiledContractTransport(t *testing.T) {
	source, material, deploy := gatewayActionMaterial(t)
	f, _, _ := newGatewayMigrationFixture(t)
	e := newPQActionFinalityEngine(t, f)
	_, migrated := e.apply(t, f.payload)
	if len(migrated.TxResults) != 1 || migrated.TxResults[0].Code != 0 {
		t.Fatal("actual migration failed")
	}
	before := gatewayRevocationPolicy(t, f, f.owner)
	wire := gatewayActionWire(t, f, ynxauth.ActionContractDeploy, deploy, 2, ynxauth.ContractDeployFee, 2)
	raw, err := consensus.EncodePQContractTransaction(wire, source, &material)
	if err != nil {
		t.Fatal(err)
	}
	height, results := e.apply(t, raw)
	if len(results.TxResults) != 1 || results.TxResults[0].Code != 0 {
		t.Fatal("actual compiled deployment failed", results)
	}
	e.apply(t)
	observation := e.observation(t, height, 0)
	g := actionFinalityGateway(t, observation)
	native, outer := actionFinalityRoutes(observation)
	var publicGETs []pqContractDeployPublicHTTP
	for _, route := range []string{native, outer} {
		response := capturePQContractDeployGET(t, g, route)
		var got PQFinalityView
		if err := json.Unmarshal(response.Body, &got); err != nil {
			t.Fatal(err)
		}
		code, err := strconv.Atoi(response.StatusCode)
		if err != nil {
			t.Fatal(err)
		}
		if code != 200 {
			t.Fatal("compiled action proof unavailable", code, got.Error)
		}
		assertActionFinalityProof(t, observation, got, false)
		var tx cmttypes.TxProof
		if cmtjson.Unmarshal(got.Proof.TransactionProof, &tx) != nil || !bytes.Equal(tx.Data, raw) || !bytes.Contains(tx.Data, []byte(`"material"`)) {
			t.Fatal("compiled materials were dropped or reconstructed")
		}
		publicGETs = append(publicGETs, response)
	}
	for _, route := range []string{"/transactions/pq/actions/originals/" + consensus.SignedTransactionHash(wire), "/transactions/pq/actions/" + consensus.SignedTransactionHash(raw)} {
		response := capturePQContractDeployGET(t, g, route)
		var got PQActionView
		if response.StatusCode != "200" || json.Unmarshal(response.Body, &got) != nil || !got.Committed || got.Source != "comet-rpc" || got.Type != ynxauth.ActionContractDeploy || !bytes.Equal(got.Wire, wire) || !bytes.Equal(got.Transport, raw) || got.NativeTransactionHash != consensus.SignedTransactionHash(wire) || got.ABCITransactionHash != consensus.SignedTransactionHash(raw) || got.CometIndex == nil || *got.CometIndex != 0 || got.ExecutionHeight != uint64(height) {
			t.Fatal("compiled deployment GET lost its actual original or receipt")
		}
		publicGETs = append(publicGETs, response)
	}
	observation.mutate = func(path string, data []byte) []byte {
		if path != "/tx" {
			return data
		}
		var tx coretypes.ResultTx
		if cmtjson.Unmarshal(data, &tx) != nil {
			t.Error("invalid actual contract transaction")
			return nil
		}
		// The same Member without its deployed source/material is not the
		// original transaction, even if an RPC reports the old tx hash.
		bare, err := json.Marshal(consensus.PQTransaction{Version: 1, Type: consensus.PQActionType, WireHex: hex.EncodeToString(wire)})
		if err != nil {
			t.Error(err)
			return nil
		}
		tx.Tx = bare
		b, err := cmtjson.Marshal(&tx)
		if err != nil {
			t.Error(err)
			return nil
		}
		return b
	}
	if code, got := finalityRouteGET(t, g, outer); code != 502 || got.Proof != nil {
		t.Fatal("compiled transport silently became a bare Member")
	}
	emitPQContractDeployPublicFixture(t, observation, before, source, material, deploy, publicGETs)
}
