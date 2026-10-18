package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cfg "github.com/cometbft/cometbft/config"
	cmtjson "github.com/cometbft/cometbft/libs/json"
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

type stoppedOperatorInspectionCommandFixture struct {
	args      []string
	actual    sm.State
	originals map[string][]byte
	config    *cfg.Config
	options   pqOptions
}

func newStoppedOperatorInspectionCommandFixture(t *testing.T, register bool) stoppedOperatorInspectionCommandFixture {
	t.Helper()
	var f *cometJournalFixture
	if register {
		f = newCometInspectionSourceWithMembers(t, 4)
	} else {
		f = newCometJournalFixture(t)
	}
	return newStoppedOperatorInspectionCommandFixtureWithSource(t, f, register)
}

// The shared journal fixture intentionally uses the native default membership
// (one member). A public activation proposal needs a real four-member export,
// new genesis identity, original-key bindings and proofs for that same source.
func newCometInspectionSourceWithMembers(t *testing.T, count int) *cometJournalFixture {
	t.Helper()
	if count != 3 && count != 4 {
		t.Fatal("inspection source requires its explicit three- or four-member control")
	}
	f := newCometJournalFixture(t)
	validators := []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "ynx-primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "ynx-seoul", VotingPower: 1, Active: true},
		{Address: "ynx_validator_silicon_valley", Moniker: "ynx-silicon-valley", VotingPower: 1, Active: true},
		{Address: "ynx_validator_singapore", Moniker: "ynx-singapore", VotingPower: 1, Active: true},
	}
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators[:count])
	if _, err := d.Faucet(f.owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	legacy := make(map[string]ed25519.PrivateKey)
	defer func() {
		for _, key := range legacy {
			clear(key)
		}
	}()
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 81)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		legacy[string(address[:20])] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	f.migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	f.doc, err = consensus.BuildCometGenesis(f.migration, f.doc.GenesisTime)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	genesis := sha256.Sum256(raw)
	f.bootstrap, err = consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(genesis[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	if len(f.migration.Validators) != count || len(f.doc.Validators) != count {
		t.Fatal("explicit native membership did not survive the original export and key binding")
	}
	f.wires = nil
	for _, member := range f.doc.Validators {
		candidate, pka, pkb, err := ynxconsensusauth.GenerateCandidateKey()
		if err != nil {
			t.Fatal(err)
		}
		intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(genesis[:]), ChainID: f.doc.ChainID, ValidatorAddress: bytes.Clone(member.Address), Sequence: 1, Epoch: 1, ApprovedAt: f.doc.InitialHeight, EffectiveAt: f.doc.InitialHeight + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.PubKey.Bytes()), MLDSA87PublicKey: pka, SLHDSASHA2256fPublicKey: pkb}
		a, b, err := candidate.RegistrationPossession(intent)
		candidate.Destroy()
		if err != nil {
			t.Fatal(err)
		}
		message, err := intent.AuthoritySigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(legacy[string(member.Address)], message), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		tx, err := consensus.EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		f.wires = append(f.wires, tx)
	}
	return f
}

func newStoppedOperatorInspectionCommandFixtureWithSource(t *testing.T, f *cometJournalFixture, register bool) stoppedOperatorInspectionCommandFixture {
	t.Helper()
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
	var txs cmttypes.Txs
	if register {
		for _, wire := range f.wires {
			txs = append(txs, wire)
		}
	}
	block, err := state.MakeBlock(state.InitialHeight, txs, &cmttypes.Commit{}, nil, state.Validators.GetProposer().Address)
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
	return stoppedOperatorInspectionCommandFixture{args: args, actual: actual, originals: originals, config: config, options: options}
}

