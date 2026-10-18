package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const (
	envelopeYNX     = "ynx"
	envelopeEIP155  = "eip155"
	envelopeEIP2930 = "eip2930"
	envelopeEIP1559 = "eip1559"
)

func main() {
	keyPath := flag.String("key", "", "mode-0600 raw 32-byte secp256k1 private key file")
	chainID := flag.Int64("chain-id", 6423, "numeric YNX chain ID")
	to := flag.String("to", "", "recipient address in canonical 0x or checksummed ynx1 format")
	amount := flag.Int64("amount", 0, "positive YNXT amount")
	nonce := flag.Uint64("nonce", 0, "next native nonce or current Ethereum account nonce")
	envelope := flag.String("envelope", "ynx", "transaction envelope: ynx, eip155, eip2930, or eip1559")
	format := flag.String("format", "raw", "output format: raw or json")
	gasPrice := flag.Uint64("gas-price", 0, "gas price for bounded EIP-155 or EIP-2930 transfers")
	maxPriorityFeePerGas := flag.Uint64("max-priority-fee-per-gas", 0, "priority fee cap for bounded EIP-1559 transfers")
	maxFeePerGas := flag.Uint64("max-fee-per-gas", 0, "maximum fee cap for bounded EIP-1559 transfers")
	flag.Parse()
	if err := runTransaction(transactionOptions{
		KeyPath: keyPathValue(*keyPath), ChainID: *chainID, To: *to, Amount: *amount, Nonce: *nonce,
		Envelope: *envelope, Format: *format, GasPrice: *gasPrice,
		MaxPriorityFeePerGas: *maxPriorityFeePerGas, MaxFeePerGas: *maxFeePerGas,
	}, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func keyPathValue(value string) string {
	return strings.TrimSpace(value)
}

func run(keyPath string, chainID int64, to string, amount int64, nonce uint64, output io.Writer) error {
	return runWithOptions(keyPath, chainID, to, amount, nonce, transactionOptions{Envelope: envelopeYNX}, output)
}

func runWithOptions(keyPath string, chainID int64, to string, amount int64, nonce uint64, options transactionOptions, output io.Writer) error {
	options.KeyPath = keyPath
	options.ChainID = chainID
	options.To = to
	options.Amount = amount
	options.Nonce = nonce
	if strings.TrimSpace(options.Envelope) == "" {
		options.Envelope = envelopeYNX
	}
	if strings.TrimSpace(options.Format) == "" {
		options.Format = "raw"
	}
	return runTransaction(options, output)
}

type transactionOptions struct {
	KeyPath              string
	ChainID              int64
	To                   string
	Amount               int64
	Nonce                uint64
	Envelope             string
	Format               string
	GasPrice             uint64
	MaxPriorityFeePerGas uint64
	MaxFeePerGas         uint64
}

type transactionOutput struct {
	Schema               string `json:"schema"`
	Envelope             string `json:"envelope"`
	PayloadHex           string `json:"payloadHex"`
	Hash                 string `json:"hash"`
	CometHash            string `json:"cometHash"`
	From                 string `json:"from"`
	To                   string `json:"to"`
	Nonce                uint64 `json:"nonce"`
	Amount               int64  `json:"amount"`
	GasLimit             uint64 `json:"gasLimit,omitempty"`
	GasPrice             uint64 `json:"gasPrice,omitempty"`
	MaxPriorityFeePerGas uint64 `json:"maxPriorityFeePerGas,omitempty"`
	MaxFeePerGas         uint64 `json:"maxFeePerGas,omitempty"`
	EffectiveGasPrice    uint64 `json:"effectiveGasPrice,omitempty"`
	Fee                  int64  `json:"fee"`
}

func runTransaction(options transactionOptions, output io.Writer) error {
	privateKey, err := loadPrivateKey(options.KeyPath)
	if err != nil {
		return err
	}
	envelope := strings.ToLower(strings.TrimSpace(options.Envelope))
	format := strings.ToLower(strings.TrimSpace(options.Format))
	if format != "raw" && format != "json" {
		return errors.New("-format must be raw or json")
	}
	var payload []byte
	result := transactionOutput{
		Schema: "ynx-consensus-transaction/v1", Envelope: envelope,
		To: options.To, Nonce: options.Nonce, Amount: options.Amount,
	}
	switch envelope {
	case "ynx":
		if options.GasPrice != 0 || options.MaxPriorityFeePerGas != 0 || options.MaxFeePerGas != 0 {
			return errors.New("YNX canonical transfers do not accept Ethereum fee flags")
		}
		tx, err := consensus.NewSignedTransfer(privateKey, options.ChainID, options.To, options.Amount, options.Nonce)
		if err != nil {
			return err
		}
		payload, err = consensus.EncodeSignedTransaction(tx)
		if err != nil {
			return err
		}
		result.Hash = consensus.SignedTransactionHash(payload)
		result.From, result.To, result.Fee = tx.From, tx.To, tx.Fee
	case "eip155":
		if options.GasPrice < consensus.EthereumMinimumGasPrice || options.MaxPriorityFeePerGas != 0 || options.MaxFeePerGas != 0 {
			return errors.New("bounded EIP-155 requires -gas-price and rejects EIP-1559 fee flags")
		}
		txPayload, tx, err := consensus.NewEthereumLegacyTransfer(privateKey, options.ChainID, options.Nonce, options.GasPrice, options.To, options.Amount)
		if err != nil {
			return err
		}
		payload = txPayload
		result.Hash, result.From, result.To = tx.Hash, tx.From, tx.To
		result.GasLimit, result.GasPrice, result.EffectiveGasPrice, result.Fee = tx.GasLimit, tx.GasPrice, tx.GasPrice, tx.Fee
	case "eip2930":
		if options.GasPrice < consensus.EthereumMinimumGasPrice || options.MaxPriorityFeePerGas != 0 || options.MaxFeePerGas != 0 {
			return errors.New("bounded EIP-2930 requires -gas-price and rejects EIP-1559 fee flags")
		}
		txPayload, tx, err := consensus.NewEthereumAccessListTransfer(privateKey, options.ChainID, options.Nonce, options.GasPrice, options.To, options.Amount)
		if err != nil {
			return err
		}
		payload = txPayload
		result.Hash, result.From, result.To = tx.Hash, tx.From, tx.To
		result.GasLimit, result.GasPrice, result.EffectiveGasPrice, result.Fee = tx.GasLimit, tx.GasPrice, tx.GasPrice, tx.Fee
	case "eip1559":
		if options.GasPrice != 0 || options.MaxPriorityFeePerGas < consensus.EthereumMinimumGasPrice || options.MaxFeePerGas < consensus.EthereumMinimumGasPrice {
			return errors.New("bounded EIP-1559 requires max-priority and max-fee flags and rejects -gas-price")
		}
		txPayload, tx, err := consensus.NewEthereumDynamicFeeTransfer(privateKey, options.ChainID, options.Nonce, options.MaxPriorityFeePerGas, options.MaxFeePerGas, options.To, options.Amount)
		if err != nil {
			return err
		}
		payload = txPayload
		result.Hash, result.From, result.To = tx.Hash, tx.From, tx.To
		result.GasLimit, result.GasPrice, result.EffectiveGasPrice, result.Fee = tx.GasLimit, tx.EffectiveGasPrice, tx.EffectiveGasPrice, tx.Fee
		result.MaxPriorityFeePerGas, result.MaxFeePerGas = tx.MaxPriorityFeePerGas, tx.MaxFeePerGas
	default:
		return errors.New("-envelope must be ynx, eip155, eip2930, or eip1559")
	}
	result.PayloadHex = "0x" + hex.EncodeToString(payload)
	result.CometHash = consensus.SignedTransactionHash(payload)
	if format == "json" {
		encoder := json.NewEncoder(output)
		encoder.SetEscapeHTML(false)
		return encoder.Encode(result)
	}
	_, err = output.Write(payload)
	return err
}

func loadPrivateKey(keyPath string) (*secp256k1.PrivateKey, error) {
	if strings.TrimSpace(keyPath) == "" {
		return nil, errors.New("-key is required")
	}
	info, err := os.Stat(keyPath)
	if err != nil {
		return nil, fmt.Errorf("stat signing key: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("signing key must be a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("signing key permissions must not allow group or other access: %o", info.Mode().Perm())
	}
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("read signing key: %w", err)
	}
	if len(keyBytes) != 32 || bytes.Equal(keyBytes, make([]byte, 32)) {
		return nil, errors.New("signing key must contain one non-zero raw 32-byte secp256k1 scalar")
	}
	privateKey := secp256k1.PrivKeyFromBytes(keyBytes)
	if !bytes.Equal(privateKey.Serialize(), keyBytes) {
		return nil, errors.New("signing key scalar is outside the canonical secp256k1 range")
	}
	return privateKey, nil
}
