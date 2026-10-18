package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type pqGatewayFixture struct {
	d                *chain.Devnet
	a                *consensus.Application
	migration        chain.ConsensusMigrationState
	key              *ynxbatch.PrivateKey
	owner, recipient string
	network          []byte
	wire, payload    []byte
}

func signGatewayWhole(t *testing.T, key *ynxbatch.PrivateKey, network []byte, owner, purpose string, messages [][]byte) []byte {
	t.Helper()
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: purpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	wire, err := batch.WholeWire()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func (f *pqGatewayFixture) message(t *testing.T, nonce, amount uint64) []byte {
	t.Helper()
	b, err := (ynxauth.Transfer{ChainID: f.network, NativeChainID: 6423, From: f.owner, To: f.recipient, Amount: amount, Fee: 1, Nonce: nonce}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newPQGatewayFixture(t *testing.T) *pqGatewayFixture {
	t.Helper()
	f := &pqGatewayFixture{}
	classic := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(213)))
	recipient := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(214)))
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
		if _, err = f.d.Faucet(owner, 100); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	if err = f.d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	m, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.network, err = hex.DecodeString(m.OriginalGenesisHash)
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
	newProof := signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})
	digest := sha256.Sum256(message)
	registration, err := (ynxauth.Migration{Intent: intent, NewKeyProof: newProof, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize()}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = f.d.SubmitAccountMigration(registration); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	f.migration, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.a, err = consensus.NewPersistentApplication(f.migration, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	f.wire = signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, [][]byte{f.message(t, 2, 7), f.message(t, 3, 999), f.message(t, 3, 4), f.message(t, 5, 1)})
	f.payload, err = consensus.EncodePQTransaction(consensus.PQWholeType, f.wire)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// Only transport is mocked. CheckTx, FinalizeBlock, Commit, Query and account
// authorization are the actual application over an actual source migration.
type pqMockComet struct {
	t              *testing.T
	f              *pqGatewayFixture
	mu             sync.Mutex
	posts          int
	mode           string
	lookupMutation func(*cometTx)
	queryMutation  func(string, []byte) []byte
	indexed        map[string]cometTx
	block          [][]byte
	blockResults   []cometTxResult
	height         uint64
	// Optional test clock. Nil timedBlocks retains the original fixture exactly;
	// enabled clocks retain committed timestamps and bytes by actual height.
	blockTime   time.Time
	timedBlocks map[uint64]pqMockTimedBlock
}

type pqMockTimedBlock struct {
	at      time.Time
	txs     [][]byte
	results []cometTxResult
}

func (m *pqMockComet) blockTimeLocked() time.Time {
	if m.timedBlocks != nil && !m.blockTime.IsZero() {
		return m.blockTime.UTC()
	}
	return time.Unix(int64(m.height), 0).UTC()
}

func newPQMock(t *testing.T, f *pqGatewayFixture) *pqMockComet {
	return &pqMockComet{t: t, f: f, indexed: map[string]cometTx{}, height: 3}
}
func (m *pqMockComet) serve(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/":
		m.posts++
		if r.Method != http.MethodPost || r.URL.RawQuery != "" || r.Header.Get("Content-Type") != "application/json" {
			m.t.Error("Whole transport was not JSON-RPC POST")
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			m.t.Error(err)
			return
		}
		var request struct {
			JSONRPC string `json:"jsonrpc"`
			ID      int    `json:"id"`
			Method  string `json:"method"`
			Params  struct {
				Tx []byte `json:"tx"`
			} `json:"params"`
		}
		if err = json.Unmarshal(body, &request); err != nil || request.JSONRPC != "2.0" || request.ID != 1 || request.Method != "broadcast_tx_commit" {
			m.t.Errorf("bad POST: %v", err)
			return
		}
		if !bytes.Equal(request.Params.Tx, m.f.payload) {
			m.t.Error("POST bytes differ from canonical original envelope")
		}
		if len(body) != 4*((len(request.Params.Tx)+2)/3)+74 {
			m.t.Error("POST framing size differs")
		}
		if m.mode == "redirect" {
			w.Header().Set("Location", "/redirect-target")
			w.WriteHeader(http.StatusTemporaryRedirect)
			return
		}
		check, err := m.f.a.CheckTx(r.Context(), &abcitypes.RequestCheckTx{Tx: request.Params.Tx})
		if err != nil {
			m.t.Error(err)
			return
		}
		var response cometBroadcast
		response.Result.Hash = strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(request.Params.Tx), "0x"))
		response.Result.CheckTx = cometTxResult{Code: check.Code, Log: check.Log, Data: check.Data, GasUsed: strconv.FormatInt(check.GasUsed, 10)}
		if check.Code == 0 {
			at := m.blockTimeLocked()
			out, err := m.f.a.FinalizeBlock(r.Context(), &abcitypes.RequestFinalizeBlock{Height: int64(m.height), Time: at, Txs: [][]byte{request.Params.Tx}})
			if err != nil || len(out.TxResults) != 1 {
				m.t.Errorf("Finalize: %v", err)
				return
			}
			if _, err = m.f.a.Commit(r.Context(), &abcitypes.RequestCommit{}); err != nil {
				m.t.Error(err)
				return
			}
			r := out.TxResults[0]
			response.Result.TxResult = cometTxResult{Code: r.Code, Log: r.Log, Data: r.Data, GasUsed: strconv.FormatInt(r.GasUsed, 10)}
			response.Result.Height = strconv.FormatUint(m.height, 10)
			hash := consensus.SignedTransactionHash(request.Params.Tx)
			m.indexed[hash] = cometTx{Hash: response.Result.Hash, Height: response.Result.Height, Tx: bytes.Clone(request.Params.Tx), TxResult: response.Result.TxResult}
			m.block = [][]byte{bytes.Clone(request.Params.Tx)}
			m.blockResults = []cometTxResult{response.Result.TxResult}
			if m.timedBlocks != nil {
				if _, exists := m.timedBlocks[m.height]; exists {
					m.t.Error("test transport attempted to overwrite a committed block")
					return
				}
				m.timedBlocks[m.height] = pqMockTimedBlock{at: at, txs: m.block, results: m.blockResults}
			}
		}
		switch m.mode {
		case "connection-loss":
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				m.t.Error(err)
				return
			}
			connection.Close()
			return
		case "lost-response":
			w.WriteHeader(http.StatusGatewayTimeout)
			return
		case "wrong-hash":
			response.Result.Hash = strings.Repeat("F", 64)
		case "missing-data":
			response.Result.TxResult.Data = nil
		case "wrong-height":
			response.Result.Height = "4"
		case "wrong-id":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 2, "result": response.Result})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": response.Result})
	case "/abci_query":
		path, err := strconv.Unquote(r.URL.Query().Get("path"))
		if err != nil {
			m.t.Error(err)
			return
		}
		out, err := m.f.a.Query(r.Context(), &abcitypes.RequestQuery{Path: path})
		if err != nil {
			m.t.Error(err)
			return
		}
		value := out.Value
		if m.queryMutation != nil {
			value = m.queryMutation(path, bytes.Clone(value))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": out.Code, "log": out.Log, "height": strconv.FormatInt(out.Height, 10), "value": base64.StdEncoding.EncodeToString(value)}}})
	case "/tx":
		if r.Method != http.MethodGet || r.URL.Query().Get("prove") != "true" {
			m.t.Error("wrong readback request")
		}
		tx, ok := m.indexed[r.URL.Query().Get("hash")]
		if !ok {
			_ = json.NewEncoder(w).Encode(map[string]any{"error": cometRPCError{Code: -32603, Message: "tx not found"}})
			return
		}
		if m.lookupMutation != nil {
			m.lookupMutation(&tx)
		}
		_ = json.NewEncoder(w).Encode(cometTxLookup{Result: tx})
	case "/block":
		if m.timedBlocks != nil {
			height, err := strconv.ParseUint(r.URL.Query().Get("height"), 10, 64)
			block, exists := m.timedBlocks[height]
			if err != nil || !exists {
				m.t.Error("no captured timed block at requested height")
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_id": map[string]any{"hash": strings.Repeat("B", 64)}, "block": map[string]any{"header": map[string]any{"height": strconv.FormatUint(height, 10), "time": block.at, "proposer_address": strings.Repeat("C", 40), "last_block_id": map[string]any{"hash": strings.Repeat("A", 64)}}, "data": map[string]any{"txs": block.txs}}}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_id": map[string]any{"hash": strings.Repeat("B", 64)}, "block": map[string]any{"header": map[string]any{"height": strconv.FormatUint(m.height, 10), "time": time.Unix(int64(m.height), 0).UTC(), "proposer_address": strings.Repeat("C", 40), "last_block_id": map[string]any{"hash": strings.Repeat("A", 64)}}, "data": map[string]any{"txs": m.block}}}})
	case "/block_results":
		var result cometBlockResults
		result.Result.Height = strconv.FormatUint(m.height, 10)
		result.Result.TxsResults = m.blockResults
		if m.timedBlocks != nil {
			height, err := strconv.ParseUint(r.URL.Query().Get("height"), 10, 64)
			block, exists := m.timedBlocks[height]
			if err != nil || !exists {
				m.t.Error("no captured timed results at requested height")
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			result.Result.Height = strconv.FormatUint(height, 10)
			result.Result.TxsResults = block.results
		}
		_ = json.NewEncoder(w).Encode(result)
	case "/tx_search":
		var result cometTxSearch
		result.Result.TotalCount = strconv.Itoa(len(m.indexed))
		for _, tx := range m.indexed {
			result.Result.Txs = append(result.Result.Txs, tx)
		}
		_ = json.NewEncoder(w).Encode(result)
	case "/redirect-target":
		m.t.Error("signed POST was replayed via redirect")
		w.WriteHeader(500)
	default:
		m.t.Errorf("unexpected Comet endpoint %s", r.URL.Path)
		http.NotFound(w, r)
	}
}

