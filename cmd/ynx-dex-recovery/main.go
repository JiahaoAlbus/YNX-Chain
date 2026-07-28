package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/dex"
)

func main() {
	if err := run(os.Args[1:], os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type commandOptions struct {
	statePath      string
	cursorPath     string
	bundleDir      string
	restoredState  string
	restoredCursor string
	sourceCommit   string
	factory        string
	stableFactory  string
	strategyVault  string
	fairFlow       string
	lpProtection   string
	startBlock     uint64
}

func run(args []string, getenv func(string) string, output io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: ynx-dex-recovery <backup|verify|restore|drill> [flags]")
	}
	command := args[0]
	if command != "backup" && command != "verify" && command != "restore" && command != "drill" {
		return fmt.Errorf("unsupported recovery command %q", command)
	}
	options, err := parseOptions(command, args[1:])
	if err != nil {
		return err
	}
	stateKey, cursorKey, bundleKey, err := loadKeys(getenv)
	if err != nil {
		return err
	}
	bindings := dex.RecoveryBindings{
		Factory:       options.factory,
		StableFactory: options.stableFactory,
		StrategyVault: options.strategyVault,
		FairFlow:      options.fairFlow,
		LPProtection:  options.lpProtection,
		StartBlock:    options.startBlock,
	}
	return execute(command, options, bindings, stateKey, cursorKey, bundleKey, output)
}

func parseOptions(command string, args []string) (commandOptions, error) {
	options := commandOptions{}
	set := flag.NewFlagSet("ynx-dex-recovery "+command, flag.ContinueOnError)
	set.SetOutput(io.Discard)
	set.StringVar(&options.statePath, "state", "", "private DEX state file")
	set.StringVar(&options.cursorPath, "cursor", "", "private EVM cursor file")
	set.StringVar(&options.bundleDir, "bundle", "", "new or existing recovery bundle directory")
	set.StringVar(&options.restoredState, "restored-state", "", "restore destination for DEX state")
	set.StringVar(&options.restoredCursor, "restored-cursor", "", "restore destination for EVM cursor")
	set.StringVar(&options.sourceCommit, "source-commit", "", "exact lowercase Git source commit")
	set.StringVar(&options.factory, "factory", "", "canonical CPMM Factory address")
	set.StringVar(&options.stableFactory, "stable-factory", "", "optional Stable Factory address")
	set.StringVar(&options.strategyVault, "strategy-vault", "", "optional Strategy Vault address")
	set.StringVar(&options.fairFlow, "fairflow", "", "optional FairFlow address")
	set.StringVar(&options.lpProtection, "lp-protection", "", "optional LP Protection address")
	set.Uint64Var(&options.startBlock, "start-block", 0, "positive deployment start block")
	if err := set.Parse(args); err != nil {
		return commandOptions{}, err
	}
	if set.NArg() != 0 {
		return commandOptions{}, errors.New("unexpected positional recovery arguments")
	}
	if strings.TrimSpace(options.bundleDir) == "" || strings.TrimSpace(options.sourceCommit) == "" || strings.TrimSpace(options.factory) == "" || options.startBlock == 0 {
		return commandOptions{}, errors.New("--bundle, --source-commit, --factory and --start-block are required")
	}
	if command == "backup" || command == "drill" {
		if strings.TrimSpace(options.statePath) == "" || strings.TrimSpace(options.cursorPath) == "" {
			return commandOptions{}, errors.New("--state and --cursor are required for backup and drill")
		}
	}
	if command == "restore" || command == "drill" {
		if strings.TrimSpace(options.restoredState) == "" || strings.TrimSpace(options.restoredCursor) == "" {
			return commandOptions{}, errors.New("--restored-state and --restored-cursor are required for restore and drill")
		}
	}
	return options, nil
}

func loadKeys(getenv func(string) string) ([]byte, []byte, []byte, error) {
	stateKey, err := decodeKey("YNX_DEX_STATE_HMAC_SECRET", getenv("YNX_DEX_STATE_HMAC_SECRET"))
	if err != nil {
		return nil, nil, nil, err
	}
	cursorValue := strings.TrimSpace(getenv("YNX_DEX_CURSOR_HMAC_SECRET"))
	if cursorValue == "" {
		cursorValue = strings.TrimSpace(getenv("YNX_DEX_STATE_HMAC_SECRET"))
	}
	cursorKey, err := decodeKey("YNX_DEX_CURSOR_HMAC_SECRET", cursorValue)
	if err != nil {
		return nil, nil, nil, err
	}
	bundleKey, err := decodeKey("YNX_DEX_RECOVERY_HMAC_SECRET", getenv("YNX_DEX_RECOVERY_HMAC_SECRET"))
	if err != nil {
		return nil, nil, nil, err
	}
	return stateKey, cursorKey, bundleKey, nil
}

func decodeKey(name, value string) ([]byte, error) {
	decoded, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil || len(decoded) < 32 {
		return nil, fmt.Errorf("%s must be unpadded base64 for at least 32 bytes", name)
	}
	return decoded, nil
}

func bundleConfig(options commandOptions, bindings dex.RecoveryBindings, stateKey, cursorKey, bundleKey []byte) dex.RecoveryBundleConfig {
	return dex.RecoveryBundleConfig{
		StatePath:    options.statePath,
		CursorPath:   options.cursorPath,
		BundleDir:    options.bundleDir,
		StateSecret:  stateKey,
		CursorSecret: cursorKey,
		BundleSecret: bundleKey,
		SourceCommit: options.sourceCommit,
		Bindings:     bindings,
	}
}

func restoreConfig(options commandOptions, bindings dex.RecoveryBindings, stateKey, cursorKey, bundleKey []byte) dex.RecoveryRestoreConfig {
	return dex.RecoveryRestoreConfig{
		BundleDir:    options.bundleDir,
		StatePath:    options.restoredState,
		CursorPath:   options.restoredCursor,
		StateSecret:  stateKey,
		CursorSecret: cursorKey,
		BundleSecret: bundleKey,
		SourceCommit: options.sourceCommit,
		Bindings:     bindings,
	}
}

func execute(command string, options commandOptions, bindings dex.RecoveryBindings, stateKey, cursorKey, bundleKey []byte, output io.Writer) error {
	bundle := bundleConfig(options, bindings, stateKey, cursorKey, bundleKey)
	restore := restoreConfig(options, bindings, stateKey, cursorKey, bundleKey)
	var result any
	var err error
	switch command {
	case "backup":
		result, err = dex.CreateRecoveryBundle(bundle)
	case "verify":
		result, err = dex.VerifyRecoveryBundle(restore)
	case "restore":
		result, err = dex.RestoreRecoveryBundle(restore)
	case "drill":
		result, err = dex.RunRecoveryDrill(dex.RecoveryDrillConfig{Bundle: bundle, Restore: restore})
	default:
		return fmt.Errorf("unsupported recovery command %q", command)
	}
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}