func TestInspectOperatorCheckpointNormalCommandReadsActualStoppedStore(t *testing.T) {
	f := newStoppedOperatorInspectionCommandFixture(t, false)
	config, options, args, actual, originals := f.config, f.options, f.args, f.actual, f.originals
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

func TestInspectOperatorCheckpointNormalCommandProposesCanonicalSchedule(t *testing.T) {
	f := newStoppedOperatorInspectionCommandFixture(t, true)
	stateBefore, err := os.ReadFile(f.options.state)
	if err != nil {
		t.Fatal(err)
	}
	height := f.actual.LastBlockHeight + 6
	args := append(append([]string(nil), f.args...), "--propose-pq-activation-height", strconv.FormatInt(height, 10))
	output, err := executeOperatorInspection(args)
	if err != nil {
		t.Fatal("normal actual-DB proposal failed", string(output), err)
	}
	var result consensus.OperatorCheckpointResult
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatal(err)
	}
	if result.ScheduleCandidate == nil || result.Height != f.actual.LastBlockHeight || result.RegistryEventCount != 4 || result.CommittedScheduleHash != nil || result.NextScheduleHash != nil || !result.EngineCheckpointVerified || !result.WriterExcluded || !result.SigningWriterExcluded || result.PQActivationVerified {
		t.Fatal("normal command lost the actual stopped checkpoint", result)
	}
	candidate := result.ScheduleCandidate
	raw, err := base64.StdEncoding.Strict().DecodeString(candidate.CanonicalScheduleBase64)
	if err != nil {
		t.Fatal(err)
	}
	var schedule consensus.PQEngineSchedule
	if err := json.Unmarshal(raw, &schedule); err != nil {
		t.Fatal(err)
	}
	canonical, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if candidate.Version != "YNX-PQ-ENGINE-SCHEDULE-CANDIDATE/v1" || !bytes.Equal(raw, canonical) || candidate.ScheduleHash != hash || candidate.CanonicalScheduleSHA256 != hex.EncodeToString(digest[:]) || !candidate.CandidateOnly || candidate.AuthorizationGranted || schedule.RegistryHeight != result.Height || schedule.RegistryRoot != result.RegistryRoot || schedule.RegistryEventCount != 4 || schedule.ChainID != result.ChainID || hex.EncodeToString(schedule.GenesisID) != result.ConsensusGenesisSHA256 || schedule.AuthorizedAt != result.Height+1 || schedule.ParamsUpdateHeight != result.Height+1 || schedule.ValidatorUpdateHeight != height-2 || schedule.ActivationHeight != height {
		t.Fatal("normal command invented or authorized the canonical schedule", result, schedule)
	}
	plain, err := executeOperatorInspection(f.args)
	if err != nil || bytes.Contains(plain, []byte("scheduleCandidate")) {
		t.Fatal("optional proposal changed default v1 output", string(plain), err)
	}
	for _, bad := range []string{"0", "-1", "+" + strconv.FormatInt(height, 10), "0" + strconv.FormatInt(height, 10), "9223372036854775808", "9223372036854775807", "9223372036854775806", strconv.FormatInt(result.Height+3, 10)} {
		t.Run(bad, func(t *testing.T) {
			negative := append(append([]string(nil), f.args...), "--propose-pq-activation-height", bad)
			if output, err := executeOperatorInspection(negative); err == nil || len(output) != 0 {
				t.Fatal("unsafe proposal flag accepted or emitted a success result", bad, string(output), err)
			}
		})
	}
	duplicate := append(append([]string(nil), args...), "--propose-pq-activation-height", strconv.FormatInt(height, 10))
	if output, err := executeOperatorInspection(duplicate); err == nil || bytes.Contains(output, []byte("scheduleCandidate")) {
		t.Fatal("duplicate proposal accepted", string(output), err)
	}
	stateAfter, err := os.ReadFile(f.options.state)
	if err != nil || !bytes.Equal(stateBefore, stateAfter) {
		t.Fatal("normal proposal wrote original state", err)
	}
	assertBootstrapOriginalBytes(t, f.originals)
}

func TestInspectOperatorCheckpointNormalCommandRejectsThreeOriginalMembers(t *testing.T) {
	f := newStoppedOperatorInspectionCommandFixtureWithSource(t, newCometInspectionSourceWithMembers(t, 3), true)
	plain, err := executeOperatorInspection(f.args)
	if err != nil {
		t.Fatal("actual three-member source inspection failed before proposal control", string(plain), err)
	}
	var result consensus.OperatorCheckpointResult
	if err := json.Unmarshal(plain, &result); err != nil || result.RegistryEventCount != 3 || !result.EngineCheckpointVerified {
		t.Fatal("negative control did not commit three actual registrations", result, err)
	}
	stateBefore, err := os.ReadFile(f.options.state)
	if err != nil {
		t.Fatal(err)
	}
	args := append(append([]string(nil), f.args...), "--propose-pq-activation-height", strconv.FormatInt(f.actual.LastBlockHeight+4, 10))
	if output, err := executeOperatorInspection(args); err == nil || len(output) != 0 {
		t.Fatal("three original members were accepted as a four-member public activation source", string(output), err)
	}
	stateAfter, err := os.ReadFile(f.options.state)
	if err != nil || !bytes.Equal(stateBefore, stateAfter) {
		t.Fatal("rejected three-member proposal changed original state", err)
	}
	assertBootstrapOriginalBytes(t, f.originals)
}
