package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestRunSignsCanonicalTransactionWithoutPrintingPrivateKey(t *testing.T) {
	keyBytes := make([]byte, 32)
	keyBytes[31] = 7
	keyPath := filepath.Join(t.TempDir(), "signer.key")
	if err := os.WriteFile(keyPath, keyBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	recipientKeyBytes := make([]byte, 32)
	recipientKeyBytes[31] = 8
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(recipientKeyBytes).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := run(keyPath, 6423, recipient, 25, 1, &output); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(output.Bytes(), keyBytes) {
		t.Fatal("signed transaction output exposed private key bytes")
	}
	tx, err := consensus.DecodeSignedTransaction(output.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Verify(6423); err != nil || tx.Amount != 25 || tx.Nonce != 1 || tx.To != recipient {
		t.Fatalf("unexpected signed transaction: tx=%+v err=%v", tx, err)
	}
}

func TestRunAcceptsYNXRecipientAndEmitsCanonicalTransaction(t *testing.T) {
	keyBytes := make([]byte, 32)
	keyBytes[31] = 17
	keyPath := filepath.Join(t.TempDir(), "signer.key")
	if err := os.WriteFile(keyPath, keyBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	recipientKeyBytes := make([]byte, 32)
	recipientKeyBytes[31] = 18
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(recipientKeyBytes).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	alias, err := accountaddress.Encode(recipient)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := run(keyPath, 6423, alias, 25, 1, &output); err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.DecodeSignedTransaction(output.Bytes())
	if err != nil || tx.To != recipient {
		t.Fatalf("YNX recipient was not canonicalized: tx=%+v err=%v", tx, err)
	}
}

func TestRunRejectsPermissiveOrInvalidKeyFiles(t *testing.T) {
	permissivePath := filepath.Join(t.TempDir(), "permissive.key")
	keyBytes := make([]byte, 32)
	keyBytes[31] = 9
	if err := os.WriteFile(permissivePath, keyBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := run(permissivePath, 6423, "0x1111111111111111111111111111111111111111", 1, 1, &bytes.Buffer{}); err == nil {
		t.Fatal("permissive signing key file was accepted")
	}
	zeroPath := filepath.Join(t.TempDir(), "zero.key")
	if err := os.WriteFile(zeroPath, make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run(zeroPath, 6423, "0x1111111111111111111111111111111111111111", 1, 1, &bytes.Buffer{}); err == nil {
		t.Fatal("zero signing scalar was accepted")
	}
}
