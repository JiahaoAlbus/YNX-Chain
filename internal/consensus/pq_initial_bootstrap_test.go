package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

func TestPQInitialGenesisBindingStrictIndependentSource(t *testing.T) {
	f := newPQInitialFixture(t)
	plain, err := cmtjson.Marshal(f.f.doc)
	if err != nil {
		t.Fatal(err)
	}
	plainHash := sha256.Sum256(plain)
	plainPins := f.f.pins
	plainPins.CometGenesisSHA256 = hex.EncodeToString(plainHash[:])
	legacy, err := NewConsensusBootstrap(plain, plainPins, f.f.migration)
	if err != nil || legacy.record.PQInitialAccounts != nil {
		t.Fatal("ordinary Genesis without explicit new bindings changed behavior", err)
	}
	if _, err := legacy.initialAccountRegistration(f.owner, 2); err == nil {
		t.Fatal("ordinary bootstrap derived authority from a submitted public pair")
	}
	withoutAssignment, err := NewPersistentApplicationWithBootstrap(f.f.migration, "", legacy)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodePQInitialRegistrationTransaction(f.registration)
	if err != nil {
		t.Fatal(err)
	}
	check, err := withoutAssignment.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: payload})
	if err != nil || check.Code == 0 || len(withoutAssignment.committed.AccountPolicy.Records) != 0 {
		t.Fatal("actual ABCI caller accepted a self-submitted pair without the Genesis assignment", check, err)
	}
	if _, err := NewConsensusBootstrap(f.f.raw, plainPins, f.f.migration); err == nil {
		t.Fatal("new bindings bypassed independent exact raw Genesis pin")
	}
	if _, err := EncodePQInitialAccountGenesis(f.f.raw, f.f.migration, f.configuration); err == nil {
		t.Fatal("Genesis candidate encoder overwrote existing assignments")
	}
	for name, change := range map[string]func(*PQInitialAccountConfiguration){
		"version":       func(c *PQInitialAccountConfiguration) { c.Version += "-alias" },
		"network":       func(c *PQInitialAccountConfiguration) { c.NetworkID = strings.Repeat("1", 64) },
		"enable height": func(c *PQInitialAccountConfiguration) { c.EnableAt = "3" },
		"leading zero":  func(c *PQInitialAccountConfiguration) { c.EnableAt = "02" },
		"birth fee":     func(c *PQInitialAccountConfiguration) { c.BirthFee = "1" },
		"empty":         func(c *PQInitialAccountConfiguration) { c.Accounts = []PQInitialAccountBinding{} },
		"original owner": func(c *PQInitialAccountConfiguration) {
			c.Accounts[0].Owner = f.donor
		},
		"duplicate owner": func(c *PQInitialAccountConfiguration) {
			c.Accounts = append(c.Accounts, c.Accounts[0])
		},
		"address alias": func(c *PQInitialAccountConfiguration) { c.Accounts[0].Owner = strings.ToUpper(f.owner) },
		"short key A":   func(c *PQInitialAccountConfiguration) { c.Accounts[0].PKA = c.Accounts[0].PKA[2:] },
		"short key B":   func(c *PQInitialAccountConfiguration) { c.Accounts[0].PKB = c.Accounts[0].PKB[2:] },
		"key alias":     func(c *PQInitialAccountConfiguration) { c.Accounts[0].PKA = strings.ToUpper(c.Accounts[0].PKA) },
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(f.configuration)
			var configuration PQInitialAccountConfiguration
			if err := json.Unmarshal(raw, &configuration); err != nil {
				t.Fatal(err)
			}
			change(&configuration)
			if _, err := EncodePQInitialAccountGenesis(plain, f.f.migration, configuration); err == nil {
				t.Fatal("candidate encoder accepted an invalid or occupied assignment")
			}
			// Deliberately repin each invalid public configuration so the normal
			// consumer must reject semantics, not only an earlier hash mismatch.
			var document map[string]json.RawMessage
			if err := json.Unmarshal(plain, &document); err != nil {
				t.Fatal(err)
			}
			document[PQInitialAccountsGenesisField], _ = json.Marshal(configuration)
			bad, _ := json.Marshal(document)
			pins := f.f.pins
			hash := sha256.Sum256(bad)
			pins.CometGenesisSHA256 = hex.EncodeToString(hash[:])
			if _, err := NewConsensusBootstrap(bad, pins, f.f.migration); err == nil {
				t.Fatal("repinned invalid Genesis assignment was accepted")
			}
		})
	}
	configuration, _ := json.Marshal(f.configuration)
	for name, raw := range map[string][]byte{
		"null":      []byte("null"),
		"unknown":   append(append(bytes.Clone(configuration[:len(configuration)-1]), []byte(",\"authorityGranted\":true")...), '}'),
		"duplicate": []byte(strings.Replace(string(configuration), `"birthFee":"0"`, `"birthFee":"0","birthFee":"0"`, 1)),
	} {
		t.Run(name, func(t *testing.T) {
			var document map[string]json.RawMessage
			if err := json.Unmarshal(plain, &document); err != nil {
				t.Fatal(err)
			}
			document[PQInitialAccountsGenesisField] = raw
			bad, err := json.Marshal(document)
			if err != nil {
				t.Fatal(err)
			}
			pins := f.f.pins
			hash := sha256.Sum256(bad)
			pins.CometGenesisSHA256 = hex.EncodeToString(hash[:])
			if _, err := NewConsensusBootstrap(bad, pins, f.f.migration); err == nil {
				t.Fatal("malformed closed Genesis registration configuration accepted")
			}
		})
	}
	duplicateTop := append(append(bytes.Clone(f.f.raw[:len(f.f.raw)-1]), []byte(`,"pq_initial_accounts":`)...), configuration...)
	duplicateTop = append(duplicateTop, '}')
	pins := f.f.pins
	hash := sha256.Sum256(duplicateTop)
	pins.CometGenesisSHA256 = hex.EncodeToString(hash[:])
	if _, err := NewConsensusBootstrap(duplicateTop, pins, f.f.migration); err == nil {
		t.Fatal("duplicate Genesis account registration field accepted")
	}
	t.Run("normal node retains independently pinned original Genesis", func(t *testing.T) {
		config := cmtconfig.DefaultConfig().SetRoot(t.TempDir())
		config.TxIndex.Indexer = "null"
		config.P2P.PexReactor = false
		config.RPC.ListenAddress = ""
		config.RPC.PprofListenAddress = ""
		if err := os.MkdirAll(filepath.Dir(config.GenesisFile()), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(config.GenesisFile(), f.f.raw, 0o600); err != nil {
			t.Fatal(err)
		}
		// Match the normal command's ReadFile -> independently pinned bootstrap,
		// then the production node constructor's exact-raw Genesis hash check.
		raw, err := os.ReadFile(config.GenesisFile())
		if err != nil {
			t.Fatal(err)
		}
		bootstrap, err := NewConsensusBootstrap(raw, f.f.pins, f.f.migration)
		if err != nil {
			t.Fatal(err)
		}
		app, err := NewPersistentApplicationWithBootstrap(f.f.migration, "", bootstrap)
		if err != nil {
			t.Fatal(err)
		}
		legacy := cmted.PrivKey(bytes.Clone(f.f.legacy[string(bootstrap.record.Members[0].Address)]))
		defer clear(legacy)
		pv := privval.NewFilePV(legacy, filepath.Join(config.RootDir, "key.json"), filepath.Join(config.RootDir, "sign.json"))
		nodeKey := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
		database := func(*cmtconfig.DBContext) (dbm.DB, error) { return dbm.NewMemDB(), nil }
		n, err := newPQNodeWithDatabase(config, app, pv, nodeKey, log.NewNopLogger(), database)
		if err != nil {
			t.Fatal("normal node constructor lost raw Genesis registration bindings", err)
		}
		defer func() { n.OnStop(); _ = n.ProxyApp().Stop() }()
		if n.IsRunning() || n.BlockStore().Height() != 0 || app.bootstrap.record.PQInitialAccounts == nil {
			t.Fatal("constructor started a node or lost independently pinned account assignments")
		}
		check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: payload})
		if err != nil || check.Code != 0 {
			t.Fatal("normal loaded bootstrap could not authorize its assigned account", check, err)
		}
		retained, err := os.ReadFile(config.GenesisFile())
		if err != nil || !bytes.Equal(retained, raw) {
			t.Fatal("normal node rewrote the original Genesis through a typed document", err)
		}
		if err := os.WriteFile(config.GenesisFile(), plain, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := newPQNodeWithDatabase(config, app, pv, nodeKey, log.NewNopLogger(), database); err == nil || !strings.Contains(err.Error(), "independently pinned") {
			t.Fatal("typed round-trip without registration fields bypassed exact Genesis pin", err)
		}
	})
}
