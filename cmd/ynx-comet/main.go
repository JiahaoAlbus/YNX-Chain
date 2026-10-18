package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	commands "github.com/cometbft/cometbft/cmd/cometbft/commands"
	"github.com/cometbft/cometbft/cmd/cometbft/commands/debug"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/cli"
	cmtflags "github.com/cometbft/cometbft/libs/cli/flags"
	"github.com/cometbft/cometbft/libs/log"
	nm "github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/spf13/cobra"
)

type pqOptions struct {
	migration, state, genesisHash, originalGenesisHash, migrationHash string
	schedule, scheduleHash, binding, vault                            string
	recoveryFD                                                        int
}

func (p pqOptions) enabled() bool {
	return p.migration != "" || p.state != "" || p.genesisHash != "" || p.originalGenesisHash != "" || p.migrationHash != "" || p.schedule != "" || p.scheduleHash != "" || p.binding != "" || p.vault != "" || p.recoveryFD >= 0
}

func (p pqOptions) validate() error {
	for _, value := range []string{p.migration, p.state, p.genesisHash, p.originalGenesisHash, p.migrationHash, p.schedule, p.scheduleHash, p.binding, p.vault} {
		if value == "" {
			return errors.New("PQ mode requires migration/state, all independent genesis/migration/schedule pins, public key binding and encrypted host key vault")
		}
	}
	if p.recoveryFD < 3 {
		return errors.New("PQ recovery credential requires an inherited private file descriptor >= 3")
	}
	return nil
}

func readBounded(path string, maximum int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil || int64(len(raw)) > maximum {
		return nil, errors.New("configuration exceeds its bounded size or cannot be read")
	}
	return raw, nil
}

func decodeStrict(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("configuration contains trailing data")
	}
	canonical, err := json.Marshal(target)
	if err != nil || !bytes.Equal(canonical, bytes.TrimSpace(raw)) {
		return errors.New("public operator binding must be canonical JSON without duplicate fields")
	}
	return nil
}

// readRecoveryCredential consumes exactly 32 raw bytes. Credentials are never
// command arguments, environment variables, logs or part of public bindings.
func readRecoveryCredential(fd int) ([]byte, error) {
	if fd < 3 {
		return nil, errors.New("private recovery descriptor must be >= 3")
	}
	f := os.NewFile(uintptr(fd), "pq-recovery-credential")
	if f == nil {
		return nil, errors.New("private recovery descriptor is unavailable")
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 33))
	if err != nil || len(raw) != 32 {
		clear(raw)
		return nil, errors.New("private recovery descriptor must contain exactly 32 raw bytes")
	}
	return raw, nil
}

func existingPrivateFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return errors.New("existing validator key and signing state must be private regular files; no generation or reset is allowed")
	}
	return nil
}

