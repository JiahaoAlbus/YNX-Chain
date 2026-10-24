package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestNodeStateHashEncodingReportRejectsLostEvidence(t *testing.T) {
	if err := writeStateHashEncodingStartup(shortPhaseWriter{}); !errors.Is(err, io.ErrShortWrite) {
		t.Fatal("short initialization evidence write accepted", err)
	}
	if err := writeStateHashEncodingStartup(failingPhaseWriter{}); err == nil {
		t.Fatal("failed initialization evidence write accepted")
	}
}

func TestNodeStateHashEncodingExplicitStartup(t *testing.T) {
	if root := os.Getenv("YNX_NODE_HASH_STARTUP_ROOT"); root != "" {
		// Real main/flag/application initialization, but NewServer refuses the
		// unsupported transport before any server/socket or business workload.
		flag.CommandLine = flag.NewFlagSet("ynx-abci", flag.ExitOnError)
		os.Args = []string{"ynx-abci", "-migration-state", filepath.Join(root, "migration.json"), "-state", filepath.Join(root, "state.blocks"), "-state-layout", "block-journal", "-phase-timing", "-transport", "unsupported-test-only"}
		if mode := os.Getenv("YNX_NODE_HASH_STARTUP_MODE"); mode != "omitted" {
			os.Args = append(os.Args, "-state-hash-encoding", mode)
		}
		main()
		t.Fatal("unsupported transport reached a server")
	}
	migrationBytes, err := os.ReadFile(filepath.Join("..", "..", "docs", "performance", "fixtures", "state-hash-real-1024-migration.json"))
	if err != nil {
		t.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	if err = json.Unmarshal(migrationBytes, &migration); err != nil {
		t.Fatal(err)
	}
	var baseline []byte
	for _, mode := range []string{"omitted", consensus.StateHashOriginalJSON, consensus.StateHashCachedFeeJSON, "unsupported"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "migration.json"), migrationBytes, 0o600); err != nil {
				t.Fatal(err)
			}
			command := exec.Command(os.Args[0], "-test.run=^TestNodeStateHashEncodingExplicitStartup$")
			command.Env = append(os.Environ(), "YNX_NODE_HASH_STARTUP_ROOT="+root, "YNX_NODE_HASH_STARTUP_MODE="+mode)
			output, err := command.CombinedOutput()
			var exit *exec.ExitError
			if !errors.As(err, &exit) || exit.ExitCode() != 1 {
				t.Fatalf("unexpected real main exit: %v %s", err, output)
			}
			if mode == "unsupported" {
				if !bytes.Contains(output, []byte("unsupported state hash encoding")) || bytes.Contains(output, []byte("YNX_ABCI_HASH_ENCODING ")) {
					t.Fatalf("unsupported selection was promoted: %s", output)
				}
				if _, err := os.Stat(filepath.Join(root, "state.blocks")); !os.IsNotExist(err) {
					t.Fatal("unsupported encoding created durable state", err)
				}
				return
			}
			if !bytes.Contains(output, []byte("create ABCI server")) {
				t.Fatalf("startup failed before real application initialization: %s", output)
			}
			var records []struct {
				Schema         int    `json:"schema"`
				Mode           string `json:"mode"`
				CachedAttempts uint64 `json:"cachedAttempts"`
				CachedErrors   uint64 `json:"cachedErrors"`
			}
			for _, line := range strings.Split(string(output), "\n") {
				if !strings.HasPrefix(line, "YNX_ABCI_HASH_ENCODING ") {
					continue
				}
				var record struct {
					Schema         int    `json:"schema"`
					Mode           string `json:"mode"`
					CachedAttempts uint64 `json:"cachedAttempts"`
					CachedErrors   uint64 `json:"cachedErrors"`
				}
				if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "YNX_ABCI_HASH_ENCODING ")), &record); err != nil {
					t.Fatal(err)
				}
				records = append(records, record)
			}
			want := mode
			if mode == "omitted" {
				want = consensus.StateHashOriginalJSON
			}
			if len(records) != 1 || records[0].Schema != 1 || records[0].Mode != want || records[0].CachedErrors != 0 {
				t.Fatalf("missing actual process encoding proof: %s", output)
			}
			// Initial migration creation does not hash a committed-state
			// document. Do not manufacture executed-work proof from selection.
			if records[0].CachedAttempts != 0 {
				t.Fatalf("initialization unexpectedly claims cached work: %+v", records[0])
			}
			state, err := os.ReadFile(filepath.Join(root, "state.blocks"))
			if err != nil {
				t.Fatal(err)
			}
			if mode == "omitted" {
				baseline = state
			} else if !bytes.Equal(baseline, state) {
				t.Fatal("selected node initialization changed durable bytes")
			}
			if _, err = consensus.NewBlockJournaledApplication(migration, filepath.Join(root, "state.blocks")); err != nil {
				t.Fatal("original parent decoder rejected selected node state", err)
			}
			t.Logf("actual startup selection: %+v; durableBytes=%d; serverStarted=false", records[0], len(state))
		})
	}
}

