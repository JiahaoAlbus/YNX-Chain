package bftgateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// Original source and post-import execution use the actual Application. Comet
// search/block transport remains an isolated fixture, not a running network or
// an independent finality proof.
type transactionHistoryPageFixture struct {
	f              *pqIdentityFixture
	gateway        *Gateway
	rows           []cometTx
	block          cometBlock
	source         []consensus.MigrationHistoryPageEntry
	mode           string
	metadataHeight int64
	searches       []url.Values
	sourcePaths    []string
	advance        bool
}

func newTransactionHistoryPageFixture(t *testing.T) *transactionHistoryPageFixture {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 41))
	owner, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	recipient := "0x" + strings.Repeat("2", 40)
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		if _, err := d.Faucet(owner, 1000); err != nil {
			t.Fatal(err)
		}
		d.ProduceBlock()
		for _, amount := range []int64{7, 8} {
			if _, err := d.Transfer(owner, recipient, amount); err != nil {
				t.Fatal(err)
			}
		}
		d.ProduceBlock()
	})
	height := f.stateHeight + 1
	at := time.Date(2026, 10, 18, 1, 2, 20, 0, time.UTC)
	var payloads [][]byte
	for index := 0; index < 3; index++ {
		signed, err := consensus.NewSignedTransfer(key, 6423, recipient, int64(index+1), uint64(index+3))
		if err != nil {
			t.Fatal(err)
		}
		payload, err := consensus.EncodeSignedTransaction(signed)
		if err != nil {
			t.Fatal(err)
		}
		payloads = append(payloads, payload)
	}
	finalized, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: at, Txs: payloads, NextValidatorsHash: bytes.Clone(f.set.Hash())})
	if err != nil || len(finalized.TxResults) != len(payloads) {
		t.Fatal("actual post-import transaction fixture did not execute", err)
	}
	if _, err := f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	m := &transactionHistoryPageFixture{f: f}
	for index, payload := range payloads {
		result := finalized.TxResults[index]
		if result.Code != 0 {
			t.Fatal("actual post-import transfer was rejected", result.Log)
		}
		m.rows = append(m.rows, cometTx{Hash: strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(payload), "0x")), Height: strconv.FormatInt(height, 10), Index: uint32(index), Tx: payload, TxResult: cometTxResult{Code: result.Code, Data: bytes.Clone(result.Data), Log: result.Log, GasUsed: strconv.FormatInt(result.GasUsed, 10)}})
	}
	for left, right := 0, len(m.rows)-1; left < right; left, right = left+1, right-1 {
		m.rows[left], m.rows[right] = m.rows[right], m.rows[left]
	}
	info, err := f.app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil || info.LastBlockHeight != height {
		t.Fatal(err)
	}
	f.stateHeight, f.stateHash = height, hex.EncodeToString(info.LastBlockAppHash)
	m.block.Result.BlockID.Hash = strings.Repeat("b", 64)
	m.block.Result.Block.Header.Height = strconv.FormatInt(height, 10)
	m.block.Result.Block.Header.Time = at
	m.block.Result.Block.Header.Proposer = strings.Repeat("c", 40)
	m.block.Result.Block.Header.AppHash = f.stateHash
	m.block.Result.Block.Header.DataHash = strings.Repeat("a", 64)
	m.block.Result.Block.Header.LastBlockID.Hash = strings.Repeat("d", 64)
	m.block.Result.Block.Data.Txs = payloads
	for block := len(f.migration.Runtime.Blocks) - 1; block >= 0; block-- {
		transactions := f.migration.Runtime.Blocks[block].Transactions
		for index := len(transactions) - 1; index >= 0; index-- {
			m.source = append(m.source, consensus.MigrationHistoryPageEntry{Transaction: transactions[index], NativeIndex: uint32(index)})
		}
	}
	base := f.serve(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Error("history reader performed a mutation request")
			w.WriteHeader(500)
			return
		}
		switch r.URL.Path {
		case "/abci_query":
			path, _ := strconv.Unquote(r.URL.Query().Get("path"))
			if path == consensus.PQWalletIdentityPath && m.advance {
				// Simulate the independent consensus writer committing after
				// metadata capture. Production history code has no write path.
				m.advance = false
				next := f.stateHeight + 1
				if _, err := f.app.FinalizeBlock(r.Context(), &abci.RequestFinalizeBlock{Height: next, Time: at.Add(time.Second), NextValidatorsHash: bytes.Clone(f.set.Hash())}); err != nil {
					t.Error(err)
				}
				if _, err := f.app.Commit(r.Context(), &abci.RequestCommit{}); err != nil {
					t.Error(err)
				}
				f.stateHeight = next
			}
			if !strings.HasPrefix(path, consensus.MigrationHistoryPagePath) {
				base.ServeHTTP(w, r)
				return
			}
			m.sourcePaths = append(m.sourcePaths, path)
			if m.mode == "source-http" {
				w.WriteHeader(503)
				return
			}
			response, err := f.app.Query(r.Context(), &abci.RequestQuery{Path: path})
			if err != nil || response.Code != 0 {
				t.Error("actual original pagination query failed", err, response)
				w.WriteHeader(500)
				return
			}
			var view consensus.MigrationHistoryPageView
			if err := json.Unmarshal(response.Value, &view); err != nil {
				t.Error(err)
			}
			if view.Limit == 0 {
				m.metadataHeight = response.Height
				if m.mode == "metadata-overflow" {
					view.Total = math.MaxUint64
				}
				if m.mode == "metadata-records" {
					view.Records = append(view.Records, m.source[0])
				}
			} else {
				switch m.mode {
				case "source-total":
					view.Total++
				case "source-anchor":
					view.SourceAnchor = strings.Repeat("e", 64)
				case "source-coordinates":
					view.Offset++
				case "source-count":
					view.Records = append(view.Records, m.source[len(m.source)-1])
				case "source-order":
					view.Records[0], view.Records[1] = view.Records[1], view.Records[0]
				case "source-duplicate":
					view.Records[1] = view.Records[0]
				case "source-index":
					view.Records[1].NativeIndex = view.Records[0].NativeIndex
				case "source-blockhash":
					view.Records[1].Transaction.BlockHash = strings.Repeat("e", 64)
				case "source-old-height":
					response.Height = m.metadataHeight - 1
				}
			}
			response.Value, _ = json.Marshal(view)
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": response.Code, "height": strconv.FormatInt(response.Height, 10), "value": base64.StdEncoding.EncodeToString(response.Value)}}})
		case "/tx_search":
			m.searches = append(m.searches, r.URL.Query())
			query := r.URL.Query().Get("query")
			var lower, upper int64
			count, scanErr := fmt.Sscanf(query, `"tx.height > %d AND tx.height <= %d"`, &lower, &upper)
			if scanErr != nil || count != 2 || lower != int64(f.migration.Height) || upper < lower || upper > m.metadataHeight || query != fmt.Sprintf(`"tx.height > %d AND tx.height <= %d"`, lower, upper) || r.URL.Query().Get("prove") != "true" || r.URL.Query().Get("order_by") != `"desc"` {
				t.Error("history search escaped its exact migration/current-height range", r.URL.RawQuery)
				w.WriteHeader(500)
				return
			}
			if m.mode == "comet-http" {
				w.WriteHeader(503)
				return
			}
			page, _ := strconv.Atoi(r.URL.Query().Get("page"))
			limit, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
			var eligible []cometTx
			for _, row := range m.rows {
				height, err := strconv.ParseInt(row.Height, 10, 64)
				if err != nil {
					t.Error(err)
				}
				if height <= upper {
					eligible = append(eligible, row)
				}
			}
			start := (page - 1) * limit
			if start > len(eligible) {
				start = len(eligible)
			}
			end := start + limit
			if end > len(eligible) {
				end = len(eligible)
			}
			rows := append([]cometTx{}, eligible[start:end]...)
			total := len(eligible)
			if m.mode == "comet-total-changed" && page > 1 {
				total++
			}
			if len(rows) > 0 {
				switch m.mode {
				case "comet-height":
					rows[0].Height = strconv.FormatInt(m.metadataHeight+1, 10)
				case "comet-hash":
					rows[0].Hash = strings.Repeat("e", 64)
				}
			}
			if len(rows) > 1 {
				switch m.mode {
				case "comet-order":
					rows[0], rows[1] = rows[1], rows[0]
				case "comet-duplicate":
					rows[1] = rows[0]
				case "comet-index":
					rows[1].Index = rows[0].Index
				case "comet-count":
					rows = rows[:len(rows)-1]
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"txs": rows, "total_count": strconv.Itoa(total)}})
		case "/block":
			if r.URL.Query().Get("height") != m.block.Result.Block.Header.Height {
				t.Error("projection requested another block height", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(m.block)
		default:
			t.Error("unexpected history endpoint", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(upstream.Close)
	m.gateway, err = New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.migration.Height, MigrationBlockHash: f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func (m *transactionHistoryPageFixture) read(page, limit int) *httptest.ResponseRecorder {
	m.searches, m.sourcePaths = nil, nil
	w := httptest.NewRecorder()
	m.gateway.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/txs?page=%d&limit=%d", page, limit), nil))
	return w
}

func TestGatewayTransactionHistoryPageCrossesOriginalBoundaryAndColdRead(t *testing.T) {
	m := newTransactionHistoryPageFixture(t)
	stateBefore, err := os.ReadFile(m.f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	migrationBefore, _ := m.f.migration.CanonicalJSON()
	var hashes []string
	for _, row := range m.rows {
		hashes = append(hashes, consensus.SignedTransactionHash(row.Tx))
	}
	for _, row := range m.source {
		hashes = append(hashes, row.Transaction.Hash)
	}
	for _, window := range []struct{ page, limit int }{{1, 2}, {2, 2}, {3, 2}, {4, 2}, {1, 5}} {
		response := m.read(window.page, window.limit)
		var got TransactionList
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || got.Total != uint64(len(hashes)) || got.ImportedHistory == nil || got.ImportedHistory.SourceAnchor != m.f.migration.StateHash || got.CometHistoryUpperHeight != m.f.stateHeight {
			t.Fatal("combined original history page failed", window, response.Code, response.Body.String())
		}
		offset := (window.page - 1) * window.limit
		start := offset
		if start > len(hashes) {
			start = len(hashes)
		}
		end := start + window.limit
		if end > len(hashes) {
			end = len(hashes)
		}
		if len(got.Transactions) != end-start {
			t.Fatal("combined page lost or expanded original outer rows", window)
		}
		for index, tx := range got.Transactions {
			if tx.Hash != hashes[start+index] {
				t.Fatal("combined page changed newest-first transaction order", window)
			}
			if tx.BlockNum <= m.f.migration.Height {
				found := false
				for _, original := range m.source {
					found = found || reflect.DeepEqual(tx, original.Transaction)
				}
				if !found {
					t.Fatal("source pagination changed original transaction fields")
				}
			}
		}
		cometCount := int(historyWindowRows(uint64(len(m.rows)), uint64(offset), uint64(window.limit)))
		if len(got.TransactionOrder) != cometCount || len(got.ImportedTransactionOrder) != len(got.Transactions)-cometCount {
			t.Fatal("source rows acquired Comet indexes or batch positions", window)
		}
		for _, ref := range got.ImportedTransactionOrder {
			matched := false
			for _, original := range m.source {
				matched = matched || ref.Hash == original.Transaction.Hash && ref.Type == original.Transaction.Type && ref.Height == original.Transaction.BlockNum && ref.NativeIndex == original.NativeIndex
			}
			if !matched {
				t.Fatal("source row lost its original native index", ref)
			}
		}
		if (got.NextPage != nil) != (offset+window.limit < len(hashes)) {
			t.Fatal("combined page continuation differs from the complete total")
		}
		expectedSearches := 1
		if window.page > 1 && offset < len(m.rows) {
			expectedSearches++
		}
		if len(m.searches) != expectedSearches || window.page > 1 && (m.searches[0].Get("page") != "1" || m.searches[0].Get("per_page") != "1") {
			t.Fatal("later page skipped the total probe or fetched unnecessary Comet rows", window, m.searches)
		}
		if len(m.sourcePaths) != 1+boolInt(len(got.ImportedTransactionOrder) > 0) || m.sourcePaths[0] != consensus.MigrationHistoryPagePath+"0/0" {
			t.Fatal("source pagination fetched more than metadata and its exact window", m.sourcePaths)
		}
		var fields map[string]json.RawMessage
		if json.Unmarshal(response.Body.Bytes(), &fields) != nil || string(fields["cometHistoryUpperHeight"]) != strconv.Quote(strconv.FormatInt(m.f.stateHeight, 10)) {
			t.Fatal("combined history lost its fixed-height string coordinate")
		}
	}
	original := bytes.Clone(m.read(2, 2).Body.Bytes())
	cold, err := consensus.NewPersistentApplicationWithBootstrap(m.f.migration, m.f.statePath, m.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	m.f.app = cold
	if restored := m.read(2, 2); restored.Code != 200 || !bytes.Equal(original, restored.Body.Bytes()) {
		t.Fatal("cold combined page changed original row or migration-anchor bytes")
	}
	for _, mode := range []string{"source-http", "metadata-records", "metadata-overflow", "source-total", "source-anchor", "source-coordinates", "source-count", "source-order", "source-duplicate", "source-index", "source-blockhash", "source-old-height", "comet-http", "comet-height", "comet-hash", "comet-order", "comet-duplicate", "comet-index", "comet-count"} {
		m.mode = mode
		if failed := m.read(1, 5); failed.Code != 502 {
			t.Fatal("inconsistent source/Comet page did not fail closed", mode, failed.Code, failed.Body.String())
		}
	}
	m.mode = "comet-total-changed"
	if failed := m.read(2, 1); failed.Code != 502 {
		t.Fatal("later-page total changed inside the fixed-height read", failed.Code)
	}
	stateAfter, _ := os.ReadFile(m.f.statePath)
	migrationAfter, _ := m.f.migration.CanonicalJSON()
	if !bytes.Equal(stateBefore, stateAfter) || !bytes.Equal(migrationBefore, migrationAfter) {
		t.Fatal("readonly combined history rewrote original migration or durable state")
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func TestGatewayTransactionHistoryPagePinsUpperHeightDuringNewCommit(t *testing.T) {
	m := newTransactionHistoryPageFixture(t)
	upper := m.f.stateHeight
	m.advance = true
	response := m.read(1, 5)
	var got TransactionList
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || m.f.stateHeight != upper+1 || got.CometHistoryUpperHeight != upper {
		t.Fatal("concurrent commit changed the captured history upper height", response.Code, response.Body.String())
	}
	for _, search := range m.searches {
		if search.Get("query") != fmt.Sprintf(`"tx.height > %d AND tx.height <= %d"`, m.f.migration.Height, upper) {
			t.Fatal("search moved to latest state instead of the original captured height")
		}
	}
}

func TestGatewayTransactionHistoryContinuationAfterCommitAndColdRead(t *testing.T) {
	m := newTransactionHistoryPageFixture(t)
	upper := m.f.stateHeight
	var original []string
	for _, row := range m.rows {
		original = append(original, consensus.SignedTransactionHash(row.Tx))
	}
	for _, row := range m.source {
		original = append(original, row.Transaction.Hash)
	}
	var first TransactionList
	firstResponse := m.read(1, 2)
	if firstResponse.Code != 200 || json.Unmarshal(firstResponse.Body.Bytes(), &first) != nil || first.CometHistoryUpperHeight != upper {
		t.Fatal("initial history snapshot failed", firstResponse.Code)
	}
	// A genuine new application commit changes the live Comet search total.
	// Continuing the original snapshot must exclude this new transaction and
	// retain the old Comet/source boundary across separate HTTP requests.
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 41))
	signed, err := consensus.NewSignedTransfer(key, 6423, "0x"+strings.Repeat("2", 40), 1, 6)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := consensus.EncodeSignedTransaction(signed)
	if err != nil {
		t.Fatal(err)
	}
	next := upper + 1
	finalized, err := m.f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: next, Time: time.Date(2026, 10, 18, 1, 2, 21, 0, time.UTC), Txs: [][]byte{payload}, NextValidatorsHash: bytes.Clone(m.f.set.Hash())})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
		t.Fatal("new application transfer did not execute", err, finalized)
	}
	if _, err := m.f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	info, err := m.f.app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil || info.LastBlockHeight != next {
		t.Fatal("new committed height unavailable", err)
	}
	m.f.stateHeight, m.f.stateHash = next, hex.EncodeToString(info.LastBlockAppHash)
	result := finalized.TxResults[0]
	m.rows = append([]cometTx{{Hash: strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(payload), "0x")), Height: strconv.FormatInt(next, 10), Index: 0, Tx: payload, TxResult: cometTxResult{Code: result.Code, Data: bytes.Clone(result.Data), Log: result.Log, GasUsed: strconv.FormatInt(result.GasUsed, 10)}}}, m.rows...)
	stateBefore, err := os.ReadFile(m.f.statePath)
	if err != nil {
		t.Fatal(err)
	}
	read := func(target string) *httptest.ResponseRecorder {
		t.Helper()
		response := httptest.NewRecorder()
		m.gateway.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		return response
	}
	var gotHashes []string
	for _, tx := range first.Transactions {
		gotHashes = append(gotHashes, tx.Hash)
	}
	var secondRaw []byte
	for page := 2; page <= (len(original)+1)/2; page++ {
		target := fmt.Sprintf("/txs?page=%d&limit=2&cometHistoryUpperHeight=%d", page, upper)
		response := read(target)
		var got TransactionList
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || got.Total != uint64(len(original)) || got.CometHistoryUpperHeight != upper {
			t.Fatal("HISTORY_PAGE_MOVED_AFTER_COMMIT", page, response.Code, response.Body.String())
		}
		for _, tx := range got.Transactions {
			gotHashes = append(gotHashes, tx.Hash)
		}
		if page == 2 {
			secondRaw = bytes.Clone(response.Body.Bytes())
		}
	}
	if !reflect.DeepEqual(gotHashes, original) {
		t.Fatal("HISTORY_PAGE_MOVED_AFTER_COMMIT: repeated, skipped, reordered or new transaction", gotHashes, original)
	}
	// Read the added continuation field as JSON so the exact old production
	// leaves still compile for the CI RED reproduction above.
	var firstFields map[string]json.RawMessage
	var nextURL string
	if json.Unmarshal(firstResponse.Body.Bytes(), &firstFields) != nil || json.Unmarshal(firstFields["nextPageURL"], &nextURL) != nil || nextURL == "" {
		t.Fatal("history continuation lacks an explicit fixed-height URL")
	}
	parsed, err := url.Parse(nextURL)
	if err != nil || parsed.Path != "/txs" || parsed.Query().Get("page") != "2" || parsed.Query().Get("limit") != "2" || parsed.Query().Get("cometHistoryUpperHeight") != strconv.FormatInt(upper, 10) {
		t.Fatal("next-page URL lost the original snapshot coordinates", nextURL)
	}
	cold, err := consensus.NewPersistentApplicationWithBootstrap(m.f.migration, m.f.statePath, m.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	m.f.app = cold
	if restored := read(nextURL); restored.Code != 200 || !bytes.Equal(secondRaw, restored.Body.Bytes()) {
		t.Fatal("cold continuation changed the original page", restored.Code, restored.Body.String())
	}
	for _, value := range []string{"", "0", "-1", "+1", "01", "1.0", "9223372036854775808", strconv.FormatUint(m.f.migration.Height-1, 10), strconv.FormatInt(next+1, 10)} {
		if failed := read("/txs?cometHistoryUpperHeight=" + url.QueryEscape(value)); failed.Code != 400 {
			t.Fatal("invalid or future continuation height accepted", value, failed.Code)
		}
	}
	if failed := read(fmt.Sprintf("/txs?cometHistoryUpperHeight=%d&cometHistoryUpperHeight=%d", upper, upper)); failed.Code != 400 {
		t.Fatal("ambiguous continuation height accepted", failed.Code)
	}
	stateAfter, err := os.ReadFile(m.f.statePath)
	if err != nil || !bytes.Equal(stateBefore, stateAfter) {
		t.Fatal("history continuation rewrote durable state", err)
	}
}
