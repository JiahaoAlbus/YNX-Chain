package bftgateway

import (
	"bytes"
	"context"
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

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type ethereumGatewayBlock struct {
	block   cometBlock
	results cometBlockResults
}
type ethereumGatewayMock struct {
	*pqMockComet
	blocks         map[uint64]ethereumGatewayBlock
	blockMutation  func(*cometBlock)
	resultMutation func(*cometBlockResults)
}

// Only RPC/index transport is substituted. All state transitions and queries
// below execute the real Application and complete dual-signature policy.
func (m *ethereumGatewayMock) serve(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/block" && r.URL.Path != "/block_results" {
		m.pqMockComet.serve(w, r)
		if r.URL.Path == "/" {
			m.mu.Lock()
			defer m.mu.Unlock()
			if len(m.block) != 0 {
				m.captureCurrentBlockLocked()
			}
		}
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	height, err := strconv.ParseUint(r.URL.Query().Get("height"), 10, 64)
	if err != nil {
		m.t.Error(err)
		return
	}
	stored, ok := m.blocks[height]
	if !ok {
		m.t.Errorf("no captured block %d", height)
		http.Error(w, "not found", 404)
		return
	}
	// Clone nested slices so a response corruption cannot alter the stored RPC fixture.
	var b ethereumGatewayBlock
	raw, _ := json.Marshal(stored.block)
	if err = json.Unmarshal(raw, &b.block); err != nil {
		m.t.Error(err)
		return
	}
	raw, _ = json.Marshal(stored.results)
	if err = json.Unmarshal(raw, &b.results); err != nil {
		m.t.Error(err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/block" {
		if m.blockMutation != nil {
			m.blockMutation(&b.block)
		}
		_ = json.NewEncoder(w).Encode(b.block)
	} else {
		if m.resultMutation != nil {
			m.resultMutation(&b.results)
		}
		_ = json.NewEncoder(w).Encode(b.results)
	}
}

func (m *ethereumGatewayMock) captureCurrentBlockLocked() {
	info, err := m.f.a.Info(context.Background(), &abcitypes.RequestInfo{})
	if err != nil {
		m.t.Error(err)
		return
	}
	var b ethereumGatewayBlock
	b.block.Result.BlockID.Hash = strings.Repeat("B", 64)
	h := &b.block.Result.Block.Header
	h.Height, h.Time = strconv.FormatUint(m.height, 10), time.Unix(int64(m.height), 0).UTC()
	h.Proposer, h.LastBlockID.Hash = strings.Repeat("C", 40), strings.Repeat("A", 64)
	h.AppHash = hex.EncodeToString(info.LastBlockAppHash)
	txs := make(cmttypes.Txs, len(m.block))
	for i, raw := range m.block {
		txs[i] = cmttypes.Tx(bytes.Clone(raw))
		b.block.Result.Block.Data.Txs = append(b.block.Result.Block.Data.Txs, bytes.Clone(raw))
	}
	h.DataHash = hex.EncodeToString(txs.Hash())
	b.results.Result.Height = h.Height
	b.results.Result.TxsResults = append([]cometTxResult(nil), m.blockResults...)
	m.blocks[m.height] = b
}

func newEthereumGateway(t *testing.T) (*pqGatewayFixture, *ethereumGatewayMock, *httptest.Server, *Gateway, string) {
	t.Helper()
	f := newPQGatewayFixture(t)
	for _, owner := range []string{f.owner, f.recipient} {
		if _, err := f.d.Faucet(owner, 500000); err != nil {
			t.Fatal(err)
		}
	}
	f.d.ProduceBlock()
	var err error
	f.migration, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "ethereum-state.json")
	f.a, err = consensus.NewPersistentApplication(f.migration, path)
	if err != nil {
		t.Fatal(err)
	}
	m := &ethereumGatewayMock{pqMockComet: newPQMock(t, f), blocks: map[uint64]ethereumGatewayBlock{}}
	m.height = 4
	upstream := httptest.NewServer(http.HandlerFunc(m.serve))
	t.Cleanup(upstream.Close)
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(g.Handler())
	t.Cleanup(server.Close)
	return f, m, server, g, path
}

func gatewayEthereumIntent(f *pqGatewayFixture, kind uint32, nonce uint64) ynxauth.EthereumValueIntent {
	v := ynxauth.EthereumValueIntent{Profile: ynxauth.EthereumABCIIntegerGasProfile, ChainID: f.network, NativeChainID: 6423, Owner: f.owner, To: f.recipient, Value: 7, Nonce: nonce, TxType: kind, GasLimit: 21000, GasPrice: 2}
	if kind == 2 {
		v.GasPrice = 0
		v.MaxPriorityFeePerGas = 2
		v.MaxFeePerGas = 4
	}
	return v
}
func gatewayEthereumWire(t *testing.T, f *pqGatewayFixture, v ynxauth.EthereumValueIntent, n int) []byte {
	t.Helper()
	messages := make([][]byte, n)
	for i := range messages {
		x := v
		if i != n-1 {
			x.Nonce += uint64(100 + i)
		}
		var err error
		messages[i], err = x.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: v.ChainID, Owner: v.Owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, uint32(n-1))
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}
func setGatewayEthereum(t *testing.T, m *ethereumGatewayMock, wire []byte, height uint64) {
	t.Helper()
	raw, err := consensus.EncodePQTransaction(consensus.PQEthereumValueType, wire)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.f.wire, m.f.payload, m.height = bytes.Clone(wire), raw, height
}
func ethereumHTTP(t *testing.T, endpoint, contentType string, body []byte) (int, PQEthereumValueView) {
	t.Helper()
	var r *http.Response
	var err error
	if body == nil {
		r, err = http.Get(endpoint)
	} else {
		r, err = http.Post(endpoint, contentType, bytes.NewReader(body))
	}
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var v PQEthereumValueView
	if err = json.NewDecoder(r.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if r.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("original response is cacheable")
	}
	return r.StatusCode, v
}

func TestPQEthereumGatewayFullMemberTypesOriginalAndColdRead(t *testing.T) {
	f, m, server, g, path := newEthereumGateway(t)
	before := queryPQGatewayAccount(t, f.a, f.owner)
	var first PQEthereumValueView
	for kind := uint32(0); kind < 3; kind++ {
		wire := gatewayEthereumWire(t, f, gatewayEthereumIntent(f, kind, uint64(kind+1)), 4)
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil || member.Certificate.N != 4 || member.Index != 3 {
			t.Fatal("fixture lost full N>1 Member")
		}
		setGatewayEthereum(t, m, wire, uint64(kind+4))
		ct, body := "application/octet-stream", wire
		if kind == 1 {
			ct, body = "application/json", f.payload
		}
		code, v := ethereumHTTP(t, server.URL+"/transactions/pq/ethereum/broadcast", ct, body)
		if code != 200 || !v.Committed || !v.Submitted || v.Status != "committed" || v.TransactionType != kind || v.Fee != 42000 || v.GasLimit != 21000 || v.Nonce != uint64(kind+1) || v.ConsumedNonce != uint64(kind+2) || v.NativeTransactionHash == v.ABCITransactionHash {
			t.Fatalf("bad real execution: %d %+v", code, v)
		}
		if kind == 0 {
			first = v
		}
		for _, route := range []string{v.ReadbackURL, v.ABCIReadbackURL} {
			code, read := ethereumHTTP(t, server.URL+route, "", nil)
			if code != 200 || !read.Committed || read.Submitted || !bytes.Equal(read.Wire, wire) || !bytes.Equal(read.Transport, f.payload) {
				t.Fatalf("lost original: %d %+v", code, read)
			}
		}
		for _, hash := range []string{v.NativeTransactionHash, v.ABCITransactionHash} {
			tx := assertRPCObject(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionByHash","params":[%q]}`, hash))
			receipt := assertRPCObject(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":[%q]}`, hash))
			if tx["type"] != hexEVMQuantity(uint64(kind)) || tx["nonce"] != hexEVMQuantity(uint64(kind+1)) || tx["gas"] != "0x5208" || tx["gasPrice"] != "0x2" || tx["hash"] != v.NativeTransactionHash || tx["ynxABCITransactionHash"] != v.ABCITransactionHash || receipt["gasUsed"] != "0x5208" || receipt["type"] != tx["type"] || receipt["effectiveGasPrice"] != "0x2" {
				t.Fatalf("PQ projection defaulted fields: %+v %+v", tx, receipt)
			}
			for _, field := range []string{"v", "r", "s", "yParity"} {
				if _, ok := tx[field]; ok {
					t.Fatalf("PQ fabricated classic signature %s", field)
				}
			}
		}
		evidence, err := g.blockAtHeight(context.Background(), uint64(kind+4))
		if err != nil {
			t.Fatal(err)
		}
		mapped, err := mappedAtCometIndex(evidence, 0)
		if err != nil || mapped.Hash != v.NativeTransactionHash {
			t.Fatalf("raw block index mapping: %+v %v", mapped, err)
		}
		block := evmCommittedBlock(evidence, true, 21000)
		if block["transactions"] == nil {
			t.Fatal("missing explicit PQ block projection")
		}
	}
	after := queryPQGatewayAccount(t, f.a, f.owner)
	if before.Balance-after.Balance != 3*(42000+7) || after.Nonce != before.Nonce+3 {
		t.Fatal("real fees or current-account nonce differ")
	}
	var err error
	f.a, err = consensus.NewPersistentApplication(f.migration, path)
	if err != nil {
		t.Fatal(err)
	}
	code, v := ethereumHTTP(t, server.URL+first.ReadbackURL, "", nil)
	if code != 200 || !v.Committed || !bytes.Equal(v.Wire, first.Wire) || !bytes.Equal(v.Original.History, first.Original.History) {
		t.Fatalf("cold original changed: %d %+v", code, v)
	}
}

func TestPQEthereumGatewayUnknownReadsOriginalWithoutResubmission(t *testing.T) {
	f, m, server, _, _ := newEthereumGateway(t)
	wire := gatewayEthereumWire(t, f, gatewayEthereumIntent(f, 2, 1), 4)
	setGatewayEthereum(t, m, wire, 4)
	m.mode = "lost-response"
	code, v := ethereumHTTP(t, server.URL+"/transactions/pq/ethereum/broadcast", "application/octet-stream", wire)
	if code != 202 || v.Status != "unknown" || !v.Submitted || v.Committed || m.posts != 1 {
		t.Fatalf("ambiguous POST not UNKNOWN: %d %+v posts=%d", code, v, m.posts)
	}
	m.mode = ""
	code, read := ethereumHTTP(t, server.URL+v.ReadbackURL, "", nil)
	if code != 200 || !read.Committed || read.Submitted || m.posts != 1 || !bytes.Equal(read.Wire, wire) {
		t.Fatalf("readback replayed/lost original: %d %+v posts=%d", code, read, m.posts)
	}
}

func TestPQEthereumGatewayRejectsProofNetworkAndTerminalRevocation(t *testing.T) {
	f, m, server, _, path := newEthereumGateway(t)
	good := gatewayEthereumWire(t, f, gatewayEthereumIntent(f, 0, 1), 4)
	bad := bytes.Clone(good)
	bad[len(bad)-1] ^= 1
	badSignature := func(branch string) []byte {
		member, err := ynxbatch.DecodeMember(good)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "a" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		wire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		return wire
	}
	wrong := gatewayEthereumIntent(f, 0, 1)
	wrong.ChainID = bytes.Repeat([]byte{0x42}, 32)
	for name, wire := range map[string][]byte{"proof": bad, "signature-a": badSignature("a"), "signature-b": badSignature("b"), "network": gatewayEthereumWire(t, f, wrong, 4)} {
		t.Run(name, func(t *testing.T) {
			code, v := ethereumHTTP(t, server.URL+"/transactions/pq/ethereum/broadcast", "application/octet-stream", wire)
			if code < 400 || v.Submitted || m.posts != 0 {
				t.Fatalf("invalid proof posted: %d %+v", code, v)
			}
		})
	}
	setGatewayEthereum(t, m, good, 4)
	code, v := ethereumHTTP(t, server.URL+"/transactions/pq/ethereum/broadcast", "application/octet-stream", good)
	if code != 200 || !v.Committed {
		t.Fatal(v.Error)
	}
	auth := gatewayRevocationPolicy(t, f, f.owner)
	record := auth.Policy.Records[0]
	revoke := signGatewayRevocation(t, f.key, ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: record.PKA, PKB: record.PKB, AuthorizingRevision: record.Revision, ThroughRevision: record.Revision, LedgerNonce: 3, ExecuteAt: 5, RevokeAt: 6})
	raw, err := consensus.EncodePQTransaction(consensus.PQRevocationType, revoke)
	if err != nil {
		t.Fatal(err)
	}
	commitGatewayRevocationBlock(t, f, 5, raw)
	next := gatewayEthereumWire(t, f, gatewayEthereumIntent(f, 0, 3), 4)
	code, rejected := ethereumHTTP(t, server.URL+"/transactions/pq/ethereum/broadcast", "application/octet-stream", next)
	if code != 422 || rejected.Submitted || m.posts != 1 {
		t.Fatalf("terminally revoked key posted: %d %+v", code, rejected)
	}
	f.a, err = consensus.NewPersistentApplication(f.migration, path)
	if err != nil {
		t.Fatal(err)
	}
	code, old := ethereumHTTP(t, server.URL+v.ReadbackURL, "", nil)
	if code != 200 || !old.Committed || old.Original.Authorization.PQSigningEnabled {
		t.Fatalf("future tombstone erased historical authorization: %d %+v", code, old)
	}
}

func TestPQEthereumGatewayRejectsChangedIndexGasTypeAndFee(t *testing.T) {
	f, m, server, _, _ := newEthereumGateway(t)
	wire := gatewayEthereumWire(t, f, gatewayEthereumIntent(f, 2, 1), 4)
	setGatewayEthereum(t, m, wire, 4)
	code, v := ethereumHTTP(t, server.URL+"/transactions/pq/ethereum/broadcast", "application/octet-stream", wire)
	if code != 200 {
		t.Fatal(v.Error)
	}
	reject := func(t *testing.T) {
		t.Helper()
		code, read := ethereumHTTP(t, server.URL+v.ReadbackURL, "", nil)
		if code != 202 || read.Committed || read.Original != nil || read.Error == "" {
			t.Fatalf("bad read evidence accepted: %d %+v", code, read)
		}
	}
	t.Run("original-index", func(t *testing.T) {
		m.lookupMutation = func(tx *cometTx) { tx.Index = 1 }
		defer func() { m.lookupMutation = nil }()
		reject(t)
	})
	t.Run("block-order", func(t *testing.T) {
		m.blockMutation = func(b *cometBlock) {
			b.Result.Block.Data.Txs = [][]byte{[]byte("another transaction"), b.Result.Block.Data.Txs[0]}
		}
		defer func() { m.blockMutation = nil }()
		reject(t)
	})
	t.Run("block-gas", func(t *testing.T) {
		m.resultMutation = func(b *cometBlockResults) { b.Result.TxsResults[0].GasUsed = "1" }
		defer func() { m.resultMutation = nil }()
		reject(t)
	})
	for _, name := range []string{"type", "fee", "missing-original"} {
		t.Run(name, func(t *testing.T) {
			m.queryMutation = func(path string, raw []byte) []byte {
				if !strings.HasPrefix(path, consensus.PQEthereumValueOriginalPath) {
					return raw
				}
				var original consensus.PQEthereumValueOriginalView
				if json.Unmarshal(raw, &original) != nil {
					t.Fatal("missing real original")
				}
				if name == "missing-original" {
					original.Wire = nil
				} else if name == "type" {
					var tx map[string]any
					_ = json.Unmarshal(original.History, &tx)
					tx["type"] = consensus.EthereumLegacyTransferType
					original.History, _ = json.Marshal(tx)
				} else {
					var fee consensus.BFTFeeEvent
					_ = json.Unmarshal(original.Fee, &fee)
					fee.GrossFeeYNXT--
					original.Fee, _ = json.Marshal(fee)
				}
				result, _ := json.Marshal(original)
				return result
			}
			defer func() { m.queryMutation = nil }()
			reject(t)
		})
	}
	if m.posts != 1 {
		t.Fatal("read rejection resubmitted original")
	}
}

func TestPQEthereumGatewayPreservesClassicRLPProjection(t *testing.T) {
	f, m, _, g, _ := newEthereumGateway(t)
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(214)))
	before := queryPQGatewayAccount(t, f.a, f.recipient)
	raw, classic, err := consensus.NewEthereumLegacyTransfer(key, 6423, before.Nonce, 2, f.owner, 9)
	if err != nil {
		t.Fatal(err)
	}
	commitGatewayRevocationBlock(t, f, 4, raw)
	// The fixture publishes the actual successful result and raw block; projection
	// must still execute the original classic decoder and ECDSA verification.
	result := cometTxResult{Code: 0, GasUsed: "21000", Data: []byte(classic.Hash)}
	m.mu.Lock()
	m.block = [][]byte{raw}
	m.blockResults = []cometTxResult{result}
	m.indexed[consensus.SignedTransactionHash(raw)] = cometTx{Hash: strings.TrimPrefix(consensus.SignedTransactionHash(raw), "0x"), Height: "4", Tx: raw, TxResult: result}
	m.mu.Unlock()
	mapped, err := mappedTransaction(raw, 4, strings.Repeat("b", 64), time.Unix(4, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	projected := evmCommittedTransaction(mapped, 0, raw)
	if projected["hash"] != classic.Hash || projected["v"] == nil || projected["r"] == nil || projected["s"] == nil || projected["ynxAuthorization"] != nil {
		t.Fatalf("classic projection changed: %+v", projected)
	}
	if g == nil || reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.recipient)) {
		t.Fatal("classic positive did not execute actual ledger")
	}
	tampered := bytes.Clone(raw)
	tampered[len(tampered)-2] ^= 1
	if _, err := mappedTransaction(tampered, 4, strings.Repeat("b", 64), time.Unix(4, 0).UTC()); err == nil {
		t.Fatal("classic signed RLP verification was weakened")
	}
}

