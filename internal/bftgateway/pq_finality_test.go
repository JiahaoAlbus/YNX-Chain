package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	cmtversion "github.com/cometbft/cometbft/proto/tendermint/version"
	"github.com/cometbft/cometbft/proxy"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	rpctypes "github.com/cometbft/cometbft/rpc/jsonrpc/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/cometbft/cometbft/version"
)

// Real PQ admission/execution/persistence supplies every indexed tx/result.
// Synthetic signed Comet headers supply RPC transport only: no node starts and
// this fixture never represents independently authenticated chain finality.
type pqFinalityFixture struct {
	f          *pqGatewayFixture
	statePath  string
	bootstrap  *consensus.ConsensusBootstrap
	tx         coretypes.ResultTx
	results    coretypes.ResultBlockResults
	blocks     [2]coretypes.ResultCommit
	validators [2]coretypes.ResultValidators
	status     coretypes.ResultStatus
	mutate     func(string, []byte) []byte
	redirect   string
	requests   []string
}

func newPQFinalityFixture(t *testing.T, kind string) *pqFinalityFixture {
	t.Helper()
	f, path, _ := newGatewayMigrationFixture(t)
	chainID := fmt.Sprintf("ynx_%d-1", f.migration.Network.ChainID)
	initial, err := f.a.InitChain(context.Background(), &abci.RequestInitChain{ChainId: chainID, InitialHeight: int64(f.migration.Height) + 1})
	if err != nil || len(initial.AppHash) != 32 {
		t.Fatalf("real initial app hash unavailable: %v", err)
	}
	h := int64(2)
	if kind != consensus.PQMigrationType {
		commitGatewayRevocationBlock(t, f, 2, f.payload)
		h = 3
		switch kind {
		case consensus.PQTransferType:
			f.wire = signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 2, 7))
		case consensus.PQRevocationType:
			policy := gatewayRevocationPolicy(t, f, f.owner)
			record := policy.Policy.Records[0]
			f.wire = signGatewayRevocation(t, f.key, ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: record.PKA, PKB: record.PKB, AuthorizingRevision: 1, ThroughRevision: 1, LedgerNonce: 2, ExecuteAt: 3, RevokeAt: 4})
		default:
			t.Fatal("unsupported fixture original")
		}
		var err error
		f.payload, err = consensus.EncodePQTransaction(kind, f.wire)
		if err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	check, err := f.a.CheckTx(ctx, &abci.RequestCheckTx{Tx: f.payload})
	if err != nil || check.Code != 0 {
		t.Fatalf("real original admission failed: %v %+v", err, check)
	}
	before, err := f.a.Info(ctx, &abci.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	priorAppHash := before.LastBlockAppHash
	if len(priorAppHash) == 0 {
		priorAppHash = initial.AppHash
	}
	// A real failed sibling makes the successful original index nonzero and
	// makes both Merkle paths nontrivial; the failure is retained, not removed.
	txs := cmttypes.Txs{cmttypes.Tx("invalid synthetic sibling"), cmttypes.Tx(f.payload)}
	out, err := f.a.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{txs[0], txs[1]}})
	if err != nil || len(out.TxResults) != 2 || out.TxResults[0].Code == 0 || out.TxResults[1].Code != 0 {
		t.Fatalf("real mixed block execution failed: %v %+v", err, out)
	}
	if _, err = f.a.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	v := &pqFinalityFixture{f: f, statePath: path}
	v.tx = coretypes.ResultTx{Hash: txs[1].Hash(), Height: h, Index: 1, TxResult: *out.TxResults[1], Tx: txs[1], Proof: txs.Proof(1)}
	v.results = coretypes.ResultBlockResults{Height: h, TxsResults: out.TxResults, FinalizeBlockEvents: out.Events, ValidatorUpdates: out.ValidatorUpdates, ConsensusParamUpdates: out.ConsensusParamUpdates, AppHash: out.AppHash}
	key := ed25519.GenPrivKeyFromSecret([]byte("public-pq-finality-collector-fixture"))
	set := cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(key.PubKey(), 10)})
	params := cmttypes.DefaultConsensusParams()
	params.Version.App = consensus.ApplicationVersion
	for i := range v.blocks {
		header := &cmttypes.Header{Version: cmtversion.Consensus{Block: version.BlockProtocol, App: consensus.ApplicationVersion}, ChainID: chainID, Height: h + int64(i), Time: time.Unix(h+int64(i), 0).UTC(), ValidatorsHash: set.Hash(), NextValidatorsHash: set.Hash(), ConsensusHash: params.Hash(), ProposerAddress: set.GetProposer().Address}
		if i == 0 {
			header.DataHash, header.AppHash = txs.Hash(), priorAppHash
		} else {
			header.LastBlockID = v.blocks[0].Commit.BlockID
			header.LastCommitHash = v.blocks[0].Commit.Hash()
			header.AppHash, header.LastResultsHash = out.AppHash, cmttypes.NewResults(out.TxResults).Hash()
		}
		parts := sha256.Sum256([]byte(fmt.Sprintf("public-finality-parts-%d", i)))
		commit := &cmttypes.Commit{Height: header.Height, BlockID: cmttypes.BlockID{Hash: header.Hash(), PartSetHeader: cmttypes.PartSetHeader{Total: 1, Hash: parts[:]}}, Signatures: []cmttypes.CommitSig{{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: key.PubKey().Address(), Timestamp: header.Time}}}
		commit.Signatures[0].Signature, err = key.Sign(commit.VoteSignBytes(chainID, 0))
		if err != nil {
			t.Fatal(err)
		}
		v.blocks[i] = *coretypes.NewResultCommit(header, commit, true)
		v.validators[i] = coretypes.ResultValidators{BlockHeight: header.Height, Validators: set.Validators, Count: 1, Total: 1}
	}
	v.status.NodeInfo.Network = chainID
	v.status.SyncInfo = coretypes.SyncInfo{LatestBlockHeight: h + 1, EarliestBlockHeight: h, LatestBlockHash: v.blocks[1].Header.Hash(), EarliestBlockHash: v.blocks[0].Header.Hash()}
	return v
}

