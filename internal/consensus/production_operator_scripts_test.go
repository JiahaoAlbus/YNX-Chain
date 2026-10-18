//go:build linux

package consensus

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Execute the actual generated shell with real filesystem operations and real
// production keycheck. The ynx-comet stand-in ONLY records exec argv/environment;
// it makes no signing, constructor or network claim. Normal CLI/factory tests
// separately exercise these same public flags. No systemctl, SSH or sudo runs.
func TestProductionOperatorScriptsPreserveOriginalStateAndExecuteExactArgv(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	base := t.TempDir()
	role := &f.plan.Roles[0]
	role.Home = filepath.Join(base, "original-home")
	role.ABCIState = filepath.Join(role.Home, "data", "committed.json")
	if err := os.MkdirAll(filepath.Join(role.Home, "config"), 0700); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := NewConsensusBootstrap(f.plan.ConsensusGenesis, ConsensusBootstrapPins{f.plan.ConsensusGenesisSHA256, f.plan.OriginalGenesisHash, f.plan.MigrationStateHash}, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithBootstrap(f.migration, role.ABCIState, bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	var doc cmttypes.GenesisDoc
	if err = cmtjson.Unmarshal(f.plan.ConsensusGenesis, &doc); err != nil {
		t.Fatal(err)
	}
	registry := &validatorRegistryFixture{migration: f.migration, bootstrap: bootstrap, doc: &doc}
	if _, err = app.InitChain(context.Background(), registry.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	// InitChain alone is not a durable checkpoint. Commit a real original
	// application block before treating this as an existing operator source.
	if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: doc.InitialHeight, NextValidatorsHash: bytes.Clone(bootstrap.validatorSetHash)}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	beforeState := productionScriptRead(t, role.ABCIState)
	beforeHRS := productionScriptRead(t, role.LegacyStatePath)
	stateInfo, err := os.Stat(role.ABCIState)
	if err != nil {
		t.Fatal(err)
	}
	hrsInfo, err := os.Stat(role.LegacyStatePath)
	if err != nil {
		t.Fatal(err)
	}
	unknown := filepath.Join(role.Home, "data", "original.UNKNOWN")
	productionScriptWrite(t, unknown, []byte("original uncertain write retained\n"), 0600)
	raw, pin := productionOperatorPlanBytes(t, f.plan)
	root := filepath.Join(base, "package")
	if _, err = GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, raw, pin); err != nil {
		t.Fatal(err)
	}
	roleRoot := filepath.Join(root, "roles", role.Role)
	for _, name := range []string{"config.toml", "genesis.json"} {
		productionScriptWrite(t, filepath.Join(role.Home, "config", name), productionScriptRead(t, filepath.Join(roleRoot, "config", name)), 0600)
	}
	candidate := filepath.Join(base, "host", "var", "lib", "ynx-chain", "consensus-candidate")
	systemd := filepath.Join(base, "host", "etc", "systemd", "system")
	commands := filepath.Join(base, "commands")
	trace := filepath.Join(base, "keycheck.log")
	argvFile := filepath.Join(base, "exec.argv")
	binaryDir := filepath.Join(root, "roles", "bin")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	realInstall, err := exec.LookPath("install")
	if err != nil {
		t.Fatal(err)
	}
	productionScriptWrite(t, filepath.Join(commands, "id"), []byte("#!/bin/sh\ntest \"$1\" = -u && echo 0\n"), 0700)
	productionScriptWrite(t, filepath.Join(commands, "install"), []byte("#!/usr/bin/env bash\nset -euo pipefail\nargs=(); while test \"$#\" -gt 0; do case \"$1\" in -o|-g) shift 2;; *) args+=(\"$1\"); shift;; esac; done\nexec '"+realInstall+"' \"${args[@]}\"\n"), 0700)
	productionScriptWrite(t, filepath.Join(binaryDir, "ynx-consensus-keycheck"), []byte("#!/usr/bin/env bash\nexec \"$YNX_SCRIPT_TEST_BINARY\" -test.run=^TestProductionOperatorKeyCheckHelper$ -- \"$@\"\n"), 0700)
	productionScriptWrite(t, filepath.Join(binaryDir, "ynx-comet"), []byte("#!/bin/sh\nset -eu\ntest -z \"${CMTHOME:-}${TMHOME:-}${CMT_HOME:-}\"\nprintf '%s\\0' \"$@\" >'"+argvFile+"'\n"), 0700)
	if err = os.MkdirAll(systemd, 0700); err != nil {
		t.Fatal(err)
	}
	replace := strings.NewReplacer("/var/lib/ynx-chain/consensus-candidate", candidate, "mkdir -p /var/lib/ynx-chain", "mkdir -p '"+filepath.Dir(candidate)+"'", "/etc/systemd/system", systemd)
	for _, name := range []string{"install-candidate.sh", "start-operator.sh", "rollback-candidate.sh", "backup-candidate.sh"} {
		path := filepath.Join(roleRoot, "scripts", name)
		productionScriptWrite(t, path, []byte(replace.Replace(string(productionScriptRead(t, path)))), 0700)
	}
	env := append(os.Environ(), "PATH="+commands+":"+os.Getenv("PATH"), "YNX_PRODUCTION_SCRIPT_HELPER=1", "YNX_SCRIPT_TEST_BINARY="+self, "YNX_TEST_TRACE="+trace, "CMTHOME=/wrong-home", "TMHOME=/wrong-home", "CMT_HOME=/wrong-home")
	run := func(script string, args ...string) ([]byte, error) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "bash", append([]string{script}, args...)...)
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		if ctx.Err() != nil {
			t.Fatal("isolated operator script timed out")
		}
		return out, err
	}
	if out, err := run(filepath.Join(roleRoot, "scripts", "install-candidate.sh")); err != nil {
		t.Fatalf("real isolated install failed: %v %s", err, out)
	}
	if _, err = os.Stat(argvFile); !os.IsNotExist(err) {
		t.Fatal("installer started operator")
	}
	launch := filepath.Join(candidate, "scripts", "start-operator.sh")
	if out, err := run(launch); err != nil {
		t.Fatalf("generated launcher failed: %v %s", err, out)
	}
	args := bytes.Split(bytes.TrimSuffix(productionScriptRead(t, argvFile), []byte{0}), []byte{0})
	want := []string{"start", "--home", role.Home, "--migration-state", candidate + "/config/bound-migration.json", "--abci-state", role.ABCIState, "--abci-state-layout", "atomic-json", "--consensus-genesis-sha256", f.plan.ConsensusGenesisSHA256, "--original-genesis-hash", f.plan.OriginalGenesisHash, "--bound-migration-state-hash", f.plan.MigrationStateHash}
	if len(args) != len(want) {
		t.Fatalf("wrong exec argc: %d", len(args))
	}
	for i, arg := range args {
		if string(arg) != want[i] {
			t.Fatalf("exec argv %d differs: %q != %q", i, arg, want[i])
		}
	}
	if out, err := run(filepath.Join(roleRoot, "scripts", "install-candidate.sh")); err == nil {
		t.Fatalf("existing candidate overwritten: %s", out)
	}
	if err = os.Remove(argvFile); err != nil {
		t.Fatal(err)
	} // Only the test's public argv observation.
	if out, err := run(launch, "unexpected"); err == nil {
		t.Fatalf("extra launcher args accepted: %s", out)
	}
	configPath := filepath.Join(role.Home, "config", "config.toml")
	originalConfig := productionScriptRead(t, configPath)
	productionScriptWrite(t, configPath, append(bytes.Clone(originalConfig), []byte("\n# unexpected original config change\n")...), 0600)
	if out, err := run(launch); err == nil {
		t.Fatalf("config drift was executed: %s", out)
	}
	productionScriptWrite(t, configPath, originalConfig, 0600)
	if _, err = os.Stat(argvFile); !os.IsNotExist(err) {
		t.Fatal("failed launch executed process")
	}
	stateAfter, err := os.Stat(role.ABCIState)
	if err != nil {
		t.Fatal(err)
	}
	hrsAfter, err := os.Stat(role.LegacyStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(beforeState, productionScriptRead(t, role.ABCIState)) || !bytes.Equal(beforeHRS, productionScriptRead(t, role.LegacyStatePath)) || !os.SameFile(stateInfo, stateAfter) || !os.SameFile(hrsInfo, hrsAfter) || stateInfo.ModTime() != stateAfter.ModTime() || hrsInfo.ModTime() != hrsAfter.ModTime() || string(productionScriptRead(t, unknown)) != "original uncertain write retained\n" {
		t.Fatal("operator scripts changed original state/HRS/UNKNOWN")
	}
}

func TestProductionOperatorKeyCheckHelper(t *testing.T) {
	if os.Getenv("YNX_PRODUCTION_SCRIPT_HELPER") != "1" {
		return
	}
	var args []string
	for i, value := range os.Args {
		if value == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	var err error
	if len(args) == 5 && args[0] == "-node-only" && args[1] == "-role-manifest" && args[3] == "-node-key" {
		err = VerifyProductionNodeKeyFile(args[2], args[4])
	} else if len(args) == 6 && args[0] == "-role-manifest" && args[2] == "-private-validator-key" && args[4] == "-node-key" {
		err = VerifyProductionKeyFiles(args[1], args[3], args[5])
	} else {
		os.Exit(91)
	}
	if err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}
