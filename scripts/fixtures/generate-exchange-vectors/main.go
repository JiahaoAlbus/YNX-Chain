package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func main() {
	output := flag.String("output", "", "write canonical public test vectors under testdata/ or tmp/")
	flag.Parse()
	if err := run(*output); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(output string) error {
	if output == "" {
		return errors.New("-output is required")
	}
	root, err := os.Getwd()
	if err != nil {
		return err
	}
	resolved, err := filepath.Abs(output)
	if err != nil {
		return err
	}
	allowed := []string{filepath.Join(root, "testdata"), filepath.Join(root, "tmp")}
	if !pathWithin(resolved, allowed) {
		return errors.New("exchange vector output must be under repository testdata/ or tmp/")
	}

	depositorKey := deterministicTestKey(41)
	depositKey := deterministicTestKey(42)
	recipientKey := deterministicTestKey(43)
	depositor := mustAddress(depositorKey)
	deposit := mustAddress(depositKey)
	recipient := mustAddress(recipientKey)
	depositPayload, depositTx := mustSignedTransfer(depositorKey, deposit, 1_000, 1)
	withdrawalPayload, withdrawalTx := mustSignedTransfer(depositKey, recipient, 125, 1)

	value := map[string]any{
		"accounts": []any{
			accountRecord("depositor", depositor),
			accountRecord("exchange-deposit-and-test-hot-wallet", deposit),
			accountRecord("withdrawal-recipient", recipient),
		},
		"privateKeyMaterialIncluded": false,
		"schema":                     "ynx-exchange-signed-vectors/v1",
		"testOnly":                   true,
		"transactions": []any{
			transactionRecord("deposit-recognition", depositPayload, depositTx),
			transactionRecord("withdrawal-broadcast", withdrawalPayload, withdrawalTx),
		},
		"unsafeForProductionCustody": true,
	}
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if err := os.MkdirAll(filepath.Dir(resolved), 0o755); err != nil {
		return err
	}
	return os.WriteFile(resolved, body, 0o644)
}

func deterministicTestKey(value byte) *secp256k1.PrivateKey {
	payload := make([]byte, 32)
	payload[31] = value
	return secp256k1.PrivKeyFromBytes(payload)
}

func mustAddress(key *secp256k1.PrivateKey) string {
	value, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		panic(err)
	}
	return value
}

func mustSignedTransfer(key *secp256k1.PrivateKey, to string, amount int64, nonce uint64) ([]byte, consensus.SignedTransaction) {
	tx, err := consensus.NewSignedTransfer(key, 6423, to, amount, nonce)
	if err != nil {
		panic(err)
	}
	payload, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		panic(err)
	}
	return payload, tx
}

func accountRecord(role, address string) map[string]any {
	alias, err := accountaddress.Encode(address)
	if err != nil {
		panic(err)
	}
	return map[string]any{"evmAddress": address, "role": role, "ynxAddress": alias}
}

func transactionRecord(purpose string, payload []byte, tx consensus.SignedTransaction) map[string]any {
	raw, err := json.Marshal(tx)
	if err != nil {
		panic(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		panic(err)
	}
	return map[string]any{
		"canonicalPayloadHex": "0x" + hex.EncodeToString(payload),
		"envelope":            envelope,
		"purpose":             purpose,
		"transactionHash":     consensus.SignedTransactionHash(payload),
	}
}

func pathWithin(path string, roots []string) bool {
	for _, root := range roots {
		if path == root || strings.HasPrefix(path, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}
