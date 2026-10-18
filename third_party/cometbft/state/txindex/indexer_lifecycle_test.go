package txindex_test

import (
	"errors"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	"github.com/cometbft/cometbft/libs/log"
	blockidxkv "github.com/cometbft/cometbft/state/indexer/block/kv"
	"github.com/cometbft/cometbft/state/txindex"
	"github.com/cometbft/cometbft/state/txindex/kv"
	"github.com/cometbft/cometbft/types"
)

func waitIndexerWorker(t *testing.T, service *txindex.IndexerService) {
	t.Helper()
	done := make(chan struct{})
	go func() { service.WaitForIndexing(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("index worker did not exit before database close")
	}
}

func TestIndexerOwnedDatabaseStopWithPartialBlock(t *testing.T) {
	for _, stopBusFirst := range []bool{false, true} {
		name := "service-first"
		if stopBusFirst {
			name = "event-bus-first"
		}
		t.Run(name, func(t *testing.T) {
			bus := types.NewEventBus()
			bus.SetLogger(log.NewNopLogger())
			if err := bus.Start(); err != nil {
				t.Fatal(err)
			}
			db := dbm.NewMemDB()
			blocks := blockidxkv.New(dbm.NewPrefixDB(db, []byte("block_events")))
			service := txindex.NewIndexerService(kv.NewTxIndex(db), blocks, bus, false)
			service.SetLogger(log.NewNopLogger())
			if err := service.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = service.Stop(); _ = bus.Stop(); _ = db.Close() })
			// Real unbuffered event delivery hands the worker a block whose
			// transaction events never arrive. Stop must cancel this inner wait.
			if err := bus.PublishEventNewBlockEvents(types.EventDataNewBlockEvents{Height: 1, NumTxs: 2}); err != nil {
				t.Fatal(err)
			}
			if stopBusFirst {
				if err := bus.Stop(); err != nil {
					t.Fatal(err)
				}
			}
			if err := service.Stop(); err != nil {
				t.Fatal(err)
			}
			waitIndexerWorker(t, service)
			if found, err := blocks.Has(1); err != nil || found {
				t.Fatalf("partial block was indexed: %v", err)
			}
		})
	}
}

type failingLifecycleTxIndex struct{ txindex.TxIndexer }

func (failingLifecycleTxIndex) AddBatch(*txindex.Batch) error {
	return errors.New("injected index write failure")
}

func TestIndexerOwnedDatabaseSelfStopDoesNotJoinItself(t *testing.T) {
	bus := types.NewEventBus()
	bus.SetLogger(log.NewNopLogger())
	if err := bus.Start(); err != nil {
		t.Fatal(err)
	}
	db := dbm.NewMemDB()
	blocks := blockidxkv.New(dbm.NewPrefixDB(db, []byte("block_events")))
	service := txindex.NewIndexerService(failingLifecycleTxIndex{kv.NewTxIndex(db)}, blocks, bus, true)
	service.SetLogger(log.NewNopLogger())
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Stop(); _ = bus.Stop(); _ = db.Close() })
	if err := bus.PublishEventNewBlockEvents(types.EventDataNewBlockEvents{Height: 1}); err != nil {
		t.Fatal(err)
	}
	waitIndexerWorker(t, service)
	if service.IsRunning() {
		t.Fatal("failed indexer did not stop")
	}
}

type blockedLifecycleTxIndex struct {
	txindex.TxIndexer
	entered chan struct{}
	release chan struct{}
}

func (b blockedLifecycleTxIndex) AddBatch(batch *txindex.Batch) error {
	close(b.entered)
	<-b.release
	return b.TxIndexer.AddBatch(batch)
}

func TestIndexerOwnedDatabaseJoinWaitsForInflightWrite(t *testing.T) {
	bus := types.NewEventBus()
	bus.SetLogger(log.NewNopLogger())
	if err := bus.Start(); err != nil {
		t.Fatal(err)
	}
	db := dbm.NewMemDB()
	blocks := blockidxkv.New(dbm.NewPrefixDB(db, []byte("block_events")))
	index := blockedLifecycleTxIndex{TxIndexer: kv.NewTxIndex(db), entered: make(chan struct{}), release: make(chan struct{})}
	service := txindex.NewIndexerService(index, blocks, bus, false)
	service.SetLogger(log.NewNopLogger())
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	released := false
	t.Cleanup(func() {
		if !released {
			close(index.release)
		}
		_ = service.Stop()
		_ = bus.Stop()
		_ = db.Close()
	})
	if err := bus.PublishEventNewBlockEvents(types.EventDataNewBlockEvents{Height: 1}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-index.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("index write did not start")
	}
	if err := service.Stop(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { service.WaitForIndexing(); close(done) }()
	select {
	case <-done:
		t.Fatal("database close was permitted while its write was still active")
	case <-time.After(20 * time.Millisecond):
	}
	close(index.release)
	released = true
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("index worker did not finish after write completed")
	}
	if found, err := blocks.Has(1); err != nil || !found {
		t.Fatalf("completed block index was lost: %v", err)
	}
}