func (f *pqFinalityFixture) serve(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests = append(f.requests, r.URL.RequestURI())
		if r.Method != http.MethodGet {
			t.Error("collector attempted a mutation")
			w.WriteHeader(405)
			return
		}
		if f.redirect != "" {
			http.Redirect(w, r, f.redirect, http.StatusTemporaryRedirect)
			return
		}
		// Normal Comet RPC methods return pointers. An unaddressable value
		// bypasses nested ABCI pointer MarshalJSON methods and omits defaults,
		// producing a different grammar from the real RPC response.
		var value any
		switch r.URL.Path {
		case "/abci_query":
			path, err := strconv.Unquote(r.URL.Query().Get("path"))
			if err != nil || path != consensus.PQWalletHistoryPath+consensus.SignedTransactionHash(f.f.wire) {
				t.Error("wrong original history lookup")
				w.WriteHeader(400)
				return
			}
			response, err := f.f.a.Query(r.Context(), &abci.RequestQuery{Path: path})
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			value = &coretypes.ResultABCIQuery{Response: *response}
		case "/tx":
			if r.URL.Query().Get("hash") != consensus.SignedTransactionHash(f.f.payload) || r.URL.Query().Get("prove") != "true" {
				t.Error("original proof query lost exact ABCI hash or prove=true")
			}
			value = &f.tx
		case "/status":
			value = &f.status
		case "/block_results":
			if r.URL.Query().Get("height") != strconv.FormatInt(f.tx.Height, 10) {
				t.Error("result query lost exact height")
			}
			value = &f.results
		case "/commit", "/validators":
			h, err := strconv.ParseInt(r.URL.Query().Get("height"), 10, 64)
			i := h - f.tx.Height
			if err != nil || i < 0 || i > 1 {
				t.Error("unbound commit height")
				w.WriteHeader(400)
				return
			}
			if r.URL.Path == "/commit" {
				value = &f.blocks[i]
			} else {
				if r.URL.Query().Get("page") != "1" || r.URL.Query().Get("per_page") != "100" {
					t.Error("unbounded validator lookup")
				}
				value = &f.validators[i]
			}
		default:
			t.Error("unexpected collector RPC", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		raw, err := cmtjson.Marshal(value)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		if f.mutate != nil {
			raw = f.mutate(r.URL.Path, raw)
		}
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":-1,"result":`))
		_, _ = w.Write(raw)
		_, _ = w.Write([]byte(`}`))
	})
}