func constructPQNode(config *cfg.Config, logger log.Logger, options pqOptions) (*nm.Node, *ynxconsensusauth.HostSigner, error) {
	if config == nil || logger == nil {
		return nil, nil, errors.New("node configuration and logger are required")
	}
	if err := options.validate(); err != nil {
		return nil, nil, err
	}
	if config.PrivValidatorListenAddr != "" {
		return nil, nil, errors.New("explicit local PQ custody cannot be replaced with a socket signer")
	}
	// Load original identities before decrypting any new private material.
	for _, path := range []string{config.PrivValidatorKeyFile(), config.PrivValidatorStateFile(), config.NodeKeyFile()} {
		if err := existingPrivateFile(path); err != nil {
			return nil, nil, err
		}
	}
	legacy := privval.LoadFilePV(config.PrivValidatorKeyFile(), config.PrivValidatorStateFile())
	nodeKey, err := p2p.LoadNodeKey(config.NodeKeyFile())
	if err != nil {
		return nil, nil, errors.New("cannot load original P2P node identity")
	}
	rawMigration, err := os.ReadFile(options.migration)
	if err != nil {
		return nil, nil, err
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(rawMigration, &migration); err != nil {
		return nil, nil, fmt.Errorf("decode migration: %w", err)
	}
	rawGenesis, err := os.ReadFile(config.GenesisFile())
	if err != nil {
		return nil, nil, err
	}
	bootstrap, err := consensus.NewConsensusBootstrap(rawGenesis, consensus.ConsensusBootstrapPins{CometGenesisSHA256: options.genesisHash, OriginalGenesisHash: options.originalGenesisHash, MigrationStateHash: options.migrationHash}, migration)
	if err != nil {
		return nil, nil, err
	}
	rawSchedule, err := readBounded(options.schedule, 32<<10)
	if err != nil {
		return nil, nil, err
	}
	authorization, err := consensus.NewPQEngineAuthorization(rawSchedule, options.scheduleHash)
	if err != nil {
		return nil, nil, err
	}
	rawBinding, err := readBounded(options.binding, 64<<10)
	if err != nil {
		return nil, nil, err
	}
	var binding ynxconsensusauth.HostKeyBinding
	if err := decodeStrict(rawBinding, &binding); err != nil {
		return nil, nil, fmt.Errorf("decode public host key binding: %w", err)
	}
	if err := binding.Validate(); err != nil {
		return nil, nil, err
	}
	if err := existingPrivateFile(binding.SignerStatePath); err != nil {
		return nil, nil, err
	}
	app, err := consensus.NewPersistentApplicationWithEngineAuthorization(migration, options.state, bootstrap, authorization)
	if err != nil {
		return nil, nil, err
	}
	registry, err := consensus.NewPQCommittedSignerRegistry(app, bootstrap)
	if err != nil {
		return nil, nil, err
	}
	credential, err := readRecoveryCredential(options.recoveryFD)
	if err != nil {
		return nil, nil, err
	}
	defer clear(credential)
	host, err := ynxconsensusauth.ResumeHostSigner(options.vault, credential, binding, registry)
	if err != nil {
		return nil, nil, err
	}
	signer, err := host.Signer()
	if err != nil {
		return nil, nil, errors.Join(err, host.Close())
	}
	node, err := consensus.NewPQConsensusNode(config, app, legacy, signer, nodeKey, logger)
	if err != nil {
		return nil, nil, errors.Join(err, host.Close())
	}
	return node, host, nil
}

func runPQNode(command *cobra.Command, options pqOptions) (result error) {
	if err := options.validate(); err != nil {
		return err
	}
	lease, err := consensus.AcquireApplicationStateWriterLease(options.state)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, lease.Close()) }()
	config, err := commands.ParseConfig(command)
	if err != nil {
		return err
	}
	logger := log.NewTMLogger(log.NewSyncWriter(os.Stdout))
	if config.LogFormat == cfg.LogFormatJSON {
		logger = log.NewTMJSONLogger(log.NewSyncWriter(os.Stdout))
	}
	logger, err = cmtflags.ParseLogLevel(config.LogLevel, logger, cfg.DefaultLogLevel)
	if err != nil {
		return err
	}
	node, host, err := constructPQNode(config, logger, options)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, host.Close()) }()
	if err := node.Start(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(command.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case <-node.Quit():
	}
	if node.IsRunning() {
		return node.Stop()
	}
	return nil
}

func main() {
	root := commands.RootCmd
	root.AddCommand(commands.GenValidatorCmd, commands.InitFilesCmd, commands.LightCmd, commands.ReplayCmd, commands.ReplayConsoleCmd, commands.ResetAllCmd, commands.ResetPrivValidatorCmd, commands.ResetStateCmd, commands.ShowValidatorCmd, commands.TestnetFilesCmd, commands.ShowNodeIDCmd, commands.ReIndexEventCmd, commands.GenNodeKeyCmd, commands.VersionCmd, commands.RollbackStateCmd, commands.CompactGoLevelDBCmd, commands.InspectCmd, debug.DebugCmd, cli.NewCompletionCmd(root, true))
	start := commands.NewRunNodeCmd(nm.DefaultNewNode)
	legacyRun := start.RunE
	options := pqOptions{recoveryFD: -1}
	f := start.Flags()
	f.StringVar(&options.migration, "migration-state", "", "original validated key-bound migration JSON")
	f.StringVar(&options.state, "abci-state", "", "existing durable application state for the in-process PQ node")
	f.StringVar(&options.genesisHash, "consensus-genesis-sha256", "", "independent hash of the exact original Comet genesis")
	f.StringVar(&options.originalGenesisHash, "original-genesis-hash", "", "independent native genesis pin")
	f.StringVar(&options.migrationHash, "bound-migration-state-hash", "", "independent original bound migration pin")
	f.StringVar(&options.schedule, "pq-engine-schedule", "", "canonical independently authorized activation schedule")
	f.StringVar(&options.scheduleHash, "pq-engine-schedule-hash", "", "independent activation schedule hash")
	f.StringVar(&options.binding, "pq-host-key-binding", "", "canonical public expected validator key and existing HRS binding")
	f.StringVar(&options.vault, "pq-host-key-vault", "", "existing encrypted validator-specific key envelope")
	f.IntVar(&options.recoveryFD, "pq-recovery-fd", -1, "inherited private descriptor containing exactly 32 raw credential bytes")
	start.RunE = func(command *cobra.Command, args []string) error {
		if !options.enabled() {
			return legacyRun(command, args)
		}
		return runPQNode(command, options)
	}
	root.AddCommand(start)
	command := cli.PrepareBaseCmd(root, "CMT", os.ExpandEnv(filepath.Join("$HOME", cfg.DefaultTendermintDir)))
	command.SetContext(context.Background())
	if err := command.Execute(); err != nil {
		os.Exit(1)
	}
}
