package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func commitPQMockBlock(t *testing.T, m *pqMockComet, payloads [][]byte) {
	t.Helper()
	out, err := m.f.a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: int64(m.height), Time: time.Unix(int64(m.height), 0).UTC(), Txs: payloads})
	if err != nil || len(out.TxResults) != len(payloads) {
		t.Fatalf("Finalize mixed block: %v", err)
	}
	for i, r := range out.TxResults {
		if r.Code != 0 {
			t.Fatalf("actual mixed block tx%d failed: %s", i, r.Log)
		}
	}
	if _, err = m.f.a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	m.block = payloads
	m.blockResults = make([]cometTxResult, len(payloads))
	for i, payload := range payloads {
		r := out.TxResults[i]
		result := cometTxResult{Code: r.Code, Log: r.Log, Data: r.Data, GasUsed: strconv.FormatInt(r.GasUsed, 10)}
		hash := consensus.SignedTransactionHash(payload)
		m.blockResults[i] = result
		m.indexed[hash] = cometTx{Hash: strings.ToUpper(strings.TrimPrefix(hash, "0x")), Height: strconv.FormatUint(m.height, 10), Index: uint32(i), Tx: payload, TxResult: result}
	}
}

func TestGatewayPQMixedBlockAndHistoryOverFourMiB(t *testing.T) {
	f := newPQGatewayFixture(t)
	m := newPQMock(t, f)
	classic := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(214)))
	signed, err := consensus.NewSignedTransfer(classic, 6423, f.owner, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	ordinary, err := consensus.EncodeSignedTransaction(signed)
	if err != nil {
		t.Fatal(err)
	}
	memberBatch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{f.message(t, 2, 1)}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer memberBatch.Discard()
	member, err := ynxbatch.Extract(memberBatch, 0)
	if err != nil {
		t.Fatal(err)
	}
	memberWire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	memberPayload, err := consensus.EncodePQTransaction(consensus.PQTransferType, memberWire)
	if err != nil {
		t.Fatal(err)
	}
	payloads := [][]byte{ordinary, memberPayload}
	for batchIndex := 0; batchIndex < 6; batchIndex++ {
		messages := make([][]byte, 1024)
		for i := range messages {
			nonce := uint64(1000 + i)
			if i == 0 {
				nonce = uint64(3 + batchIndex)
			}
			messages[i] = f.message(t, nonce, 1)
		}
		wire := signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, messages)
		_, payload, err := decodeIngressWhole(wire)
		if err != nil {
			t.Fatal(err)
		}
		payloads = append(payloads, payload)
	}
	encoded, err := json.Marshal(payloads)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) <= 4<<20 {
		t.Fatal("fixture does not exceed old silent 4 MiB read cap")
	}
	commitPQMockBlock(t, m, payloads)
	server := gatewayPQServer(t, m)
	var block ProjectedBlock
	getJSON(t, server.URL+"/blocks/3", &block)
	if block.CometTransactionCount != 8 || len(block.Transactions) != 1 || len(block.PQBatches) != 6 || len(block.TransactionOrder) != 8 {
		t.Fatalf("mixed block lost containers: count %d ordinary %d batches %d", block.CometTransactionCount, len(block.Transactions), len(block.PQBatches))
	}
	if len(block.UnmappedTransactions) != 1 || block.UnmappedTransactions[0].Hash != consensus.SignedTransactionHash(memberPayload) || block.UnmappedTransactions[0].CometIndex != 1 || block.UnmappedTransactions[0].UnsupportedProjection == "" {
		t.Fatal("unmapped real PQ single effect was lost or invented")
	}
	if block.Transactions[0].Hash != consensus.SignedTransactionHash(ordinary) {
		t.Fatal("ordinary transaction lost")
	}
	for i, view := range block.PQBatches {
		if !view.Committed || view.FeeYNXT != 1 || view.CometIndex == nil || *view.CometIndex != uint32(i+2) || view.Whole != nil || len(view.Results) != 1024 || block.TransactionOrder[i+2].Hash != view.ABCITransactionHash || block.TransactionOrder[i+2].CometIndex != uint32(i+2) {
			t.Fatal("Whole flattened, duplicated or misindexed")
		}
	}
	var history TransactionList
	getJSON(t, server.URL+"/txs?limit=8", &history)
	if len(history.Transactions) != 1 || len(history.PQBatches) != 6 || history.Total != 8 || len(history.TransactionOrder) != 8 {
		t.Fatal("mixed history failed or invented N Comet transactions")
	}
	if len(history.UnmappedTransactions) != 1 || history.UnmappedTransactions[0].Hash != consensus.SignedTransactionHash(memberPayload) {
		t.Fatal("history lost unsupported PQ outer reference")
	}
	if history.TransactionOrder[0].CometIndex != 7 || history.TransactionOrder[7].CometIndex != 0 {
		t.Fatal("mixed history lost actual outer order")
	}
	// A classic lookup sharing the large block still works.
	r, err := http.Get(server.URL + "/txs/" + consensus.SignedTransactionHash(ordinary))
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, r.Body)
	r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatal("Whole broke adjacent classic lookup")
	}
	// Whole cannot be described as one Ethereum transfer or a fake gas=fee receipt.
	for _, method := range []string{"eth_getTransactionByHash", "eth_getTransactionReceipt"} {
		body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": []string{block.PQBatches[0].ABCITransactionHash}})
		resp, err := http.Post(server.URL+"/evm", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		err = json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()
		if err != nil || result.Error == nil || !strings.Contains(result.Error.Message, "native batch container") || len(result.Result) > 0 && string(result.Result) != "null" {
			t.Fatal("Whole falsely projected as Ethereum transaction/receipt")
		}
	}
}

func TestGatewayCometReadBudgetNeverSilentlyTruncates(t *testing.T) {
	body := append([]byte(`{"ok":true}`), bytes.Repeat([]byte(" "), 100)...)
	if _, err := readCometBody(bytes.NewReader(body), int64(len(body)-1)); err == nil {
		t.Fatal("oversized valid JSON prefix accepted")
	}
	read, err := readCometBody(bytes.NewReader(body), int64(len(body)))
	if err != nil || !bytes.Equal(read, body) {
		t.Fatal("exact read budget rejected")
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true}`))
		w.Write(bytes.Repeat([]byte(" "), 4<<20))
	}))
	defer upstream.Close()
	c := client{baseURL: upstream.URL, httpClient: upstream.Client()}
	var value map[string]bool
	if err := c.get(context.Background(), "/status", nil, &value); err == nil || !strings.Contains(err.Error(), "read budget") {
		t.Fatal("default RPC body silently truncated")
	}
	if err := c.getBounded(context.Background(), "/block", nil, &value, cometBlockReadBytes); err != nil || !value["ok"] {
		t.Fatal("bounded large block response rejected", err)
	}
}