func TestGatewayPQFinalityUsesNormalRPCPointerEncoding(t *testing.T) {
	query := coretypes.ResultABCIQuery{Response: abci.ResponseQuery{Height: 2, Value: []byte(`{"public":"original"}`)}}
	response := rpctypes.NewRPCSuccessResponse(rpctypes.JSONRPCIntID(-1), &query)
	var decoded coretypes.ResultABCIQuery
	if err := pqFinalityDecode(response.Result, &decoded); err != nil || decoded.Response.Height != query.Response.Height || decoded.Response.Code != 0 || !bytes.Equal(decoded.Response.Value, query.Response.Value) {
		t.Fatal("normal Comet query result was not accepted", err)
	}
	var fields struct {
		Response map[string]json.RawMessage `json:"response"`
	}
	if json.Unmarshal(response.Result, &fields) != nil || !bytes.Equal(fields.Response["code"], []byte("0")) {
		t.Fatal("normal ABCI pointer marshaler did not emit the default code")
	}
	byValue, err := cmtjson.Marshal(query)
	if err != nil || bytes.Equal(byValue, response.Result) {
		t.Fatal("fixture did not reproduce the pointer/value encoding difference", err)
	}
	if err = pqFinalityDecode(byValue, &coretypes.ResultABCIQuery{}); err == nil {
		t.Fatal("non-RPC fixture grammar silently filled missing defaults")
	}
	delete(fields.Response, "code")
	missing, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	if err = pqFinalityDecode(missing, &coretypes.ResultABCIQuery{}); err == nil {
		t.Fatal("missing real query field was accepted")
	}
}

func finalityGET(t *testing.T, g *Gateway, nativeHash string) (int, PQFinalityView) {
	return finalityRouteGET(t, g, "/transactions/pq/originals/"+nativeHash+"/finality-proof")
}

func finalityRouteGET(t *testing.T, g *Gateway, route string) (int, PQFinalityView) {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, route, nil)
	w := httptest.NewRecorder()
	g.Handler().ServeHTTP(w, r)
	var view PQFinalityView
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("collector response may be cached")
	}
	return w.Code, view
}

