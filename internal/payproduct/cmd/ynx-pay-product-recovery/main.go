package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]any{"status": "failed", "error": err.Error()})
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("recovery command required: backup, verify, or restore")
	}
	key, err := integrityKey()
	if err != nil {
		return err
	}
	switch args[0] {
	case "backup":
		set := flag.NewFlagSet("backup", flag.ContinueOnError)
		store := set.String("store", "", "state store path")
		out := set.String("out", "", "new backup archive path")
		commit := set.String("source-commit", "", "exact 40-character source commit")
		if err := set.Parse(args[1:]); err != nil {
			return err
		}
		if *store == "" || *out == "" || *commit == "" {
			return errors.New("backup requires --store, --out, and --source-commit")
		}
		manifest, err := payproduct.CreateBackup(*store, *out, key, strings.ToLower(*commit), time.Now().UTC())
		if err != nil {
			return err
		}
		return emit(map[string]any{"status": "verified", "operation": "backup", "manifest": manifest})
	case "verify":
		set := flag.NewFlagSet("verify", flag.ContinueOnError)
		backup := set.String("backup", "", "backup archive path")
		if err := set.Parse(args[1:]); err != nil {
			return err
		}
		if *backup == "" {
			return errors.New("verify requires --backup")
		}
		manifest, err := payproduct.VerifyBackup(*backup, key)
		if err != nil {
			return err
		}
		return emit(map[string]any{"status": "verified", "operation": "verify", "manifest": manifest})
	case "restore":
		set := flag.NewFlagSet("restore", flag.ContinueOnError)
		backup := set.String("backup", "", "backup archive path")
		store := set.String("store", "", "restore destination path")
		expected := set.String("expected-current-sha256", "", "current destination SHA-256 or literal absent")
		if err := set.Parse(args[1:]); err != nil {
			return err
		}
		if *backup == "" || *store == "" || *expected == "" {
			return errors.New("restore requires --backup, --store, and --expected-current-sha256")
		}
		evidence, err := payproduct.RestoreBackup(*backup, *store, key, strings.ToLower(*expected), time.Now().UTC())
		if err != nil {
			return err
		}
		return emit(map[string]any{"status": "verified", "operation": "restore", "evidence": evidence})
	default:
		return fmt.Errorf("unknown recovery command %q", args[0])
	}
}

func integrityKey() ([]byte, error) {
	v := strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_INTEGRITY_KEY"))
	if v == "" {
		return nil, errors.New("YNX_PAY_PRODUCT_INTEGRITY_KEY is required through the environment")
	}
	if raw, err := hex.DecodeString(strings.TrimPrefix(v, "0x")); err == nil && len(raw) >= 32 {
		return raw, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(v)
	if err != nil || len(raw) < 32 {
		return nil, errors.New("YNX_PAY_PRODUCT_INTEGRITY_KEY must decode to at least 32 bytes")
	}
	return raw, nil
}

func emit(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}
