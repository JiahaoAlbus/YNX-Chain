package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cardproduct"
)

var now = func() time.Time { return time.Now().UTC() }

func main() {
	log.SetFlags(0)
	if err := run(os.Args[1:], os.Stdout); err != nil {
		log.Fatal(err)
	}
}

func run(args []string, output io.Writer) error {
	if len(args) == 0 {
		return usageError()
	}
	statePath := strings.TrimSpace(os.Getenv("YNX_CARD_PRODUCT_STORE"))
	if statePath == "" {
		return errors.New("YNX_CARD_PRODUCT_STORE is required")
	}
	integrityKey, err := decodeIntegrityKey(os.Getenv("YNX_CARD_PRODUCT_INTEGRITY_KEY"))
	if err != nil {
		return fmt.Errorf("YNX_CARD_PRODUCT_INTEGRITY_KEY: %w", err)
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")

	switch args[0] {
	case "backup":
		if len(args) != 2 {
			return usageError()
		}
		manifest, err := cardproduct.ExportStoreBackup(statePath, args[1], integrityKey, now())
		if err != nil {
			return err
		}
		return encoder.Encode(manifest)
	case "verify":
		if len(args) != 2 {
			return usageError()
		}
		manifest, err := cardproduct.VerifyBackup(args[1], integrityKey)
		if err != nil {
			return err
		}
		return encoder.Encode(manifest)
	case "restore":
		if len(args) != 3 {
			return usageError()
		}
		result, err := cardproduct.RestoreStoreFileFromBackup(statePath, args[1], args[2], integrityKey, now())
		if err != nil {
			return err
		}
		return encoder.Encode(result)
	default:
		return usageError()
	}
}

func usageError() error {
	return errors.New("usage: ynx-card-product-admin backup <absolute-output> | verify <absolute-backup> | restore <absolute-backup> <absolute-rollback-or-quarantine>")
}

func decodeIntegrityKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("is required")
	}
	if raw, err := hex.DecodeString(strings.TrimPrefix(value, "0x")); err == nil && len(raw) >= 32 {
		return raw, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(raw) < 32 {
		return nil, errors.New("must be 32+ byte hex or raw base64")
	}
	return raw, nil
}
