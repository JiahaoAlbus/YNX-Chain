package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func main() {
	keyPath := flag.String("key", "", "mode-0600 raw 32-byte secp256k1 private key file")
	chainID := flag.Int64("chain-id", 6423, "numeric YNX chain ID")
	to := flag.String("to", "", "canonical EVM-compatible recipient address")
	amount := flag.Int64("amount", 0, "positive YNXT amount")
	nonce := flag.Uint64("nonce", 0, "next account nonce")
	flag.Parse()
	if err := run(*keyPath, *chainID, *to, *amount, *nonce, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(keyPath string, chainID int64, to string, amount int64, nonce uint64, output io.Writer) error {
	if keyPath == "" {
		return errors.New("-key is required")
	}
	info, err := os.Stat(keyPath)
	if err != nil {
		return fmt.Errorf("stat signing key: %w", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("signing key permissions must not allow group or other access: %o", info.Mode().Perm())
	}
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return fmt.Errorf("read signing key: %w", err)
	}
	if len(keyBytes) != 32 || bytes.Equal(keyBytes, make([]byte, 32)) {
		return errors.New("signing key must contain one non-zero raw 32-byte secp256k1 scalar")
	}
	privateKey := secp256k1.PrivKeyFromBytes(keyBytes)
	if !bytes.Equal(privateKey.Serialize(), keyBytes) {
		return errors.New("signing key scalar is outside the canonical secp256k1 range")
	}
	tx, err := consensus.NewSignedTransfer(privateKey, chainID, to, amount, nonce)
	if err != nil {
		return err
	}
	payload, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		return err
	}
	_, err = output.Write(payload)
	return err
}
