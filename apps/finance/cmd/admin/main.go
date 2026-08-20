package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
)

const (
	restoreConfirmation = "RESTORE FINANCE STATE"
	backupKeyEnv        = "YNX_FINANCE_BACKUP_AUTH_KEY"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return usageError()
	}
	switch args[0] {
	case "backup":
		flags := flag.NewFlagSet("backup", flag.ContinueOnError)
		flags.SetOutput(stderr)
		statePath := flags.String("state", "", "path to the live Finance state file")
		outputPath := flags.String("output", "", "path for the private backup envelope")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return errors.New("backup accepts flags only")
		}
		authenticationKey, err := requiredBackupAuthenticationKey()
		if err != nil {
			return err
		}
		store, err := finance.OpenStore(*statePath)
		if err != nil {
			return err
		}
		manifest, err := store.Backup(*outputPath, authenticationKey)
		if err != nil {
			return err
		}
		return writeJSON(stdout, map[string]any{"ok": true, "operation": "backup", "path": *outputPath, "manifest": manifest})
	case "verify":
		flags := flag.NewFlagSet("verify", flag.ContinueOnError)
		flags.SetOutput(stderr)
		backupPath := flags.String("backup", "", "path to the Finance backup envelope")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return errors.New("verify accepts flags only")
		}
		authenticationKey, err := requiredBackupAuthenticationKey()
		if err != nil {
			return err
		}
		manifest, err := finance.VerifyBackup(*backupPath, authenticationKey)
		if err != nil {
			return err
		}
		return writeJSON(stdout, map[string]any{"ok": true, "operation": "verify", "path": *backupPath, "manifest": manifest})
	case "restore":
		flags := flag.NewFlagSet("restore", flag.ContinueOnError)
		flags.SetOutput(stderr)
		statePath := flags.String("state", "", "path to the live Finance state file")
		backupPath := flags.String("backup", "", "path to the verified Finance backup envelope")
		confirmation := flags.String("confirm", "", "exact destructive-operation confirmation")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return errors.New("restore accepts flags only")
		}
		if *confirmation != restoreConfirmation {
			return fmt.Errorf("restore confirmation must exactly equal %q", restoreConfirmation)
		}
		authenticationKey, err := requiredBackupAuthenticationKey()
		if err != nil {
			return err
		}
		receipt, err := finance.RestoreStore(*statePath, *backupPath, authenticationKey)
		if err != nil {
			return err
		}
		return writeJSON(stdout, map[string]any{"ok": true, "operation": "restore", "receipt": receipt})
	default:
		return usageError()
	}
}

func requiredBackupAuthenticationKey() ([]byte, error) {
	value, ok := os.LookupEnv(backupKeyEnv)
	if !ok || value == "" {
		return nil, fmt.Errorf("%s is required", backupKeyEnv)
	}
	return []byte(value), nil
}

func writeJSON(out io.Writer, value any) error {
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func usageError() error {
	return errors.New("usage: set YNX_FINANCE_BACKUP_AUTH_KEY, then run ynx-finance-admin backup --state PATH --output PATH | verify --backup PATH | restore --state PATH --backup PATH --confirm 'RESTORE FINANCE STATE'")
}