func gatewayPQServer(t *testing.T, m *pqMockComet) *httptest.Server {
	t.Helper()
	comet := httptest.NewServer(http.HandlerFunc(m.serve))
	t.Cleanup(comet.Close)
	g, err := New(Config{CometRPCURL: comet.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(g.Handler())
	t.Cleanup(server.Close)
	return server
}
func pqPOST(t *testing.T, endpoint string, wire []byte) (int, PQWholeView) {
	t.Helper()
	r, err := http.Post(endpoint+"/transactions/pq/batches/broadcast", "application/octet-stream", bytes.NewReader(wire))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var view PQWholeView
	if err = json.NewDecoder(r.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	return r.StatusCode, view
}
func pqGET(t *testing.T, endpoint string) (int, PQWholeView) {
	t.Helper()
	r, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var view PQWholeView
	if err = json.NewDecoder(r.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	return r.StatusCode, view
}

func TestGatewayPQWholePOSTPartialAndOriginalReadback(t *testing.T) {
	f := newPQGatewayFixture(t)
	ownerBefore := queryPQGatewayAccount(t, f.a, f.owner)
	recipientBefore := queryPQGatewayAccount(t, f.a, f.recipient)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	status, view := pqPOST(t, server.URL, f.wire)
	if status != 200 || !view.Committed || view.Status != "committed" || view.FeeYNXT != 2 || view.ExecutionHeight != 3 || len(view.Results) != 4 || !bytes.Equal(view.Whole, f.wire) {
		t.Fatalf("partial result: HTTP %d %+v", status, view)
	}
	if view.ABCITransactionHash != consensus.SignedTransactionHash(f.payload) || view.BatchHash != consensus.SignedTransactionHash(f.wire) || view.ABCITransactionHash == view.BatchHash {
		t.Fatal("identity conflated")
	}
	for i, outcome := range []string{"admitted", "rejected", "admitted", "rejected"} {
		if view.Results[i].Outcome != outcome {
			t.Fatal("partial semantics lost")
		}
		if outcome == "admitted" {
			hash, _ := chain.PQBatchTransactionHash(view.BatchHash, uint32(i))
			if view.Results[i].TransactionHash != hash || hash == view.ABCITransactionHash {
				t.Fatal("member hash replaced")
			}
		}
	}
	ownerAfter := queryPQGatewayAccount(t, f.a, f.owner)
	recipientAfter := queryPQGatewayAccount(t, f.a, f.recipient)
	if ownerAfter.Balance != ownerBefore.Balance-13 || ownerAfter.Nonce != 3 || ownerAfter.ResourceUsage.BandwidthUsed != ownerBefore.ResourceUsage.BandwidthUsed+2 || recipientAfter.Balance != recipientBefore.Balance+11 {
		t.Fatal("gateway committed result disagrees with actual balance/nonce/usage")
	}
	var moved int64
	for id, before := range ownerBefore.Lots {
		delta := before - ownerAfter.Lots[id]
		moved += delta
		if recipientAfter.Lots[id]-recipientBefore.Lots[id] != delta {
			t.Fatal("actual lot movement inconsistent")
		}
	}
	if moved != 11 {
		t.Fatal("Whole fee incorrectly consumed lots")
	}
	for _, path := range []string{view.ReadbackURL, "/transactions/pq/batches/" + view.BatchHash, "/txs/" + view.ABCITransactionHash} {
		code, read := pqGET(t, server.URL+path)
		if code != 200 || !reflect.DeepEqual(read, view) {
			t.Fatalf("readback differs %s: %d %+v", path, code, read)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.posts != 1 {
		t.Fatal("readback rebroadcast original Whole")
	}
}

func TestGatewayPQWholeUnknownPreservesIdentityAndNeverRetries(t *testing.T) {
	for _, mode := range []string{"connection-loss", "lost-response", "wrong-hash", "missing-data", "wrong-height", "wrong-id", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			f := newPQGatewayFixture(t)
			m := newPQMock(t, f)
			m.mode = mode
			server := gatewayPQServer(t, m)
			status, view := pqPOST(t, server.URL, f.wire)
			if status != 202 || view.Status != "unknown" || view.Committed || view.ABCITransactionHash != consensus.SignedTransactionHash(f.payload) || view.BatchHash != consensus.SignedTransactionHash(f.wire) || view.FeeYNXT != 0 || len(view.Results) != 0 {
				t.Fatalf("ambiguous write falsely resolved: %d %+v", status, view)
			}
			code, read := pqGET(t, server.URL+view.ReadbackURL)
			if mode == "redirect" {
				if code != 202 || read.Committed {
					t.Fatal("missing original reported committed")
				}
			} else if code != 200 || !read.Committed || read.FeeYNXT != 2 {
				t.Fatalf("original commit not recoverable: %d %+v", code, read)
			}
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.posts != 1 {
				t.Fatal("automatic retry on UNKNOWN")
			}
		})
	}
}

func TestGatewayPQWholeRejectsEitherSignatureAndAllRejected(t *testing.T) {
	f := newPQGatewayFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	for _, which := range []string{"A", "B"} {
		whole, err := ynxbatch.DecodeWhole(f.wire)
		if err != nil {
			t.Fatal(err)
		}
		if which == "A" {
			whole.Certificate.SigmaA[0] ^= 1
		} else {
			whole.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeWhole(whole)
		if err != nil {
			t.Fatal(err)
		}
		m.mu.Lock()
		m.f.payload, err = consensus.EncodePQTransaction(consensus.PQWholeType, bad)
		m.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		code, view := pqPOST(t, server.URL, bad)
		if code != 422 || view.Committed || view.Status != "rejected" || view.FeeYNXT != 0 {
			t.Fatalf("broken %s accepted: %d %+v", which, code, view)
		}
	}
	wire := signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, [][]byte{f.message(t, 99, 1)})
	m.mu.Lock()
	m.f.payload, _ = consensus.EncodePQTransaction(consensus.PQWholeType, wire)
	m.mu.Unlock()
	code, view := pqPOST(t, server.URL, wire)
	if code != 422 || view.Status != "rejected" || len(view.Results) != 1 || view.Results[0].Outcome != "rejected" || view.Committed || view.FeeYNXT != 0 {
		t.Fatalf("all rejected lost results: %d %+v", code, view)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.indexed) != 0 {
		t.Fatal("CheckTx failure committed a transaction")
	}
}

func TestGatewayPQWholeReadbackRejectsExecutionAndProofMutation(t *testing.T) {
	f := newPQGatewayFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	_, view := pqPOST(t, server.URL, f.wire)
	mutations := map[string]func(*cometTx){
		"hash":         func(tx *cometTx) { tx.Hash = strings.Repeat("0", 64) },
		"height":       func(tx *cometTx) { tx.Height = "4" },
		"missing Data": func(tx *cometTx) { tx.TxResult.Data = nil },
		"member hash": func(tx *cometTx) {
			var r consensus.PQBatchExecutionResult
			_ = json.Unmarshal(tx.TxResult.Data, &r)
			r.Results[0].TransactionHash = view.ABCITransactionHash
			tx.TxResult.Data, _ = json.Marshal(r)
		},
		"reject changed": func(tx *cometTx) {
			var r consensus.PQBatchExecutionResult
			_ = json.Unmarshal(tx.TxResult.Data, &r)
			r.Results[1].Error = "different reason"
			tx.TxResult.Data, _ = json.Marshal(r)
		},
		"duplicate Data field": func(tx *cometTx) {
			tx.TxResult.Data = bytes.Replace(tx.TxResult.Data, []byte(`"executionHeight":"3"`), []byte(`"executionHeight":"3","executionHeight":"3"`), 1)
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			m.mu.Lock()
			m.lookupMutation = mutate
			m.mu.Unlock()
			code, read := pqGET(t, server.URL+view.ReadbackURL)
			if code != 202 || read.Committed || read.Status != "unknown" {
				t.Fatal("mutated evidence reported commit")
			}
		})
	}
	m.mu.Lock()
	m.lookupMutation = nil
	m.queryMutation = func(path string, b []byte) []byte {
		if strings.HasPrefix(path, "/pq-batches/") {
			var p consensus.PQCommittedBatch
			_ = json.Unmarshal(b, &p)
			p.Whole[0] ^= 1
			b, _ = json.Marshal(p)
		}
		return b
	}
	m.mu.Unlock()
	code, read := pqGET(t, server.URL+view.ReadbackURL)
	if code != 202 || read.Committed {
		t.Fatal("changed original Whole proof accepted")
	}
}

func TestGatewayPQWholeCanonicalSizesAndHTTPBoundary(t *testing.T) {
	f := newPQGatewayFixture(t)
	for _, n := range []int{1, 16, 64, 1024} {
		messages := make([][]byte, n)
		for i := range messages {
			messages[i] = f.message(t, uint64(i+2), 1)
		}
		wire := signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, messages)
		_, payload, err := decodeIngressWhole(wire)
		if err != nil {
			t.Fatal(err)
		}
		if len(wire) != 57580+234*n || len(payload) != 2*len(wire)+44 {
			t.Fatalf("N%d actual canonical size: %d/%d", n, len(wire), len(payload))
		}
		if n == 1024 {
			m := newPQMock(t, f)
			m.f.payload = payload
			server := gatewayPQServer(t, m)
			code, view := pqPOST(t, server.URL, wire)
			if code != 200 || !view.Committed || len(view.Results) != 1024 || view.FeeYNXT != 49 {
				t.Fatalf("N1024 actual POST partial: %d fee %d status %s error %s", code, view.FeeYNXT, view.Status, view.Error)
			}
		}
	}
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	for _, wire := range [][]byte{append(bytes.Clone(f.wire), 0), make([]byte, MaxPQWholeIngressBytes+1)} {
		r, err := http.Post(server.URL+"/transactions/pq/batches/broadcast", "application/octet-stream", bytes.NewReader(wire))
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, r.Body)
		r.Body.Close()
		if r.StatusCode != 400 && r.StatusCode != 413 {
			t.Fatalf("invalid framing/size HTTP %d", r.StatusCode)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.posts != 0 {
		t.Fatal("oversized/malformed Whole reached Comet")
	}
}

func TestGatewayPQSourceBatchHasNoInventedCometIdentity(t *testing.T) {
	f := newPQGatewayFixture(t)
	result, err := f.d.SubmitPQBatch(f.wire)
	if err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	migration, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	f.a, err = consensus.NewPersistentApplication(migration, filepath.Join(t.TempDir(), "import.json"))
	if err != nil {
		t.Fatal(err)
	}
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	code, view := pqGET(t, server.URL+"/transactions/pq/batches/"+result.BatchHash)
	if code != 200 || view.Status != "source_import" || view.Provenance != "imported-authoritative-source" || view.Committed || view.ABCITransactionHash != "" || view.CometIndex != nil || !reflect.DeepEqual(view.Results, result.Results) || !bytes.Equal(view.Whole, f.wire) {
		t.Fatalf("source proof falsely mapped to Comet: %d %+v", code, view)
	}
}

func queryPQGatewayAccount(t *testing.T, a *consensus.Application, owner string) chain.ConsensusAccount {
	t.Helper()
	out, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: "/accounts/" + owner})
	if err != nil || out.Code != 0 {
		t.Fatalf("account query: %v", err)
	}
	var account chain.ConsensusAccount
	if err = json.Unmarshal(out.Value, &account); err != nil {
		t.Fatal(err)
	}
	return account
}
