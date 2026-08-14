package indexer

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestConcurrentLatestBlockReadersDoNotStarveSyncWrites(t *testing.T) {
	const retainedBlocks = 200_000
	blocks := make(map[string]chain.Block, retainedBlocks)
	for height := 1; height <= retainedBlocks; height++ {
		blocks[strconv.Itoa(height)] = chain.Block{Height: uint64(height), Hash: blockHash(uint64(height))}
	}
	store := &Store{
		loaded: true,
		db: Database{
			Version:           2,
			Network:           "YNX Testnet",
			ChainID:           6423,
			NativeSymbol:      "YNXT",
			LastIndexedHeight: retainedBlocks,
			LastSourceHeight:  retainedBlocks,
			LastBlockHash:     blockHash(retainedBlocks),
			Blocks:            blocks,
			Transactions:      map[string]chain.Transaction{},
		},
	}
	server := NewServer(&Indexer{store: store})

	const readers = 32
	start := make(chan struct{})
	var group sync.WaitGroup
	group.Add(readers)
	for range readers {
		go func() {
			defer group.Done()
			<-start
			request := httptest.NewRequest(http.MethodGet, "/blocks/latest?limit=12", nil)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Errorf("latest blocks returned %d", response.Code)
			}
		}()
	}
	close(start)

	writeDone := make(chan error, 1)
	go func() {
		status := Status{Network: "YNX Testnet", ChainID: 6423, NativeCurrencySymbol: "YNXT", Height: retainedBlocks + 1}
		block := chain.Block{Height: retainedBlocks + 1, Hash: blockHash(retainedBlocks + 1), ParentHash: blockHash(retainedBlocks)}
		_, err := store.UpsertBlock("http://127.0.0.1:6420", status, block)
		writeDone <- err
	}()

	select {
	case err := <-writeDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("sync write was starved by concurrent latest-block readers")
	}
	group.Wait()
}
