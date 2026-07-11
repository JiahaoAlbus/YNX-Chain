package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

const (
	SignedTransactionVersion = 1
	SignedTransactionType    = "transfer"
	SignedTransactionFeeYNXT = int64(1)
	MaxSignedTransactionSize = 16 * 1024
)

var nativeAddressPattern = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

// SignedTransaction is the canonical native YNXT transaction envelope. The
// public key is included so ownership can be verified without a key registry.
type SignedTransaction struct {
	Version   int    `json:"version"`
	ChainID   int64  `json:"chainId"`
	Type      string `json:"type"`
	From      string `json:"from"`
	To        string `json:"to"`
	Amount    int64  `json:"amount"`
	Fee       int64  `json:"fee"`
	Nonce     uint64 `json:"nonce"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
}

type transactionSignDoc struct {
	Domain    string `json:"domain"`
	Version   int    `json:"version"`
	ChainID   int64  `json:"chainId"`
	Type      string `json:"type"`
	From      string `json:"from"`
	To        string `json:"to"`
	Amount    int64  `json:"amount"`
	Fee       int64  `json:"fee"`
	Nonce     uint64 `json:"nonce"`
	PublicKey string `json:"publicKey"`
}

func NativeAddress(publicKey []byte) (string, error) {
	parsed, err := secp256k1.ParsePubKey(publicKey)
	if err != nil {
		return "", fmt.Errorf("parse secp256k1 public key: %w", err)
	}
	uncompressed := parsed.SerializeUncompressed()
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(uncompressed[1:])
	sum := hasher.Sum(nil)
	return "0x" + hex.EncodeToString(sum[len(sum)-20:]), nil
}

func IsNativeAddress(address string) bool {
	return nativeAddressPattern.MatchString(address)
}

func NewSignedTransfer(privateKey *secp256k1.PrivateKey, chainID int64, to string, amount int64, nonce uint64) (SignedTransaction, error) {
	if privateKey == nil {
		return SignedTransaction{}, errors.New("private key is required")
	}
	publicKey := privateKey.PubKey().SerializeCompressed()
	from, err := NativeAddress(publicKey)
	if err != nil {
		return SignedTransaction{}, err
	}
	tx := SignedTransaction{
		Version:   SignedTransactionVersion,
		ChainID:   chainID,
		Type:      SignedTransactionType,
		From:      from,
		To:        strings.ToLower(strings.TrimSpace(to)),
		Amount:    amount,
		Fee:       SignedTransactionFeeYNXT,
		Nonce:     nonce,
		PublicKey: hex.EncodeToString(publicKey),
	}
	if err := tx.ValidateBasic(); err != nil {
		return SignedTransaction{}, err
	}
	signBytes, err := tx.SignBytes()
	if err != nil {
		return SignedTransaction{}, err
	}
	digest := sha256.Sum256(signBytes)
	tx.Signature = hex.EncodeToString(ecdsa.Sign(privateKey, digest[:]).Serialize())
	return tx, nil
}

func (tx SignedTransaction) SignBytes() ([]byte, error) {
	doc := transactionSignDoc{
		Domain:    "YNX_NATIVE_TX_V1",
		Version:   tx.Version,
		ChainID:   tx.ChainID,
		Type:      tx.Type,
		From:      tx.From,
		To:        tx.To,
		Amount:    tx.Amount,
		Fee:       tx.Fee,
		Nonce:     tx.Nonce,
		PublicKey: tx.PublicKey,
	}
	return json.Marshal(doc)
}

func (tx SignedTransaction) ValidateBasic() error {
	if tx.Version != SignedTransactionVersion {
		return fmt.Errorf("unsupported signed transaction version %d", tx.Version)
	}
	if tx.ChainID <= 0 {
		return errors.New("signed transaction chain ID must be positive")
	}
	if tx.Type != SignedTransactionType {
		return fmt.Errorf("unsupported signed transaction type %q", tx.Type)
	}
	if !IsNativeAddress(tx.From) || !IsNativeAddress(tx.To) {
		return errors.New("signed transaction requires canonical EVM-compatible from and to addresses")
	}
	if tx.From == tx.To {
		return errors.New("signed transaction sender and recipient must differ")
	}
	if tx.Amount <= 0 {
		return errors.New("signed transaction amount must be positive")
	}
	if tx.Fee != SignedTransactionFeeYNXT {
		return fmt.Errorf("signed transaction fee must equal %d YNXT", SignedTransactionFeeYNXT)
	}
	if tx.Nonce == 0 {
		return errors.New("signed transaction nonce must be positive")
	}
	publicKey, err := hex.DecodeString(tx.PublicKey)
	if err != nil || len(publicKey) != secp256k1.PubKeyBytesLenCompressed {
		return errors.New("signed transaction public key must be a compressed secp256k1 key")
	}
	if tx.Signature != "" {
		signature, err := hex.DecodeString(tx.Signature)
		if err != nil || len(signature) == 0 {
			return errors.New("signed transaction signature must be hex-encoded DER")
		}
	}
	return nil
}

func (tx SignedTransaction) Verify(expectedChainID int64) error {
	if err := tx.ValidateBasic(); err != nil {
		return err
	}
	if tx.ChainID != expectedChainID {
		return fmt.Errorf("signed transaction chain ID %d does not match %d", tx.ChainID, expectedChainID)
	}
	publicKeyBytes, _ := hex.DecodeString(tx.PublicKey)
	derived, err := NativeAddress(publicKeyBytes)
	if err != nil {
		return err
	}
	if derived != tx.From {
		return errors.New("signed transaction sender does not match its public key")
	}
	if tx.Signature == "" {
		return errors.New("signed transaction signature is required")
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return fmt.Errorf("parse signed transaction public key: %w", err)
	}
	signatureBytes, _ := hex.DecodeString(tx.Signature)
	signature, err := ecdsa.ParseDERSignature(signatureBytes)
	if err != nil {
		return fmt.Errorf("parse signed transaction signature: %w", err)
	}
	sValue := signature.S()
	if sValue.IsOverHalfOrder() {
		return errors.New("signed transaction signature is not canonical low-S")
	}
	signBytes, err := tx.SignBytes()
	if err != nil {
		return err
	}
	digest := sha256.Sum256(signBytes)
	if !signature.Verify(digest[:], publicKey) {
		return errors.New("signed transaction signature verification failed")
	}
	return nil
}

func EncodeSignedTransaction(tx SignedTransaction) ([]byte, error) {
	if err := tx.Verify(tx.ChainID); err != nil {
		return nil, err
	}
	return json.Marshal(tx)
}

func DecodeSignedTransaction(payload []byte) (SignedTransaction, error) {
	if len(payload) == 0 || len(payload) > MaxSignedTransactionSize {
		return SignedTransaction{}, fmt.Errorf("signed transaction size must be between 1 and %d bytes", MaxSignedTransactionSize)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var tx SignedTransaction
	if err := decoder.Decode(&tx); err != nil {
		return SignedTransaction{}, fmt.Errorf("decode signed transaction: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return SignedTransaction{}, errors.New("signed transaction must contain one JSON value")
	}
	canonical, err := json.Marshal(tx)
	if err != nil {
		return SignedTransaction{}, err
	}
	if !bytes.Equal(payload, canonical) {
		return SignedTransaction{}, errors.New("signed transaction encoding is not canonical JSON")
	}
	return tx, nil
}

func SignedTransactionHash(payload []byte) string {
	sum := sha256.Sum256(payload)
	return "0x" + hex.EncodeToString(sum[:])
}