func finalityGateway(t *testing.T, f *pqFinalityFixture) *Gateway {
	t.Helper()
	server := httptest.NewServer(f.serve(t))
	t.Cleanup(server.Close)
	g, err := New(Config{CometRPCURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGatewayPQFinalityCollectsOriginalProofsAndRestart(t *testing.T) {
	for _, kind := range []string{consensus.PQTransferType, consensus.PQMigrationType, consensus.PQRevocationType} {
		t.Run(kind, func(t *testing.T) {
			f := newPQFinalityFixture(t, kind)
			g := finalityGateway(t, f)
			accountBefore := queryPQGatewayAccount(t, f.f.a, f.f.owner)
			hash := consensus.SignedTransactionHash(f.f.wire)
			code, got := finalityGET(t, g, hash)
			if code != 200 || got.Status != "collected" || got.Proof == nil || got.IndependentFinality || got.ProofVerification != "not-performed" || got.Source != "configured-comet-rpc" || got.NativeTransactionHash != hash || got.ABCITransactionHash != consensus.SignedTransactionHash(f.f.payload) || got.CometIndex == nil || *got.CometIndex != 1 {
				t.Fatalf("real original proof collection failed: HTTP %d %+v", code, got)
			}
			code, byABCI := finalityRouteGET(t, g, "/txs/"+got.ABCITransactionHash+"/pq-finality-proof")
			if code != 200 || !reflect.DeepEqual(byABCI, got) || byABCI.ObservedExecutionStatus != "committed" {
				t.Fatalf("ABCI successful collector bypassed original history: %d %s", code, byABCI.Error)
			}
			raw, err := json.Marshal(got.Proof)
			if err != nil {
				t.Fatal(err)
			}
			proof, err := consensus.DecodePQTransactionProofRequest(raw)
			if err != nil || !reflect.DeepEqual(proof, *got.Proof) {
				t.Fatalf("collector does not emit core verifier DTO: %v", err)
			}
			var txProof cmttypes.TxProof
			var executionProof merkle.Proof
			if cmtjson.Unmarshal(proof.TransactionProof, &txProof) != nil || txProof.Validate(f.blocks[0].DataHash) != nil || !bytes.Equal(txProof.Data, f.f.payload) || cmtjson.Unmarshal(proof.ExecutionProof, &executionProof) != nil || executionProof.Verify(f.blocks[1].LastResultsHash, proof.ExecutionResult) != nil || txProof.Proof.Index != executionProof.Index || txProof.Proof.Total != executionProof.Total {
				t.Fatal("returned real Merkle proofs do not cover exact tx and deterministic result")
			}
			for i, block := range []consensus.PQLightProofRequest{proof.Block, proof.Successor} {
				wantCommit, _ := cmtjson.Marshal(f.blocks[i])
				wantValidators, _ := cmtjson.Marshal(f.validators[i])
				if !bytes.Equal(wantCommit, block.CommitResult) || !bytes.Equal(wantValidators, block.ValidatorsResult) {
					t.Fatal("collector reconstructed original RPC header/validator evidence")
				}
			}
			f.f.a, err = consensus.NewPersistentApplication(f.f.migration, f.statePath)
			if err != nil {
				t.Fatal(err)
			}
			code, restored := finalityGET(t, g, hash)
			if code != 200 || !reflect.DeepEqual(restored, got) {
				t.Fatalf("cold history changed exact collected proof: HTTP %d %s", code, restored.Error)
			}
			if !reflect.DeepEqual(accountBefore, queryPQGatewayAccount(t, f.f.a, f.f.owner)) {
				t.Fatal("read-only collector changed committed account or nonce")
			}
		})
	}
}

func TestGatewayPQFinalityRejectsInconsistentOrUnavailableEvidence(t *testing.T) {
	f := newPQFinalityFixture(t, consensus.PQTransferType)
	g := finalityGateway(t, f)
	hash := consensus.SignedTransactionHash(f.f.wire)
	for _, mode := range []string{"unknown-json", "duplicate-json", "invalid-utf8", "missing-proof", "wrong-tx-proof", "wrong-tx-total", "wrong-index", "wrong-result-height", "missing-result", "nil-result", "changed-gas", "changed-data", "pruned", "wrong-chain", "wrong-header-height", "wrong-header-hash", "wrong-neighbor", "wrong-lastcommit", "wrong-results-root", "wrong-apphash", "partial-validators", "duplicate-validator", "unknown-nested", "missing-successor"} {
		t.Run(mode, func(t *testing.T) {
			f.mutate = func(path string, raw []byte) []byte {
				marshal := func(v any) []byte {
					b, err := cmtjson.Marshal(v)
					if err != nil {
						t.Fatal(err)
					}
					return b
				}
				if mode == "unknown-json" && path == "/abci_query" {
					return bytes.Replace(raw, []byte(`"response":`), []byte(`"unknown":true,"response":`), 1)
				}
				if mode == "duplicate-json" && path == "/tx" {
					return append(append(bytes.Clone(raw[:len(raw)-1]), []byte(`,"index":1`)...), '}')
				}
				if mode == "invalid-utf8" && path == "/tx" {
					return bytes.Replace(raw, []byte(`"hash":"`), []byte{'"', 'h', 'a', 's', 'h', '"', ':', '"', 0xff}, 1)
				}
				if path == "/tx" {
					var v coretypes.ResultTx
					_ = cmtjson.Unmarshal(raw, &v)
					switch mode {
					case "missing-proof":
						return bytes.Replace(raw, []byte(`"proof":`), []byte(`"unrecognized_proof":`), 1)
					case "wrong-tx-proof":
						v.Proof.Data = append(v.Proof.Data, 1)
					case "wrong-tx-total":
						v.Proof.Proof.Total++
					case "wrong-index":
						v.Index = 0
					}
					return marshal(&v)
				}
				if path == "/block_results" {
					var v coretypes.ResultBlockResults
					_ = cmtjson.Unmarshal(raw, &v)
					switch mode {
					case "wrong-result-height":
						v.Height++
					case "missing-result":
						v.TxsResults = v.TxsResults[:1]
					case "nil-result":
						v.TxsResults[0] = nil
					case "changed-gas":
						v.TxsResults[1].GasWanted++
					case "changed-data":
						v.TxsResults[1].Data = []byte("different result")
					}
					return marshal(&v)
				}
				if path == "/status" {
					var v coretypes.ResultStatus
					_ = cmtjson.Unmarshal(raw, &v)
					if mode == "pruned" {
						v.SyncInfo.EarliestBlockHeight = f.tx.Height + 1
					}
					if mode == "wrong-chain" {
						v.NodeInfo.Network += "other"
					}
					return marshal(&v)
				}
				if path == "/validators" {
					var v coretypes.ResultValidators
					_ = cmtjson.Unmarshal(raw, &v)
					if mode == "partial-validators" {
						v.Total++
					}
					if mode == "duplicate-validator" {
						v.Validators = append(v.Validators, v.Validators[0])
						v.Count++
						v.Total++
					}
					return marshal(&v)
				}
				if path == "/commit" {
					var v coretypes.ResultCommit
					_ = cmtjson.Unmarshal(raw, &v)
					if mode == "unknown-nested" {
						return bytes.Replace(raw, []byte(`"chain_id":`), []byte(`"extra":true,"chain_id":`), 1)
					}
					if mode == "wrong-header-height" {
						v.Header.Height++
					}
					if mode == "wrong-header-hash" {
						v.Commit.BlockID.Hash[0] ^= 1
					}
					if v.Height == f.tx.Height+1 {
						switch mode {
						case "missing-successor":
							return []byte(`null`)
						case "wrong-neighbor":
							v.LastBlockID.PartSetHeader.Hash[0] ^= 1
						case "wrong-lastcommit":
							v.LastCommitHash[0] ^= 1
						case "wrong-results-root":
							v.LastResultsHash[0] ^= 1
						case "wrong-apphash":
							v.AppHash[0] ^= 1
						}
						// Keep header-to-BlockID self consistency, so neighbor/root
						// negatives exercise the collector's actual cross-bindings.
						v.Commit.BlockID.Hash = v.Header.Hash()
					}
					return marshal(&v)
				}
				return raw
			}
			code, view := finalityGET(t, g, hash)
			if code != 502 || view.Status != "unavailable" || view.Proof != nil || view.IndependentFinality || view.Error == "" {
				t.Fatalf("%s became proof or pending: HTTP %d %+v", mode, code, view)
			}
			f.mutate = nil
		})
	}
}

func TestGatewayPQFinalityPendingBoundsNoRedirectAndReadOnly(t *testing.T) {
	f := newPQFinalityFixture(t, consensus.PQTransferType)
	g := finalityGateway(t, f)
	hash := consensus.SignedTransactionHash(f.f.wire)
	f.status.SyncInfo.LatestBlockHeight, f.status.SyncInfo.LatestBlockHash = f.tx.Height, f.blocks[0].Header.Hash()
	code, view := finalityGET(t, g, hash)
	if code != 202 || view.Status != "pending" || view.Proof != nil || view.IndependentFinality {
		t.Fatalf("actual missing successor not pending: %d %+v", code, view)
	}
	f.status.SyncInfo.LatestBlockHeight, f.status.SyncInfo.LatestBlockHash = f.tx.Height+1, f.blocks[1].Header.Hash()
	var redirected int
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected++; w.WriteHeader(500) }))
	defer other.Close()
	f.redirect = other.URL
	code, view = finalityGET(t, g, hash)
	if code != 502 || redirected != 0 || view.Status == "pending" {
		t.Fatal("collector followed redirect or disguised it as pending")
	}
	f.redirect = ""
	f.mutate = func(path string, raw []byte) []byte {
		if path == "/block_results" {
			return append(bytes.Repeat([]byte(" "), int(maxPQFinalityRPCBytes)), raw...)
		}
		return raw
	}
	code, view = finalityGET(t, g, hash)
	if code != 502 || view.Proof != nil {
		t.Fatal("collector accepted overbound result body")
	}
	f.mutate = nil
	before := len(f.requests)
	for _, route := range []string{"/transactions/pq/originals/" + hash + "/finality-proof?height=3", "/transactions/pq/originals/" + strings.ToUpper(hash) + "/finality-proof"} {
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, route, nil))
		if w.Code != 400 {
			t.Fatalf("invalid collector request: %d", w.Code)
		}
	}
	if len(f.requests) != before {
		t.Fatal("invalid collector request reached RPC")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := g.collectPQFinality(ctx, hash)
	if err == nil {
		t.Fatal("canceled RPC became proof or pending")
	}
}

