package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type publicRecord struct {
	Version         int    `json:"version"`
	Purpose         string `json:"purpose"`
	Address         string `json:"address"`
	YNXAddress      string `json:"ynxAddress"`
	CustodyBoundary string `json:"custodyBoundary"`
}

func main() {
	mode := flag.String("mode", "create", "create a new key or inspect an existing key")
	keyPath := flag.String("key", "", "owner-controlled raw 32-byte secp256k1 key file")
	publicRecordPath := flag.String("public-record", "", "non-secret public address record")
	purpose := flag.String("purpose", "ynx-owner-controlled-candidate-testnet-account", "approved non-secret key purpose")
	acknowledge := flag.Bool("owner-controlled", false, "required acknowledgement that the key remains owner controlled")
	flag.Parse()
	if err := run(*mode, *keyPath, *publicRecordPath, *purpose, *acknowledge, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(mode, keyPath, publicRecordPath, purpose string, acknowledge bool, output io.Writer) error {
	if !acknowledge {
		return errors.New("-owner-controlled acknowledgement is required")
	}
	if keyPath == "" || publicRecordPath == "" {
		return errors.New("-key and -public-record are required")
	}
	purpose = strings.TrimSpace(purpose)
	allowedPurposes := map[string]bool{
		"ynx-owner-controlled-candidate-testnet-account": true,
		"ynx-production-faucet-signer":                   true,
		"ynx-production-ai-signer":                       true,
		"ynx-production-pay-signer":                      true,
		"ynx-production-trust-signer":                    true,
		"ynx-production-resource-signer":                 true,
	}
	if !allowedPurposes[purpose] {
		return errors.New("unsupported owner account key purpose")
	}
	var privateKey *secp256k1.PrivateKey
	switch mode {
	case "create":
		if _, err := os.Stat(keyPath); !errors.Is(err, os.ErrNotExist) {
			return errors.New("owner account key path already exists")
		}
		if err := os.MkdirAll(filepath.Dir(keyPath), 0o700); err != nil {
			return err
		}
		generated, err := secp256k1.GeneratePrivateKey()
		if err != nil {
			return err
		}
		file, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return err
		}
		if _, err := file.Write(generated.Serialize()); err != nil {
			file.Close()
			_ = os.Remove(keyPath)
			return err
		}
		if err := file.Close(); err != nil {
			_ = os.Remove(keyPath)
			return err
		}
		privateKey = generated
	case "inspect":
		payload, err := os.ReadFile(keyPath)
		if err != nil {
			return err
		}
		info, err := os.Stat(keyPath)
		if err != nil || info.Mode().Perm()&0o077 != 0 || len(payload) != 32 || bytes.Equal(payload, make([]byte, 32)) {
			return errors.New("owner account key must be a mode-restricted canonical 32-byte scalar")
		}
		privateKey = secp256k1.PrivKeyFromBytes(payload)
		if !bytes.Equal(privateKey.Serialize(), payload) {
			return errors.New("owner account key scalar is outside the canonical range")
		}
	default:
		return fmt.Errorf("unsupported mode %q", mode)
	}
	address, err := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	if err != nil {
		return err
	}
	ynxAddress, err := accountaddress.Encode(address)
	if err != nil {
		return err
	}
	record := publicRecord{Version: 1, Purpose: purpose, Address: address, YNXAddress: ynxAddress, CustodyBoundary: "owner-local-mode-0600"}
	payload, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(publicRecordPath, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(publicRecordPath, 0o600); err != nil {
		return err
	}
	_, err = fmt.Fprintf(output, "owner-controlled account ready: purpose=%s address=%s ynxAddress=%s custody=%s\n", purpose, address, ynxAddress, record.CustodyBoundary)
	return err
}
