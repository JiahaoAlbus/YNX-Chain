package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func initialGenesisCLIInputs(t *testing.T) ([]string, map[string][]byte, chain.ConsensusMigrationState) {
	t.Helper()
	validators, err := chain.NormalizeValidators([]chain.Validator{{Address: "ynx_validator_initial_cli", Moniker: "synthetic-initial-cli", VotingPower: 1, Active: true}})
	if err != nil {
		t.Fatal("invalid synthetic original validator fixture", err)
	}
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Validators) != 1 || m.Validators[0].Address != validators[0].Address {
		t.Fatal("synthetic original validator was replaced by constructor defaults")
	}
	key := ed25519.GenPrivKeyFromSecret([]byte("synthetic initial CLI validator only"))
	m, err = m.BindConsensusValidatorKeys([]chain.ConsensusValidatorKeyBinding{{ValidatorAddress: "ynx_validator_initial_cli", KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(key.PubKey().Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(key.PubKey().Address()))}})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(m, time.Date(2026, 10, 25, 1, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	genesis, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	pq, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	pq.Destroy()
	config, err := json.Marshal(consensus.PQInitialAccountConfiguration{Version: consensus.PQInitialAccountsVersion, NetworkID: m.OriginalGenesisHash, EnableAt: "2", BirthFee: "0", Accounts: []consensus.PQInitialAccountBinding{{Owner: "0x" + strings.Repeat("8", 40), PKA: hex.EncodeToString(pub.PKA), PKB: hex.EncodeToString(pub.PKB)}}})
	if err != nil {
		t.Fatal(err)
	}
	root := canonicalPackageTempDir(t)
	inputs := map[string][]byte{filepath.Join(root, "original-genesis.json"): genesis, filepath.Join(root, "migration.json"): migration, filepath.Join(root, "initial-accounts.json"): config}
	for path, raw := range inputs {
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	args := []string{"-prepare-pq-initial-genesis", filepath.Join(root, "original-genesis.json"), "-genesis-sha256", operatorFixtureHash(genesis), "-migration-state", filepath.Join(root, "migration.json"), "-migration-file-sha256", operatorFixtureHash(migration), "-initial-accounts", filepath.Join(root, "initial-accounts.json"), "-initial-accounts-sha256", operatorFixtureHash(config), "-initial-genesis-output", filepath.Join(root, "candidate-genesis.json")}
	return args, inputs, m
}

func TestPQInitialGenesisCLIProducesExclusiveCandidateWithoutChangingOriginals(t *testing.T) {
	args, inputs, migration := initialGenesisCLIInputs(t)
	var stdout, stderr bytes.Buffer
	if err := runCommand(args, &stdout, &stderr); err != nil {
		t.Fatal(err)
	}
	path := args[len(args)-1]
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(raw, inputs[args[1]]) || !bytes.Contains(raw, []byte(`"pq_initial_accounts":`)) || !strings.Contains(stdout.String(), "authorityInstalled=false runtimeStarted=false deployed=false activated=false") {
		t.Fatal("candidate omitted bindings or claimed live authority")
	}
	if _, err := consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: operatorFixtureHash(raw), OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash}, migration); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("candidate file permissions changed")
	}
	if err := runCommand(args, &stdout, &stderr); err == nil {
		t.Fatal("overwrote an existing candidate")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, raw) {
		t.Fatal("second invocation changed the original candidate")
	}
	for path, want := range inputs {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatal("preparation changed an original source")
		}
	}
}

func TestPQInitialGenesisCLIRefusesChangedInputAndMixedModes(t *testing.T) {
	args, _, _ := initialGenesisCLIInputs(t)
	for name, changed := range map[string][]string{
		"changed Genesis pin":    append(append([]string{}, args[:3]...), append([]string{strings.Repeat("f", 64)}, args[4:]...)...),
		"changed migration pin":  append(append([]string{}, args[:7]...), append([]string{strings.Repeat("f", 64)}, args[8:]...)...),
		"changed assignment pin": append(append([]string{}, args[:11]...), append([]string{strings.Repeat("f", 64)}, args[12:]...)...),
		"missing input":          args[2:],
		"verification mode":      append(append([]string{}, args...), "-verify-migration-state", args[5]),
		"deployment plan":        append(append([]string{}, args...), "-operator-plan", args[1]),
	} {
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if err := runCommand(changed, &stdout, &stderr); err == nil || stdout.Len() != 0 {
				t.Fatal("invalid input produced a candidate or successful output")
			}
			if _, err := os.Lstat(args[len(args)-1]); !os.IsNotExist(err) {
				t.Fatal("invalid input created the candidate")
			}
		})
	}
}