// Non-deterministic logs/events are not committed by LastResultsHash. The
// collector emits the actual deterministic result, never calls it a log proof.
func TestGatewayPQFinalityDeterministicResultStripsOnlyUncommittedFields(t *testing.T) {
	f := newPQFinalityFixture(t, consensus.PQTransferType)
	f.mutate = func(path string, raw []byte) []byte {
		if path != "/block_results" {
			return raw
		}
		var v coretypes.ResultBlockResults
		if cmtjson.Unmarshal(raw, &v) != nil {
			t.Fatal("fixture decode")
		}
		v.TxsResults[1].Log = "uncommitted RPC log"
		v.TxsResults[1].Info = "uncommitted RPC info"
		v.TxsResults[1].Events = []abci.Event{{Type: "uncommitted-event"}}
		b, err := cmtjson.Marshal(&v)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	code, view := finalityGET(t, finalityGateway(t, f), consensus.SignedTransactionHash(f.f.wire))
	if code != 200 || view.Proof == nil {
		t.Fatalf("deterministic result failed: %d %s", code, view.Error)
	}
	var result abci.ExecTxResult
	if result.Unmarshal(view.Proof.ExecutionResult) != nil || result.Log != "" || result.Info != "" || len(result.Events) != 0 || result.Code != 0 || !bytes.Equal(result.Data, []byte(view.ABCITransactionHash)) {
		t.Fatal("execution proof included non-deterministic metadata or lost real result")
	}
}

// Reuse the existing account/key fixture and the normal Comet execution APIs.
// Both conflicting envelopes pass CheckTx against the same committed nonce.
// They are then deliberately supplied to BlockExecutor, which preserves the
// actual second transaction's failure. This does not claim proposal acceptance.
func newPQFinalityRejectedFixture(t *testing.T) *pqFinalityFixture {
	t.Helper()
	f, _, _ := newGatewayMigrationFixture(t)
	keys := map[string]ed25519.PrivKey{}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, validator := range f.migration.Validators {
		key := ed25519.GenPrivKeyFromSecret([]byte(fmt.Sprintf("public-finality-engine-member-%d", i)))
		pub := key.PubKey()
		keys[string(pub.Address())] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: validator.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(pub.Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(pub.Address()))})
	}
	var err error
	f.migration, err = f.migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(f.migration, time.Date(2026, 10, 18, 1, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	bootstrap, err := consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(digest[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "actual-execution.json")
	f.a, err = consensus.NewPersistentApplicationWithBootstrap(f.migration, path, bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	db, blockDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blockDB.Close() })
	store := sm.NewStore(db, sm.StoreOptions{})
	blocks := blockstore.NewBlockStore(blockDB)
	appConns := proxy.NewAppConns(proxy.NewLocalClientCreator(f.a), proxy.NopMetrics())
	if err = appConns.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = appConns.Stop() })
	initial, err := sm.MakeGenesisState(doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = store.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(store, initial, blocks, doc)
	handshake.SetConsensusAuthoritySource(f.a)
	if err = handshake.Handshake(appConns); err != nil {
		t.Fatal(err)
	}
	boundStore := sm.WithConsensusAuthorityStore(store, f.a)
	apply := func(txs cmttypes.Txs) int64 {
		state, err := boundStore.Load()
		if err != nil {
			t.Fatal(err)
		}
		h := state.LastBlockHeight + 1
		previous := &cmttypes.Commit{}
		if state.LastBlockHeight == 0 {
			h = state.InitialHeight
		} else {
			previous = blocks.LoadSeenCommit(state.LastBlockHeight)
		}
		block, err := state.MakeBlock(h, txs, previous, nil, state.Validators.GetProposer().Address)
		if err != nil {
			t.Fatal(err)
		}
		parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if err != nil {
			t.Fatal(err)
		}
		id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
		commit := &cmttypes.Commit{Height: h, BlockID: id}
		for _, member := range state.Validators.Validators {
			commit.Signatures = append(commit.Signatures, cmttypes.CommitSig{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: member.Address, Timestamp: block.Time.Add(time.Second)})
		}
		for i, member := range state.Validators.Validators {
			key, ok := keys[string(member.Address)]
			if !ok {
				t.Fatal("missing original synthetic consensus key")
			}
			commit.Signatures[i].Signature, err = key.Sign(commit.VoteSignBytes(doc.ChainID, int32(i)))
			if err != nil {
				t.Fatal(err)
			}
		}
		blocks.SaveBlock(block, parts, commit)
		executor := sm.NewBlockExecutor(boundStore, log.NewNopLogger(), appConns.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, blocks)
		if _, err = executor.ApplyBlock(state, id, block); err != nil {
			t.Fatal("actual finality fixture BlockExecutor:", err)
		}
		return h
	}
	registrationH := apply(cmttypes.Txs{cmttypes.Tx(f.payload)})
	registration, err := store.LoadFinalizeBlockResponse(registrationH)
	if err != nil || registration == nil || len(registration.TxResults) != 1 || registration.TxResults[0] == nil || registration.TxResults[0].Code != 0 {
		t.Fatalf("actual migration failed: %v %+v", err, registration)
	}
	winnerWire := signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 2, 7))
	f.wire = signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 2, 9))
	winner, err := consensus.EncodePQTransaction(consensus.PQTransferType, winnerWire)
	if err != nil {
		t.Fatal(err)
	}
	f.payload, err = consensus.EncodePQTransaction(consensus.PQTransferType, f.wire)
	if err != nil {
		t.Fatal(err)
	}
	for _, payload := range [][]byte{winner, f.payload} {
		check, err := f.a.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: payload})
		if err != nil || check.Code != 0 {
			t.Fatalf("competing original was not independently admissible: %v %+v", err, check)
		}
	}
	before := queryPQGatewayAccount(t, f.a, f.owner)
	height := apply(cmttypes.Txs{cmttypes.Tx(winner), cmttypes.Tx(f.payload)})
	results, err := store.LoadFinalizeBlockResponse(height)
	if err != nil || results == nil || len(results.TxResults) != 2 || results.TxResults[0] == nil || results.TxResults[1] == nil || results.TxResults[0].Code != 0 || results.TxResults[1].Code == 0 || len(results.TxResults[1].Data) != 0 {
		t.Fatalf("actual competing-nonce outcomes missing: %v %+v", err, results)
	}
	apply(nil)
	after := queryPQGatewayAccount(t, f.a, f.owner)
	if after.Nonce != 2 || after.Balance != before.Balance-8 || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+1 {
		t.Fatal("failed execution changed nonce, balance or resource usage")
	}
	missing, err := f.a.Query(context.Background(), &abci.RequestQuery{Path: consensus.PQWalletHistoryPath + consensus.SignedTransactionHash(f.wire)})
	if err != nil || missing.Code == 0 {
		t.Fatalf("failed original acquired successful PQHistory: %v %+v", err, missing)
	}
	actual := blocks.LoadBlock(height)
	if actual == nil || len(actual.Data.Txs) != 2 {
		t.Fatal("actual execution block was not retained")
	}
	v := &pqFinalityFixture{f: f, statePath: path, bootstrap: bootstrap, tx: coretypes.ResultTx{Hash: actual.Data.Txs[1].Hash(), Height: height, Index: 1, TxResult: *results.TxResults[1], Tx: actual.Data.Txs[1], Proof: actual.Data.Txs.Proof(1)}}
	v.results = coretypes.ResultBlockResults{Height: height, TxsResults: results.TxResults, FinalizeBlockEvents: results.Events, ValidatorUpdates: results.ValidatorUpdates, ConsensusParamUpdates: results.ConsensusParamUpdates, AppHash: results.AppHash}
	for i := range v.blocks {
		h := height + int64(i)
		block := blocks.LoadBlock(h)
		commit := blocks.LoadSeenCommit(h)
		if i == 0 {
			commit = blocks.LoadBlockCommit(h)
		}
		if block == nil || commit == nil {
			t.Fatal("actual execution block or original commit missing", h)
		}
		v.blocks[i] = *coretypes.NewResultCommit(&block.Header, commit, i == 0)
		validators, err := store.LoadValidators(h)
		if err != nil || validators == nil {
			t.Fatal(err)
		}
		v.validators[i] = coretypes.ResultValidators{BlockHeight: h, Validators: validators.Validators, Count: len(validators.Validators), Total: len(validators.Validators)}
	}
	v.status.NodeInfo.Network = doc.ChainID
	first := blocks.LoadBlock(doc.InitialHeight)
	if first == nil {
		t.Fatal("original first block missing")
	}
	v.status.SyncInfo = coretypes.SyncInfo{LatestBlockHeight: height + 1, EarliestBlockHeight: doc.InitialHeight, LatestBlockHash: v.blocks[1].Header.Hash(), EarliestBlockHash: first.Hash()}
	return v
}

