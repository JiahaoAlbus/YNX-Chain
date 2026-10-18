package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/cobra"
)

func executeOperatorInspection(args []string) ([]byte, error) {
	var output bytes.Buffer
	root := &cobra.Command{Use: "ynx-comet", SilenceErrors: true, SilenceUsage: true, PersistentPreRunE: func(*cobra.Command, []string) error {
		return errors.New("checkpoint inspector entered Comet runtime configuration/home creation")
	}}
	root.AddCommand(newInspectOperatorCheckpointCommand())
	root.SetArgs(args)
	root.SetOut(&output)
	root.SetErr(&output)
	err := root.Execute()
	return output.Bytes(), err
}

func TestInspectOperatorCheckpointNormalCommandReadsActualStoppedStore(t *testing.T) {
	f := newCometJournalFixture(t)
	config, options := bootstrapStartupFixture(t, f, "atomic-json")
	originals := bootstrapOriginalBytes(t, config, options)
	appLease, err := consensus.AcquireApplicationStateWriterLease(options.state)
	if err != nil {
		t.Fatal(err)
	}
	defer appLease.Close()
	signingLease, err := consensus.AcquireApplicationStateWriterLease(config.PrivValidatorStateFile())
	if err != nil {
		t.Fatal(err)
	}
	defer signingLease.Close()
	n, custody, err := constructBootstrapNode(config, log.NewNopLogger(), options)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	defer func() {
		if !closed {
			n.OnStop()
			_ = n.ProxyApp().Stop()
			_ = custody.Close()
		}
	}()
	if n.IsRunning() {
		t.Fatal("fixture unexpectedly started consensus")
	}
	environment, err := n.ConfigureRPC()
	if err != nil {
		t.Fatal(err)
	}
	state, err := environment.StateStore.Load()
	if err != nil {
		t.Fatal(err)
	}
	block, err := state.MakeBlock(state.InitialHeight, nil, &cmttypes.Commit{}, nil, state.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	commit := &cmttypes.Commit{Height: block.Height, BlockID: id}
	for i, member := range state.Validators.Validators {
		vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: block.Height, BlockID: id, Timestamp: block.Time.Add(time.Second), ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(i)}
		for j := range f.migration.Validators {
			key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(j + 81)}, ed25519.SeedSize))
			if bytes.Equal(key.Public().(ed25519.PublicKey), member.PubKey.Bytes()) {
				vote.Signature = ed25519.Sign(key, cmttypes.VoteSignBytes(f.doc.ChainID, vote.ToProto()))
			}
			clear(key)
		}
		if err := vote.Verify(f.doc.ChainID, member.PubKey); err != nil {
			t.Fatal(err)
		}
		commit.Signatures = append(commit.Signatures, vote.CommitSig())
	}
	n.BlockStore().SaveBlock(block, parts, commit)
	executor := sm.NewBlockExecutor(environment.StateStore, log.NewNopLogger(), n.ProxyApp().Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, n.BlockStore())
	actual, err := executor.ApplyBlock(state, id, block)
	if err != nil {
		t.Fatal(err)
	}
	n.OnStop()
	_ = n.ProxyApp().Stop()
	_ = custody.Close()
	closed = true
	if err := appLease.Close(); err != nil {
		t.Fatal(err)
	}
	if err := signingLease.Close(); err != nil {
		t.Fatal(err)
	}
	args := []string{"inspect-operator-checkpoint", "--consensus-genesis", config.GenesisFile(), "--migration-state", options.migration, "--abci-state", options.state, "--abci-state-layout", "atomic-json", "--comet-data-dir", config.DBDir(), "--signing-state", config.PrivValidatorStateFile(), "--consensus-genesis-sha256", options.genesisHash, "--original-genesis-hash", options.originalGenesisHash, "--bound-migration-state-hash", options.migrationHash}
	stateBefore, err := os.ReadFile(options.state)
	if err != nil {
		t.Fatal(err)
	}
	output, err := executeOperatorInspection(args)
	if err != nil {
		t.Fatal("normal stopped DB command failed", string(output), err)
	}
	var result consensus.OperatorCheckpointResult
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatal(err)
	}
	if result.Version != consensus.OperatorCheckpointVersion || result.Height != actual.LastBlockHeight || result.AppVersion != consensus.ApplicationVersion || !result.EngineCheckpointVerified || !result.SigningWriterExcluded || result.RegistryEventCount != 0 || result.CommittedScheduleHash != nil || result.PQActivationVerified {
		t.Fatal("normal inspector invented or lost actual engine state", result)
	}
	stateAfter, err := os.ReadFile(options.state)
	if err != nil || !bytes.Equal(stateBefore, stateAfter) {
		t.Fatal("normal inspection changed original app state", err)
	}
	assertBootstrapOriginalBytes(t, originals)
	for _, kind := range []string{"duplicate-height-source", "unknown-RPC", "partial-next-schedule", "missing-signing-state", "symlink-genesis"} {
		t.Run(kind, func(t *testing.T) {
			negative := append([]string(nil), args...)
			switch kind {
			case "duplicate-height-source":
				negative = append(negative, "--comet-data-dir", config.DBDir())
			case "unknown-RPC":
				negative = append(negative, "--rpc", "http://untrusted.invalid")
			case "partial-next-schedule":
				negative = append(negative, "--next-pq-engine-schedule-hash", options.genesisHash)
			case "missing-signing-state":
				negative = append(negative[:11], negative[13:]...)
			case "symlink-genesis":
				alias := filepath.Join(t.TempDir(), "genesis")
				if err := os.Symlink(config.GenesisFile(), alias); err != nil {
					t.Fatal(err)
				}
				negative[2] = alias
			}
			if output, err := executeOperatorInspection(negative); err == nil {
				t.Fatal("untrusted checkpoint input accepted", kind, string(output))
			}
			assertBootstrapOriginalBytes(t, originals)
		})
	}
}