func TestPQEthereumGatewayMixedClassicBlockKeepsActualCometIndex(t *testing.T) {
	f, m, server, g, _ := newEthereumGateway(t)
	wire := gatewayEthereumWire(t, f, gatewayEthereumIntent(f, 1, 1), 4)
	pqRaw, err := consensus.EncodePQTransaction(consensus.PQEthereumValueType, wire)
	if err != nil {
		t.Fatal(err)
	}
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(214)))
	classicRaw, classic, err := consensus.NewEthereumLegacyTransfer(key, 6423, 0, 2, f.owner, 9)
	if err != nil {
		t.Fatal(err)
	}
	raws := [][]byte{classicRaw, pqRaw}
	out, err := f.a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: 4, Time: time.Unix(4, 0).UTC(), Txs: raws})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.TxResults) != 2 {
		t.Fatal("missing real mixed execution")
	}
	for _, result := range out.TxResults {
		if result.Code != 0 {
			t.Fatalf("mixed real execution rejected: %+v", result)
		}
	}
	if _, err = f.a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	m.block = raws
	for i, result := range out.TxResults {
		r := cometTxResult{Code: result.Code, Data: bytes.Clone(result.Data), GasUsed: strconv.FormatInt(result.GasUsed, 10), Log: result.Log}
		m.blockResults = append(m.blockResults, r)
		hash := consensus.SignedTransactionHash(raws[i])
		m.indexed[hash] = cometTx{Hash: strings.TrimPrefix(hash, "0x"), Height: "4", Index: uint32(i), Tx: raws[i], TxResult: r}
	}
	m.captureCurrentBlockLocked()
	m.mu.Unlock()
	native := consensus.SignedTransactionHash(wire)
	code, v := ethereumHTTP(t, server.URL+"/transactions/pq/ethereum/originals/"+native, "", nil)
	if code != 200 || !v.Committed || v.CometIndex == nil || *v.CometIndex != 1 {
		t.Fatalf("PQ raw index collapsed: %d %+v", code, v)
	}
	receipt := assertRPCObject(t, server.URL+"/evm", fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":[%q]}`, native))
	if receipt["transactionIndex"] != "0x1" || receipt["cumulativeGasUsed"] != "0xa410" {
		t.Fatalf("wrong raw index/cumulative gas: %+v", receipt)
	}
	evidence, err := g.blockAtHeight(context.Background(), 4)
	if err != nil {
		t.Fatal(err)
	}
	first, err := mappedAtCometIndex(evidence, 0)
	if err != nil || first.Hash != classic.Hash {
		t.Fatalf("classic index lost: %+v %v", first, err)
	}
	second, err := mappedAtCometIndex(evidence, 1)
	if err != nil || second.Hash != native {
		t.Fatalf("PQ index lost: %+v %v", second, err)
	}
	evidence.MappedTransactionIndexes[0], evidence.MappedTransactionIndexes[1] = 1, 0
	if _, err := mappedAtCometIndex(evidence, 1); err == nil {
		t.Fatal("reordered compact projection accepted")
	}
}