func TestGatewayPQFinalityRejectedABCIOriginalBlockExecutorAndRestart(t *testing.T) {
	f := newPQFinalityRejectedFixture(t)
	g := finalityGateway(t, f)
	native, outer := consensus.SignedTransactionHash(f.f.wire), consensus.SignedTransactionHash(f.f.payload)
	route := "/txs/" + outer + "/pq-finality-proof"
	code, got := finalityRouteGET(t, g, route)
	if code != 200 || got.Status != "collected" || got.ObservedExecutionStatus != "rejected" || got.Proof == nil || got.IndependentFinality || got.ProofVerification != "not-performed" || got.NativeTransactionHash != native || got.ABCITransactionHash != outer || got.CometIndex == nil || *got.CometIndex != 1 {
		t.Fatalf("actual failed original proof unavailable: %d %+v", code, got)
	}
	for _, request := range f.requests {
		if strings.HasPrefix(request, "/abci_query") {
			t.Fatal("failed original required a nonexistent successful PQHistory")
		}
	}
	var result abci.ExecTxResult
	var proof merkle.Proof
	var txProof cmttypes.TxProof
	if result.Unmarshal(got.Proof.ExecutionResult) != nil || result.Code != f.tx.TxResult.Code || result.Code == 0 || len(result.Data) != 0 || cmtjson.Unmarshal(got.Proof.ExecutionProof, &proof) != nil || proof.Verify(f.blocks[1].LastResultsHash, got.Proof.ExecutionResult) != nil || cmtjson.Unmarshal(got.Proof.TransactionProof, &txProof) != nil || txProof.Validate(f.blocks[0].DataHash) != nil || !bytes.Equal(txProof.Data, f.f.payload) || proof.Index != txProof.Proof.Index || proof.Total != txProof.Proof.Total {
		t.Fatal("failed proof lost exact transaction, code, empty data or real Merkle root")
	}
	raw, _ := json.Marshal(got.Proof)
	if _, err := consensus.DecodePQTransactionProofRequest(raw); err != nil {
		t.Fatal(err)
	}
	code, nativeView := finalityGET(t, g, native)
	if code != 502 || nativeView.Proof != nil {
		t.Fatal("successful-native route accepted absent failed history")
	}
	before := queryPQGatewayAccount(t, f.f.a, f.f.owner)
	var err error
	f.f.a, err = consensus.NewPersistentApplicationWithBootstrap(f.f.migration, f.statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	code, restored := finalityRouteGET(t, g, route)
	if code != 200 || !reflect.DeepEqual(got, restored) || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.f.a, f.f.owner)) {
		t.Fatalf("cold failed proof recovery changed original or ledger: %d %s", code, restored.Error)
	}
	for _, mode := range []string{"fake-success", "nonempty-failure-data", "different-failure-code", "different-subject", "missing-successor"} {
		t.Run(mode, func(t *testing.T) {
			f.mutate = func(path string, raw []byte) []byte {
				if path == "/tx" {
					var tx coretypes.ResultTx
					_ = cmtjson.Unmarshal(raw, &tx)
					switch mode {
					case "fake-success":
						tx.TxResult.Code = 0
						tx.TxResult.Data = []byte(outer)
					case "nonempty-failure-data":
						tx.TxResult.Data = []byte(outer)
					case "different-failure-code":
						tx.TxResult.Code++
					case "different-subject":
						tx.Tx = append(bytes.Clone(tx.Tx), ' ')
						tx.Hash = tx.Tx.Hash()
					}
					b, err := cmtjson.Marshal(&tx)
					if err != nil {
						t.Fatal(err)
					}
					return b
				}
				if mode == "different-failure-code" && path == "/block_results" {
					var results coretypes.ResultBlockResults
					_ = cmtjson.Unmarshal(raw, &results)
					results.TxsResults[1].Code++
					b, err := cmtjson.Marshal(&results)
					if err != nil {
						t.Fatal(err)
					}
					return b
				}
				if mode == "missing-successor" && path == "/commit" {
					var block coretypes.ResultCommit
					_ = cmtjson.Unmarshal(raw, &block)
					if block.Height == f.tx.Height+1 {
						return []byte("null")
					}
				}
				return raw
			}
			code, bad := finalityRouteGET(t, g, route)
			if code != 502 || bad.Proof != nil || bad.Status == "pending" || bad.IndependentFinality {
				t.Fatalf("%s became terminal proof: %d %+v", mode, code, bad)
			}
			f.mutate = nil
		})
	}
	f.status.SyncInfo.LatestBlockHeight, f.status.SyncInfo.LatestBlockHash = f.tx.Height, f.blocks[0].Header.Hash()
	code, pending := finalityRouteGET(t, g, route)
	if code != 202 || pending.Status != "pending" || pending.ObservedExecutionStatus != "rejected" || pending.Proof != nil {
		t.Fatalf("rejected tx before H+1 was claimed final: %d %+v", code, pending)
	}
	for _, invalid := range []string{route + "?height=3", "/txs/" + strings.ToUpper(outer) + "/pq-finality-proof"} {
		before := len(f.requests)
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, invalid, nil))
		if w.Code != 400 || len(f.requests) != before {
			t.Fatal("invalid ABCI finality route reached RPC")
		}
	}
}