func TestNodeStateHashEncodingSelectedApplication(t *testing.T) {
	if root := os.Getenv("YNX_NODE_HASH_APPLICATION_ROOT"); root != "" {
		mode := os.Getenv("YNX_NODE_HASH_APPLICATION_MODE")
		file := filepath.Join(root, "state.blocks")
		err := runWithDiagnosticsAndEncoding("tcp://127.0.0.1:0", "unsupported-test-only", filepath.Join(root, "migration.json"), file, "block-journal", true, mode)
		if err == nil || !strings.Contains(err.Error(), "create ABCI server") {
			t.Fatal("node selection/init path failed", err)
		}
		raw, err := os.ReadFile(filepath.Join(root, "migration.json"))
		if err != nil {
			t.Fatal(err)
		}
		var migration chain.ConsensusMigrationState
		if err = json.Unmarshal(raw, &migration); err != nil {
			t.Fatal(err)
		}
		app, err := consensus.NewBlockJournaledApplication(migration, file)
		if err != nil {
			t.Fatal(err)
		}
		_, before, _ := consensus.StateHashEncodingMeasurements()
		recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes([]byte{32}).PubKey().SerializeCompressed())
		if err != nil {
			t.Fatal(err)
		}
		tx, err := consensus.NewSignedTransfer(secp256k1.PrivKeyFromBytes([]byte{31}), 6423, recipient, 1, 1)
		if err != nil {
			t.Fatal(err)
		}
		envelope, err := consensus.EncodeSignedTransaction(tx)
		if err != nil {
			t.Fatal(err)
		}
		ctx := context.Background()
		check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: envelope})
		if err != nil || check.Code != 0 {
			t.Fatal("real signature admission", err)
		}
		height := int64(migration.Height) + 1
		result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{envelope}})
		if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
			t.Fatal("real signed state execution", err)
		}
		if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		replay, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: envelope})
		if err != nil || replay.Code != consensus.CodeInvalidNonce {
			t.Fatal("nonce replay accepted", err)
		}
		selected, after, failures := consensus.StateHashEncodingMeasurements()
		if selected != mode || failures != 0 || (after > before) != (mode == consensus.StateHashCachedFeeJSON) {
			t.Fatal("node-selected runtime encoder was not used", selected, before, after, failures)
		}
		if _, err = consensus.NewBlockJournaledApplication(migration, file); err != nil {
			t.Fatal("selected recovery", err)
		}
		t.Logf("actual selected node-process application: mode=%s cachedBefore=%d cachedAfter=%d failures=%d signedTransfers=1 replayRejected=true serverStarted=false", selected, before, after, failures)
		return
	}
	key := secp256k1.PrivKeyFromBytes([]byte{31})
	sender, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err = devnet.Faucet(sender, 10000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(migration)
	if err != nil {
		t.Fatal(err)
	}
	var baseline []byte
	for _, mode := range []string{consensus.StateHashOriginalJSON, consensus.StateHashCachedFeeJSON} {
		root := t.TempDir()
		if err = os.WriteFile(filepath.Join(root, "migration.json"), raw, 0o600); err != nil {
			t.Fatal(err)
		}
		command := exec.Command(os.Args[0], "-test.run=^TestNodeStateHashEncodingSelectedApplication$", "-test.v")
		command.Env = append(os.Environ(), "YNX_NODE_HASH_APPLICATION_ROOT="+root, "YNX_NODE_HASH_APPLICATION_MODE="+mode)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("actual selected application: %v %s", err, output)
		}
		t.Logf("%s", output)
		state, err := os.ReadFile(filepath.Join(root, "state.blocks"))
		if err != nil {
			t.Fatal(err)
		}
		if baseline == nil {
			baseline = state
		} else if !bytes.Equal(baseline, state) {
			t.Fatal("node-selected signed execution changed exact durable bytes")
		}
		if _, err = consensus.NewBlockJournaledApplication(migration, filepath.Join(root, "state.blocks")); err != nil {
			t.Fatal("original parent decoder recovery", err)
		}
	}
}
