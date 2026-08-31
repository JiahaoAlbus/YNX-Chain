package indexer

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestCursorCodecRejectsTamperAndCrossFeedReuse(t *testing.T) {
	codec, err := newCursorCodec(bytes.Repeat([]byte("k"), minimumCursorKey))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := codec.encode("blocks", "42")
	if err != nil {
		t.Fatal(err)
	}
	after, err := codec.decode(encoded, "blocks")
	if err != nil || after != "42" {
		t.Fatalf("cursor round trip failed: after=%q err=%v", after, err)
	}
	if _, err := codec.decode(encoded, "transactions"); err == nil || !strings.Contains(err.Error(), "different feed") {
		t.Fatalf("cross-feed cursor was not rejected: %v", err)
	}
	last := encoded[len(encoded)-1]
	replacement := byte('A')
	if last == replacement {
		replacement = 'B'
	}
	tampered := encoded[:len(encoded)-1] + string(replacement)
	if _, err := codec.decode(tampered, "blocks"); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("tampered cursor was not rejected: %v", err)
	}
	if _, err := newCursorCodec([]byte("too-short")); err == nil {
		t.Fatal("short configured cursor key was accepted")
	}
}

func TestLatestPagesRemainStableWhenNewRecordsArrive(t *testing.T) {
	db := cursorFixtureDatabase()
	blocks, nextBlock, err := LatestBlocksPage(db, 2, "")
	if err != nil || len(blocks) != 2 || blocks[0].Height != 5 || blocks[1].Height != 4 || nextBlock != "4" {
		t.Fatalf("unexpected first block page: blocks=%+v next=%q err=%v", blocks, nextBlock, err)
	}
	db.Blocks["6"] = chain.Block{Height: 6, Hash: "block-6"}
	blocks, nextBlock, err = LatestBlocksPage(db, 2, nextBlock)
	if err != nil || len(blocks) != 2 || blocks[0].Height != 3 || blocks[1].Height != 2 || nextBlock != "2" {
		t.Fatalf("new block disturbed continuation: blocks=%+v next=%q err=%v", blocks, nextBlock, err)
	}

	txs, nextTx, err := LatestTransactionsPage(db, 2, "")
	if err != nil || len(txs) != 2 || txs[0].Hash != "tx-5" || txs[1].Hash != "tx-4" || nextTx != "tx-4" {
		t.Fatalf("unexpected first transaction page: txs=%+v next=%q err=%v", txs, nextTx, err)
	}
	db.Transactions["tx-6"] = chain.Transaction{Hash: "tx-6", Timestamp: time.Unix(6, 0).UTC()}
	txs, nextTx, err = LatestTransactionsPage(db, 2, nextTx)
	if err != nil || len(txs) != 2 || txs[0].Hash != "tx-3" || txs[1].Hash != "tx-2" || nextTx != "tx-2" {
		t.Fatalf("new transaction disturbed continuation: txs=%+v next=%q err=%v", txs, nextTx, err)
	}
}

func TestIndexerHTTPPaginationUsesOpaqueFeedBoundCursors(t *testing.T) {
	store := NewStore(t.TempDir() + "/cursor-db.json")
	if err := store.Save(cursorFixtureDatabase()); err != nil {
		t.Fatal(err)
	}
	idx := &Indexer{store: store}
	server, err := NewServerWithBuildAndCursorKey(idx, buildinfo.Info{Commit: "cursor-test"}, bytes.Repeat([]byte("p"), minimumCursorKey))
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	first := readBlockPage(t, httpServer.URL+"/blocks/latest?limit=2", http.StatusOK)
	if len(first.Blocks) != 2 || first.NextCursor == "" || first.CursorVersion != cursorVersion {
		t.Fatalf("unexpected first HTTP page: %+v", first)
	}
	second := readBlockPage(t, httpServer.URL+"/blocks/latest?limit=2&cursor="+url.QueryEscape(first.NextCursor), http.StatusOK)
	if len(second.Blocks) != 2 || second.Blocks[0].Height != 3 || second.Blocks[1].Height != 2 {
		t.Fatalf("unexpected second HTTP page: %+v", second)
	}

	crossFeed, err := http.Get(httpServer.URL + "/txs?limit=2&cursor=" + url.QueryEscape(first.NextCursor))
	if err != nil {
		t.Fatal(err)
	}
	defer crossFeed.Body.Close()
	if crossFeed.StatusCode != http.StatusBadRequest {
		t.Fatalf("cross-feed cursor returned %d", crossFeed.StatusCode)
	}
	var failure map[string]any
	if err := json.NewDecoder(crossFeed.Body).Decode(&failure); err != nil {
		t.Fatal(err)
	}
	if failure["error"] != "invalid request" || failure["classification"] != "INVALID_REQUEST" || failure["detail"] != nil {
		t.Fatalf("unexpected cross-feed failure: %+v", failure)
	}

	tampered := first.NextCursor[:len(first.NextCursor)-1] + "A"
	failurePage := readBlockPage(t, httpServer.URL+"/blocks/latest?cursor="+url.QueryEscape(tampered), http.StatusBadRequest)
	if failurePage.Error != "invalid request" {
		t.Fatalf("tampered cursor failure was not explicit: %+v", failurePage)
	}
}

type blockPageResponse struct {
	Blocks        []chain.Block `json:"blocks"`
	NextCursor    string        `json:"nextCursor"`
	CursorVersion int           `json:"cursorVersion"`
	Error         string        `json:"error"`
	Detail        string        `json:"detail"`
}

func readBlockPage(t *testing.T, endpoint string, expectedStatus int) blockPageResponse {
	t.Helper()
	response, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != expectedStatus {
		t.Fatalf("%s returned %d, expected %d", endpoint, response.StatusCode, expectedStatus)
	}
	var page blockPageResponse
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	return page
}

func cursorFixtureDatabase() Database {
	db := Database{
		Version:      2,
		Network:      "YNX Testnet",
		ChainID:      6423,
		NativeSymbol: "YNXT",
		Blocks:       map[string]chain.Block{},
		Transactions: map[string]chain.Transaction{},
	}
	for value := 1; value <= 5; value++ {
		raw := strconv.Itoa(value)
		height := uint64(value)
		db.Blocks[raw] = chain.Block{Height: height, Hash: "block-" + raw}
		db.Transactions["tx-"+raw] = chain.Transaction{Hash: "tx-" + raw, Timestamp: time.Unix(int64(value), 0).UTC()}
	}
	return db
}
