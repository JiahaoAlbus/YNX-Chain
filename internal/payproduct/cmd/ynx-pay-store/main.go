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

	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: ynx-pay-store <verify|backup|restore> [flags]")
	}
	key, err := decodeIntegrityKey(strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_INTEGRITY_KEY")))
	if err != nil {
		return err
	}
	switch args[0] {
	case "verify":
		set := flag.NewFlagSet("verify", flag.ContinueOnError)
		storePath := set.String("store", "", "store or backup path")
		if err := set.Parse(args[1:]); err != nil {
			return err
		}
		if strings.TrimSpace(*storePath) == "" {
			return errors.New("verify requires --store")
		}
		receipt, err := payproduct.VerifyStoreBackup(*storePath, key)
		if err != nil {
			return err
		}
		return writeJSON(receipt)
	case "backup":
		set := flag.NewFlagSet("backup", flag.ContinueOnError)
		storePath := set.String("store", "", "live store path")
		outputPath := set.String("output", "", "backup output path")
		if err := set.Parse(args[1:]); err != nil {
			return err
		}
		if strings.TrimSpace(*storePath) == "" || strings.TrimSpace(*outputPath) == "" {
			return errors.New("backup requires --store and --output")
		}
		store, err := payproduct.OpenStore(*storePath, key)
		if err != nil {
			return err
		}
		receipt, err := store.CreateBackup(*outputPath)
		if err != nil {
			return err
		}
		return writeJSON(receipt)
	case "restore":
		set := flag.NewFlagSet("restore", flag.ContinueOnError)
		backupPath := set.String("backup", "", "validated backup path")
		storePath := set.String("store", "", "offline destination store path")
		if err := set.Parse(args[1:]); err != nil {
			return err
		}
		if strings.TrimSpace(*backupPath) == "" || strings.TrimSpace(*storePath) == "" {
			return errors.New("restore requires --backup and --store")
		}
		receipt, err := payproduct.RestoreStoreFromBackup(*backupPath, *storePath, key)
		if err != nil {
			return err
		}
		return writeJSON(receipt)
	default:
		return fmt.Errorf("unknown ynx-pay-store command %q", args[0])
	}
}

func decodeIntegrityKey(value string) ([]byte, error) {
	if value == "" {
		return nil, errors.New("YNX_PAY_PRODUCT_INTEGRITY_KEY is required")
	}
	hexValue := strings.TrimPrefix(value, "0x")
	if isHexEncoding(hexValue) {
		raw, err := hex.DecodeString(hexValue)
		if err != nil || len(raw) < 32 {
			return nil, errors.New("YNX_PAY_PRODUCT_INTEGRITY_KEY hex value must contain at least 32 bytes")
		}
		return raw, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(raw) < 32 {
		return nil, errors.New("YNX_PAY_PRODUCT_INTEGRITY_KEY must be at least 32 bytes encoded as hex or unpadded base64")
	}
	return raw, nil
}

func isHexEncoding(value string) bool {
	if value == "" || len(value)%2 != 0 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func writeJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
