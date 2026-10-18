package node

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"testing"

	dbm "github.com/cometbft/cometbft-db"
	"github.com/cometbft/cometbft/abci/example/kvstore"
	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/internal/test"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/cometbft/cometbft/proxy"
	"github.com/cometbft/cometbft/types"
)

type countedNodeDatabase struct {
	dbm.DB
	closes int
}

func (d *countedNodeDatabase) Close() error {
	d.closes++
	return d.DB.Close()
}

func nodeOwnedDatabaseConfig(t *testing.T) *cfg.Config {
	t.Helper()
	c := test.ResetTestRoot("node-owned-database")
	t.Cleanup(func() { _ = os.RemoveAll(c.RootDir) })
	c.DBBackend = "goleveldb"
	c.TxIndex.Indexer = "kv"
	c.RPC.ListenAddress = ""
	c.RPC.PprofListenAddress = ""
	c.Instrumentation.Prometheus = false
	return c
}

func nodeOwnedDatabaseConstruct(t *testing.T, c *cfg.Config, failID string) (*Node, map[string]*countedNodeDatabase, error) {
	t.Helper()
	key, err := p2p.LoadOrGenNodeKey(c.NodeKeyFile())
	if err != nil {
		t.Fatal(err)
	}
	dbs := map[string]*countedNodeDatabase{}
	provider := func(ctx *cfg.DBContext) (dbm.DB, error) {
		if ctx.ID == failID {
			return nil, errors.New("injected database-open failure")
		}
		db, err := cfg.DefaultDBProvider(ctx)
		if err != nil {
			return nil, err
		}
		counted := &countedNodeDatabase{DB: db}
		dbs[ctx.ID] = counted
		return counted, nil
	}
	n, err := NewNode(c, privval.LoadFilePV(c.PrivValidatorKeyFile(), c.PrivValidatorStateFile()), key,
		proxy.NewLocalClientCreator(kvstore.NewInMemoryApplication()), DefaultGenesisDocProviderFunc(c),
		provider, DefaultMetricsProvider(c.Instrumentation), log.NewNopLogger())
	return n, dbs, err
}

func requireNodeDatabasesClosedOnce(t *testing.T, dbs map[string]*countedNodeDatabase) {
	t.Helper()
	for id, db := range dbs {
		if db.closes != 1 {
			t.Errorf("%s underlying Close calls = %d, want exactly one", id, db.closes)
		}
	}
}

// Constructors start local proxy/indexer services, but never Node.Start or a
// listener. Exercise the actual OnStop path and original on-disk LevelDBs.
func TestNodeOwnedDatabaseSameDirectoryReopen(t *testing.T) {
	c := nodeOwnedDatabaseConfig(t)
	n, firstDBs, err := nodeOwnedDatabaseConstruct(t, c, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if n != nil {
			n.OnStop()
		}
	})
	originals := map[string][]byte{}
	for _, path := range []string{c.PrivValidatorKeyFile(), c.PrivValidatorStateFile(), c.NodeKeyFile(), c.GenesisFile()} {
		originals[path], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	tx := &abci.TxResult{Height: 1, Tx: types.Tx("original-index-record"), Result: abci.ExecTxResult{Code: 0}}
	if err := n.txIndexer.Index(tx); err != nil {
		t.Fatal(err)
	}
	if err := n.blockIndexer.Index(types.EventDataNewBlockEvents{Height: 1, NumTxs: 1}); err != nil {
		t.Fatal(err)
	}
	n.OnStop()
	n = nil
	requireNodeDatabasesClosedOnce(t, firstDBs)
	if len(firstDBs) != 4 {
		t.Fatalf("opened database identities: %v", firstDBs)
	}

	n, nextDBs, err := nodeOwnedDatabaseConstruct(t, c, "")
	if err != nil {
		t.Fatalf("same original directory reopen: %v", err)
	}
	got, err := n.txIndexer.Get(types.Tx(tx.Tx).Hash())
	if err != nil || got == nil || !bytes.Equal(got.Tx, tx.Tx) || got.Height != tx.Height {
		t.Fatalf("original transaction index was lost: %v %+v", err, got)
	}
	if found, err := n.blockIndexer.Has(1); err != nil || !found {
		t.Fatalf("original block-event index was lost: %v", err)
	}
	for path, before := range originals {
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatalf("constructor/close changed original identity or HRS at %s: %v", path, err)
		}
	}
	n.OnStop()
	n = nil
	requireNodeDatabasesClosedOnce(t, nextDBs)
}

func TestNodeOwnedDatabaseConstructorFailureReleasesAcquiredHandles(t *testing.T) {
	for _, failID := range []string{"state", "tx_index", "evidence"} {
		t.Run(failID, func(t *testing.T) {
			c := nodeOwnedDatabaseConfig(t)
			n, dbs, err := nodeOwnedDatabaseConstruct(t, c, failID)
			if err == nil || n != nil || !strings.Contains(err.Error(), "open node database "+failID+": injected database-open failure") {
				t.Fatal("injected constructor failure was accepted")
			}
			requireNodeDatabasesClosedOnce(t, dbs)
			// Reuse every original file after the error, without removing LOCK or
			// deleting/replacing the directory, database or original key state.
			n, reopened, err := nodeOwnedDatabaseConstruct(t, c, "")
			if err != nil {
				t.Fatalf("failed constructor leaked an original DB: %v", err)
			}
			n.OnStop()
			requireNodeDatabasesClosedOnce(t, reopened)
		})
	}
}

func TestNodeOwnedDatabaseSharedHandleCloseOnce(t *testing.T) {
	db := &countedNodeDatabase{DB: dbm.NewMemDB()}
	owner := &nodeOwnedDatabases{}
	handle, err := owner.provider(func(*cfg.DBContext) (dbm.DB, error) { return db, nil })(&cfg.DBContext{ID: "tx_index"})
	if err != nil {
		t.Fatal(err)
	}
	if err := handle.Close(); err != nil {
		t.Fatal(err)
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	if db.closes != 1 {
		t.Fatalf("shared database was closed %d times", db.closes)
	}
}
