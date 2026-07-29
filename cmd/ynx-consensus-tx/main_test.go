package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

func TestRunTransactionEmitsBoundedEIP1559Transaction(t *testing.T) {
	keyBytes := make([]byte, 32)
	keyBytes[31] = 27
	keyPath := filepath.Join(t.TempDir(), "signer.key")
	if err := os.WriteFile(keyPath, keyBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	recipientKeyBytes := make([]byte, 32)
	recipientKeyBytes[31] = 28
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(recipientKeyBytes).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	options := transactionOptions{
		KeyPath: keyPath, ChainID: 6423, To: recipient, Amount: 125, Nonce: 0,
		Envelope: "eip1559", Format: "raw", MaxPriorityFeePerGas: 2, MaxFeePerGas: 5,
	}
	var output bytes.Buffer
	if err := runTransaction(options, &output); err != nil {
		t.Fatal(err)
	}
	if output.Len() == 0 || output.Bytes()[0] != consensus.EthereumDynamicFeeType {
		t.Fatalf("unexpected EIP-1559 payload: %x", output.Bytes())
	}
	tx, err := consensus.DecodeEthereumDynamicFeeTransaction(output.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Verify(6423); err != nil || tx.To != recipient || tx.Value != 125 || tx.Nonce != 0 || tx.MaxPriorityFeePerGas != 2 || tx.MaxFeePerGas != 5 || tx.EffectiveGasPrice != 2 {
		t.Fatalf("unexpected EIP-1559 transaction: tx=%+v err=%v", tx, err)
	}
	if bytes.Contains(output.Bytes(), keyBytes) {
		t.Fatal("EIP-1559 output exposed private key bytes")
	}
	mixed := options
	mixed.Amount, mixed.GasPrice = 1, 1
	if err := runTransaction(mixed, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "rejects -gas-price") {
		t.Fatalf("mixed EIP-1559 fee flags were accepted: %v", err)
	}
	unsupported := options
	unsupported.Envelope, unsupported.Amount = "eip4844", 1
	if err := runTransaction(unsupported, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "-envelope must be") {
		t.Fatalf("unsupported transaction envelope was accepted: %v", err)
	}
}

func TestRunWithOptionsEmitsEIP1559JSONEvidence(t *testing.T) {
	keyBytes := make([]byte, 32)
	keyBytes[31] = 29
	keyPath := filepath.Join(t.TempDir(), "signer.key")
	if err := os.WriteFile(keyPath, keyBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	recipientKeyBytes := make([]byte, 32)
	recipientKeyBytes[31] = 30
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(recipientKeyBytes).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	options := transactionOptions{Envelope: envelopeEIP1559, Format: "json", MaxPriorityFeePerGas: 1, MaxFeePerGas: 2}
	if err := runWithOptions(keyPath, 6423, recipient, 125, 0, options, &output); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(output.Bytes(), keyBytes) {
		t.Fatal("EIP-1559 JSON evidence exposed private key bytes")
	}
	var evidence transactionOutput
	if err := json.Unmarshal(output.Bytes(), &evidence); err != nil {
		t.Fatal(err)
	}
	if evidence.Schema != "ynx-consensus-transaction/v1" || evidence.Envelope != envelopeEIP1559 || evidence.Hash == "" || evidence.CometHash == "" || evidence.Hash == evidence.CometHash {
		t.Fatalf("unexpected EIP-1559 identity evidence: %+v", evidence)
	}
	if !strings.HasPrefix(evidence.PayloadHex, "0x") {
		t.Fatalf("EIP-1559 payload is not canonical hex: %+v", evidence)
	}
	payload, err := hex.DecodeString(strings.TrimPrefix(evidence.PayloadHex, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.DecodeEthereumDynamicFeeTransaction(payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Verify(6423); err != nil || tx.Hash != evidence.Hash || consensus.SignedTransactionHash(payload) != evidence.CometHash || tx.From != evidence.From || tx.To != recipient || tx.Fee != 21_000 {
		t.Fatalf("unexpected EIP-1559 JSON evidence: tx=%+v evidence=%+v err=%v", tx, evidence, err)
	}
}

func TestRunWithOptionsEmitsBoundedLegacyAndAccessListTransactions(t *testing.T) {
	keyBytes := make([]byte, 32)
	keyBytes[31] = 37
	keyPath := filepath.Join(t.TempDir(), "signer.key")
	if err := os.WriteFile(keyPath, keyBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	recipientKeyBytes := make([]byte, 32)
	recipientKeyBytes[31] = 38
	recipient, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(recipientKeyBytes).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name     string
		envelope string
		decode   func([]byte) (consensus.EthereumValueTransfer, error)
	}{
		{
			name:     "EIP-155",
			envelope: envelopeEIP155,
			decode: func(payload []byte) (consensus.EthereumValueTransfer, error) {
				tx, err := consensus.DecodeEthereumLegacyTransaction(payload)
				return tx.ValueTransfer(), err
			},
		},
		{
			name:     "EIP-2930",
			envelope: envelopeEIP2930,
			decode: func(payload []byte) (consensus.EthereumValueTransfer, error) {
				tx, err := consensus.DecodeEthereumAccessListTransaction(payload)
				return tx.ValueTransfer(), err
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			options := transactionOptions{Envelope: test.envelope, GasPrice: consensus.EthereumMinimumGasPrice}
			if err := runWithOptions(keyPath, 6423, recipient, 25, 0, options, &output); err != nil {
				t.Fatal(err)
			}
			tx, err := test.decode(output.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			if err := tx.Verify(6423); err != nil || tx.To != recipient || tx.Value != 25 || tx.Nonce != 0 || tx.GasPrice != consensus.EthereumMinimumGasPrice {
				t.Fatalf("unexpected %s transaction: tx=%+v err=%v", test.name, tx, err)
			}
			if bytes.Contains(output.Bytes(), keyBytes) {
				t.Fatalf("%s output exposed private key bytes", test.name)
			}
		})
	}
}

func TestRunRejectsPermissiveOrInvalidKeyFiles(t *testing.T) {
	permissivePath := filepath.Join(t.TempDir(), "permissive.key")
	keyBytes := make([]byte, 32)
	keyBytes[31] = 9
	if err := os.WriteFile(permissivePath, keyBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(permissivePath, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(permissivePath, 0o644); err != nil {
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
