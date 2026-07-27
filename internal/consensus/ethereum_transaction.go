package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

const (
	EthereumLegacyTransferType         = "ethereum_legacy_transfer"
	EthereumAccessListTransferType     = "ethereum_access_list_transfer"
	EthereumDynamicFeeTransferType     = "ethereum_dynamic_fee_transfer"
	EthereumLegacyTransactionType      = byte(0x00)
	EthereumAccessListType             = byte(0x01)
	EthereumDynamicFeeType             = byte(0x02)
	EthereumTransferGasLimit           = uint64(21_000)
	EthereumCompatibilityBaseFeePerGas = uint64(0)
)

// EthereumLegacyTransaction is the bounded Ethereum compatibility envelope
// accepted by Chain Core. It intentionally covers only EIP-155-protected,
// legacy, simple value transfers. Contract creation, calldata, access lists and
// typed fee-market envelopes remain unsupported until separately implemented.
type EthereumLegacyTransaction struct {
	Nonce      uint64
	GasPrice   uint64
	GasLimit   uint64
	To         string
	Value      int64
	Data       []byte
	ChainID    int64
	V          uint64
	R          [32]byte
	S          [32]byte
	RecoveryID byte
	From       string
	Fee        int64
	Hash       string
}

// EthereumAccessListTransaction is the bounded EIP-2930 compatibility
// envelope accepted by Chain Core. Only an empty access list and a simple
// value transfer are supported; calldata, contract creation and non-empty
// access lists remain rejected.
type EthereumAccessListTransaction struct {
	ChainID    int64
	Nonce      uint64
	GasPrice   uint64
	GasLimit   uint64
	To         string
	Value      int64
	Data       []byte
	YParity    uint64
	R          [32]byte
	S          [32]byte
	RecoveryID byte
	From       string
	Fee        int64
	Hash       string
}

// EthereumDynamicFeeTransaction is the bounded EIP-1559 compatibility
// envelope accepted by Chain Core. The compatibility base fee is explicitly
// zero, so effective gas price equals maxPriorityFeePerGas. Access lists must
// be empty and only simple value transfers are accepted.
type EthereumDynamicFeeTransaction struct {
	ChainID              int64
	Nonce                uint64
	MaxPriorityFeePerGas uint64
	MaxFeePerGas         uint64
	EffectiveGasPrice    uint64
	GasLimit             uint64
	To                   string
	Value                int64
	Data                 []byte
	YParity              uint64
	R                    [32]byte
	S                    [32]byte
	RecoveryID           byte
	From                 string
	Fee                  int64
	Hash                 string
}

// EthereumValueTransfer is the normalized execution view shared by the
// bounded legacy, EIP-2930 and EIP-1559 envelopes.
type EthereumValueTransfer struct {
	EnvelopeType         string
	TransactionType      byte
	ChainID              int64
	Nonce                uint64
	GasPrice             uint64
	MaxPriorityFeePerGas uint64
	MaxFeePerGas         uint64
	BaseFeePerGas        uint64
	GasLimit             uint64
	To                   string
	Value                int64
	Data                 []byte
	V                    uint64
	R                    [32]byte
	S                    [32]byte
	RecoveryID           byte
	From                 string
	Fee                  int64
	Hash                 string
}

func IsEthereumLegacyEnvelope(payload []byte) bool {
	return len(payload) > 0 && payload[0] >= 0xc0
}

func IsEthereumTypedEnvelope(payload []byte) bool {
	if len(payload) < 2 {
		return false
	}
	switch payload[0] {
	case 0x01, 0x02, 0x03, 0x04:
		return true
	default:
		return false
	}
}

func EthereumTransactionHash(payload []byte) string {
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(payload)
	return "0x" + hex.EncodeToString(hasher.Sum(nil))
}

func NewEthereumLegacyTransfer(privateKey *secp256k1.PrivateKey, chainID int64, nonce, gasPrice uint64, to string, value int64) ([]byte, EthereumLegacyTransaction, error) {
	if privateKey == nil {
		return nil, EthereumLegacyTransaction{}, errors.New("private key is required")
	}
	canonicalTo, err := accountaddress.Normalize(to)
	if err != nil {
		return nil, EthereumLegacyTransaction{}, fmt.Errorf("normalize Ethereum recipient: %w", err)
	}
	if chainID <= 0 || uint64(chainID) > (math.MaxUint64-36)/2 {
		return nil, EthereumLegacyTransaction{}, errors.New("Ethereum chain ID is outside the bounded EIP-155 range")
	}
	if gasPrice == 0 || gasPrice > uint64(math.MaxInt64)/EthereumTransferGasLimit {
		return nil, EthereumLegacyTransaction{}, errors.New("Ethereum gas price produces an invalid bounded fee")
	}
	if value <= 0 {
		return nil, EthereumLegacyTransaction{}, errors.New("Ethereum transfer value must be positive")
	}
	toBytes, _ := hex.DecodeString(canonicalTo[2:])
	unsigned := encodeRLPList(
		encodeRLPUint(nonce),
		encodeRLPUint(gasPrice),
		encodeRLPUint(EthereumTransferGasLimit),
		encodeRLPBytes(toBytes),
		encodeRLPUint(uint64(value)),
		encodeRLPBytes(nil),
		encodeRLPUint(uint64(chainID)),
		encodeRLPUint(0),
		encodeRLPUint(0),
	)
	digest := legacyKeccak(unsigned)
	compact := ecdsa.SignCompact(privateKey, digest, true)
	if len(compact) != 65 || compact[0] < 31 || compact[0] > 34 {
		return nil, EthereumLegacyTransaction{}, errors.New("unexpected compact secp256k1 signature")
	}
	recoveryID := uint64(compact[0] - 31)
	if recoveryID > 1 {
		return nil, EthereumLegacyTransaction{}, errors.New("Ethereum legacy transfer requires recovery ID 0 or 1")
	}
	v := uint64(chainID)*2 + 35 + recoveryID
	payload := encodeRLPList(
		encodeRLPUint(nonce),
		encodeRLPUint(gasPrice),
		encodeRLPUint(EthereumTransferGasLimit),
		encodeRLPBytes(toBytes),
		encodeRLPUint(uint64(value)),
		encodeRLPBytes(nil),
		encodeRLPUint(v),
		encodeRLPBytes(trimLeadingZeroes(compact[1:33])),
		encodeRLPBytes(trimLeadingZeroes(compact[33:65])),
	)
	decoded, err := DecodeEthereumLegacyTransaction(payload)
	if err != nil {
		return nil, EthereumLegacyTransaction{}, err
	}
	if err := decoded.Verify(chainID); err != nil {
		return nil, EthereumLegacyTransaction{}, err
	}
	return payload, decoded, nil
}

func NewEthereumAccessListTransfer(privateKey *secp256k1.PrivateKey, chainID int64, nonce, gasPrice uint64, to string, value int64) ([]byte, EthereumAccessListTransaction, error) {
	if privateKey == nil {
		return nil, EthereumAccessListTransaction{}, errors.New("private key is required")
	}
	canonicalTo, err := accountaddress.Normalize(to)
	if err != nil {
		return nil, EthereumAccessListTransaction{}, fmt.Errorf("normalize Ethereum recipient: %w", err)
	}
	if chainID <= 0 {
		return nil, EthereumAccessListTransaction{}, errors.New("Ethereum chain ID must be positive")
	}
	if gasPrice == 0 || gasPrice > uint64(math.MaxInt64)/EthereumTransferGasLimit {
		return nil, EthereumAccessListTransaction{}, errors.New("Ethereum gas price produces an invalid bounded fee")
	}
	if value <= 0 {
		return nil, EthereumAccessListTransaction{}, errors.New("Ethereum transfer value must be positive")
	}
	toBytes, _ := hex.DecodeString(canonicalTo[2:])
	unsigned := encodeRLPList(
		encodeRLPUint(uint64(chainID)),
		encodeRLPUint(nonce),
		encodeRLPUint(gasPrice),
		encodeRLPUint(EthereumTransferGasLimit),
		encodeRLPBytes(toBytes),
		encodeRLPUint(uint64(value)),
		encodeRLPBytes(nil),
		encodeRLPList(),
	)
	digest := legacyKeccak(append([]byte{EthereumAccessListType}, unsigned...))
	compact := ecdsa.SignCompact(privateKey, digest, true)
	if len(compact) != 65 || compact[0] < 31 || compact[0] > 34 {
		return nil, EthereumAccessListTransaction{}, errors.New("unexpected compact secp256k1 signature")
	}
	yParity := uint64(compact[0] - 31)
	if yParity > 1 {
		return nil, EthereumAccessListTransaction{}, errors.New("Ethereum access-list transfer requires y parity 0 or 1")
	}
	signed := encodeRLPList(
		encodeRLPUint(uint64(chainID)),
		encodeRLPUint(nonce),
		encodeRLPUint(gasPrice),
		encodeRLPUint(EthereumTransferGasLimit),
		encodeRLPBytes(toBytes),
		encodeRLPUint(uint64(value)),
		encodeRLPBytes(nil),
		encodeRLPList(),
		encodeRLPUint(yParity),
		encodeRLPBytes(trimLeadingZeroes(compact[1:33])),
		encodeRLPBytes(trimLeadingZeroes(compact[33:65])),
	)
	payload := append([]byte{EthereumAccessListType}, signed...)
	decoded, err := DecodeEthereumAccessListTransaction(payload)
	if err != nil {
		return nil, EthereumAccessListTransaction{}, err
	}
	if err := decoded.Verify(chainID); err != nil {
		return nil, EthereumAccessListTransaction{}, err
	}
	return payload, decoded, nil
}

func NewEthereumDynamicFeeTransfer(privateKey *secp256k1.PrivateKey, chainID int64, nonce, maxPriorityFeePerGas, maxFeePerGas uint64, to string, value int64) ([]byte, EthereumDynamicFeeTransaction, error) {
	if privateKey == nil {
		return nil, EthereumDynamicFeeTransaction{}, errors.New("private key is required")
	}
	canonicalTo, err := accountaddress.Normalize(to)
	if err != nil {
		return nil, EthereumDynamicFeeTransaction{}, fmt.Errorf("normalize Ethereum recipient: %w", err)
	}
	if chainID <= 0 {
		return nil, EthereumDynamicFeeTransaction{}, errors.New("Ethereum chain ID must be positive")
	}
	if maxPriorityFeePerGas == 0 || maxPriorityFeePerGas > maxFeePerGas {
		return nil, EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic fee requires 0 < maxPriorityFeePerGas <= maxFeePerGas")
	}
	if maxFeePerGas > uint64(math.MaxInt64)/EthereumTransferGasLimit {
		return nil, EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic fee maximum produces an invalid bounded exposure")
	}
	if value <= 0 {
		return nil, EthereumDynamicFeeTransaction{}, errors.New("Ethereum transfer value must be positive")
	}
	toBytes, _ := hex.DecodeString(canonicalTo[2:])
	unsigned := encodeRLPList(
		encodeRLPUint(uint64(chainID)),
		encodeRLPUint(nonce),
		encodeRLPUint(maxPriorityFeePerGas),
		encodeRLPUint(maxFeePerGas),
		encodeRLPUint(EthereumTransferGasLimit),
		encodeRLPBytes(toBytes),
		encodeRLPUint(uint64(value)),
		encodeRLPBytes(nil),
		encodeRLPList(),
	)
	digest := legacyKeccak(append([]byte{EthereumDynamicFeeType}, unsigned...))
	compact := ecdsa.SignCompact(privateKey, digest, true)
	if len(compact) != 65 || compact[0] < 31 || compact[0] > 34 {
		return nil, EthereumDynamicFeeTransaction{}, errors.New("unexpected compact secp256k1 signature")
	}
	yParity := uint64(compact[0] - 31)
	if yParity > 1 {
		return nil, EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic-fee transfer requires y parity 0 or 1")
	}
	signed := encodeRLPList(
		encodeRLPUint(uint64(chainID)),
		encodeRLPUint(nonce),
		encodeRLPUint(maxPriorityFeePerGas),
		encodeRLPUint(maxFeePerGas),
		encodeRLPUint(EthereumTransferGasLimit),
		encodeRLPBytes(toBytes),
		encodeRLPUint(uint64(value)),
		encodeRLPBytes(nil),
		encodeRLPList(),
		encodeRLPUint(yParity),
		encodeRLPBytes(trimLeadingZeroes(compact[1:33])),
		encodeRLPBytes(trimLeadingZeroes(compact[33:65])),
	)
	payload := append([]byte{EthereumDynamicFeeType}, signed...)
	decoded, err := DecodeEthereumDynamicFeeTransaction(payload)
	if err != nil {
		return nil, EthereumDynamicFeeTransaction{}, err
	}
	if err := decoded.Verify(chainID); err != nil {
		return nil, EthereumDynamicFeeTransaction{}, err
	}
	return payload, decoded, nil
}

func DecodeEthereumValueTransfer(payload []byte) (EthereumValueTransfer, error) {
	if len(payload) == 0 {
		return EthereumValueTransfer{}, errors.New("Ethereum transaction payload is empty")
	}
	if payload[0] == EthereumAccessListType {
		tx, err := DecodeEthereumAccessListTransaction(payload)
		if err != nil {
			return EthereumValueTransfer{}, err
		}
		return tx.ValueTransfer(), nil
	}
	if payload[0] == EthereumDynamicFeeType {
		tx, err := DecodeEthereumDynamicFeeTransaction(payload)
		if err != nil {
			return EthereumValueTransfer{}, err
		}
		return tx.ValueTransfer(), nil
	}
	tx, err := DecodeEthereumLegacyTransaction(payload)
	if err != nil {
		return EthereumValueTransfer{}, err
	}
	return tx.ValueTransfer(), nil
}

func (tx EthereumLegacyTransaction) ValueTransfer() EthereumValueTransfer {
	return EthereumValueTransfer{
		EnvelopeType: EthereumLegacyTransferType, TransactionType: EthereumLegacyTransactionType,
		ChainID: tx.ChainID, Nonce: tx.Nonce, GasPrice: tx.GasPrice, GasLimit: tx.GasLimit,
		To: tx.To, Value: tx.Value, Data: append([]byte(nil), tx.Data...), V: tx.V,
		R: tx.R, S: tx.S, RecoveryID: tx.RecoveryID, From: tx.From, Fee: tx.Fee, Hash: tx.Hash,
	}
}

func (tx EthereumAccessListTransaction) ValueTransfer() EthereumValueTransfer {
	return EthereumValueTransfer{
		EnvelopeType: EthereumAccessListTransferType, TransactionType: EthereumAccessListType,
		ChainID: tx.ChainID, Nonce: tx.Nonce, GasPrice: tx.GasPrice, GasLimit: tx.GasLimit,
		To: tx.To, Value: tx.Value, Data: append([]byte(nil), tx.Data...), V: tx.YParity,
		R: tx.R, S: tx.S, RecoveryID: tx.RecoveryID, From: tx.From, Fee: tx.Fee, Hash: tx.Hash,
	}
}

func (tx EthereumDynamicFeeTransaction) ValueTransfer() EthereumValueTransfer {
	return EthereumValueTransfer{
		EnvelopeType: EthereumDynamicFeeTransferType, TransactionType: EthereumDynamicFeeType,
		ChainID: tx.ChainID, Nonce: tx.Nonce, GasPrice: tx.EffectiveGasPrice,
		MaxPriorityFeePerGas: tx.MaxPriorityFeePerGas, MaxFeePerGas: tx.MaxFeePerGas,
		BaseFeePerGas: EthereumCompatibilityBaseFeePerGas, GasLimit: tx.GasLimit,
		To: tx.To, Value: tx.Value, Data: append([]byte(nil), tx.Data...), V: tx.YParity,
		R: tx.R, S: tx.S, RecoveryID: tx.RecoveryID, From: tx.From, Fee: tx.Fee, Hash: tx.Hash,
	}
}

func (tx EthereumValueTransfer) Verify(expectedChainID int64) error {
	if tx.ChainID != expectedChainID {
		return fmt.Errorf("Ethereum transaction chain ID %d does not match %d", tx.ChainID, expectedChainID)
	}
	if tx.EnvelopeType != EthereumLegacyTransferType && tx.EnvelopeType != EthereumAccessListTransferType && tx.EnvelopeType != EthereumDynamicFeeTransferType {
		return errors.New("Ethereum transfer envelope type is unsupported")
	}
	if (tx.EnvelopeType == EthereumLegacyTransferType && tx.TransactionType != EthereumLegacyTransactionType) ||
		(tx.EnvelopeType == EthereumAccessListTransferType && tx.TransactionType != EthereumAccessListType) ||
		(tx.EnvelopeType == EthereumDynamicFeeTransferType && tx.TransactionType != EthereumDynamicFeeType) {
		return errors.New("Ethereum transfer envelope identity is inconsistent")
	}
	if !IsNativeAddress(tx.From) || !IsNativeAddress(tx.To) || tx.From == tx.To {
		return errors.New("Ethereum transfer requires distinct canonical sender and recipient addresses")
	}
	if tx.Value <= 0 || tx.Fee <= 0 || tx.GasLimit != EthereumTransferGasLimit || tx.GasPrice == 0 || len(tx.Data) != 0 {
		return errors.New("Ethereum transfer is outside the bounded value-transfer profile")
	}
	if tx.GasPrice > uint64(math.MaxInt64)/tx.GasLimit || tx.Fee != int64(tx.GasPrice*tx.GasLimit) {
		return errors.New("Ethereum transfer fee does not match the bounded gas profile")
	}
	if tx.EnvelopeType == EthereumDynamicFeeTransferType {
		if tx.BaseFeePerGas != EthereumCompatibilityBaseFeePerGas || tx.MaxPriorityFeePerGas == 0 || tx.MaxPriorityFeePerGas > tx.MaxFeePerGas || tx.GasPrice != tx.MaxPriorityFeePerGas || tx.MaxFeePerGas > uint64(math.MaxInt64)/tx.GasLimit {
			return errors.New("Ethereum dynamic-fee transfer does not match the zero-base-fee compatibility profile")
		}
	} else if tx.MaxPriorityFeePerGas != 0 || tx.MaxFeePerGas != 0 || tx.BaseFeePerGas != 0 {
		return errors.New("non-dynamic Ethereum transfer contains dynamic fee metadata")
	}
	if tx.RecoveryID > 1 {
		return errors.New("Ethereum transfer recovery ID must be 0 or 1")
	}
	var zeroScalar [32]byte
	if tx.R == zeroScalar || tx.S == zeroScalar {
		return errors.New("Ethereum transfer signature scalars are required")
	}
	if tx.EnvelopeType == EthereumLegacyTransferType {
		if uint64(tx.ChainID) > (math.MaxUint64-36)/2 || tx.V != uint64(tx.ChainID)*2+35+uint64(tx.RecoveryID) {
			return errors.New("Ethereum legacy transfer EIP-155 signature metadata is inconsistent")
		}
	} else if tx.V != uint64(tx.RecoveryID) {
		return errors.New("Ethereum typed transfer y parity is inconsistent")
	}
	if tx.Hash == "" {
		return errors.New("Ethereum transaction hash is required")
	}
	return nil
}

func (tx EthereumValueTransfer) MaximumGasFee() (int64, error) {
	price := tx.GasPrice
	if tx.EnvelopeType == EthereumDynamicFeeTransferType {
		price = tx.MaxFeePerGas
	}
	if tx.GasLimit == 0 || price == 0 || price > uint64(math.MaxInt64)/tx.GasLimit {
		return 0, errors.New("Ethereum maximum gas fee exceeds the bounded YNXT amount")
	}
	return int64(price * tx.GasLimit), nil
}

func DecodeEthereumLegacyTransaction(payload []byte) (EthereumLegacyTransaction, error) {
	if len(payload) == 0 || len(payload) > MaxSignedTransactionSize {
		return EthereumLegacyTransaction{}, fmt.Errorf("Ethereum transaction size must be between 1 and %d bytes", MaxSignedTransactionSize)
	}
	if IsEthereumTypedEnvelope(payload) {
		return EthereumLegacyTransaction{}, errors.New("typed Ethereum transaction envelopes are not supported")
	}
	fields, err := decodeCanonicalRLPList(payload)
	if err != nil {
		return EthereumLegacyTransaction{}, fmt.Errorf("decode Ethereum legacy transaction: %w", err)
	}
	if len(fields) != 9 {
		return EthereumLegacyTransaction{}, fmt.Errorf("Ethereum legacy transaction requires 9 fields, got %d", len(fields))
	}
	nonce, err := decodeRLPUint(fields[0], "nonce")
	if err != nil {
		return EthereumLegacyTransaction{}, err
	}
	gasPrice, err := decodeRLPUint(fields[1], "gas price")
	if err != nil {
		return EthereumLegacyTransaction{}, err
	}
	gasLimit, err := decodeRLPUint(fields[2], "gas limit")
	if err != nil {
		return EthereumLegacyTransaction{}, err
	}
	if len(fields[3]) == 0 {
		return EthereumLegacyTransaction{}, errors.New("Ethereum contract creation is not supported")
	}
	if len(fields[3]) != 20 {
		return EthereumLegacyTransaction{}, errors.New("Ethereum transfer recipient must be exactly 20 bytes")
	}
	to, err := accountaddress.FromBytes(fields[3])
	if err != nil {
		return EthereumLegacyTransaction{}, fmt.Errorf("derive Ethereum recipient: %w", err)
	}
	value, err := decodeRLPUint(fields[4], "value")
	if err != nil {
		return EthereumLegacyTransaction{}, err
	}
	if value == 0 || value > math.MaxInt64 {
		return EthereumLegacyTransaction{}, errors.New("Ethereum transfer value must fit a positive YNXT amount")
	}
	if len(fields[5]) != 0 {
		return EthereumLegacyTransaction{}, errors.New("Ethereum transfer calldata is not supported")
	}
	v, err := decodeRLPUint(fields[6], "signature v")
	if err != nil {
		return EthereumLegacyTransaction{}, err
	}
	if v < 35 {
		return EthereumLegacyTransaction{}, errors.New("Ethereum legacy transaction must use EIP-155 replay protection")
	}
	recoveryID := (v - 35) % 2
	chainID := (v - 35 - recoveryID) / 2
	if chainID == 0 || chainID > math.MaxInt64 {
		return EthereumLegacyTransaction{}, errors.New("Ethereum legacy transaction chain ID is invalid")
	}
	if len(fields[7]) == 0 || len(fields[7]) > 32 || len(fields[8]) == 0 || len(fields[8]) > 32 {
		return EthereumLegacyTransaction{}, errors.New("Ethereum signature r and s must be 1 to 32 bytes")
	}
	var rScalar, sScalar secp256k1.ModNScalar
	if rScalar.SetByteSlice(fields[7]) || rScalar.IsZero() {
		return EthereumLegacyTransaction{}, errors.New("Ethereum signature r is outside the secp256k1 order")
	}
	if sScalar.SetByteSlice(fields[8]) || sScalar.IsZero() {
		return EthereumLegacyTransaction{}, errors.New("Ethereum signature s is outside the secp256k1 order")
	}
	if sScalar.IsOverHalfOrder() {
		return EthereumLegacyTransaction{}, errors.New("Ethereum signature is not canonical low-S")
	}
	var rValue, sValue [32]byte
	copy(rValue[len(rValue)-len(fields[7]):], fields[7])
	copy(sValue[len(sValue)-len(fields[8]):], fields[8])
	if gasLimit != EthereumTransferGasLimit {
		return EthereumLegacyTransaction{}, fmt.Errorf("bounded Ethereum transfer gas limit must equal %d", EthereumTransferGasLimit)
	}
	if gasPrice == 0 || gasPrice > uint64(math.MaxInt64)/gasLimit {
		return EthereumLegacyTransaction{}, errors.New("Ethereum gas price produces an invalid bounded fee")
	}
	unsigned := encodeRLPList(
		encodeRLPUint(nonce),
		encodeRLPUint(gasPrice),
		encodeRLPUint(gasLimit),
		encodeRLPBytes(fields[3]),
		encodeRLPUint(value),
		encodeRLPBytes(nil),
		encodeRLPUint(chainID),
		encodeRLPUint(0),
		encodeRLPUint(0),
	)
	digest := legacyKeccak(unsigned)
	compact := make([]byte, 65)
	compact[0] = 31 + byte(recoveryID)
	copy(compact[33-len(fields[7]):33], fields[7])
	copy(compact[65-len(fields[8]):], fields[8])
	publicKey, _, err := ecdsa.RecoverCompact(compact, digest)
	if err != nil {
		return EthereumLegacyTransaction{}, fmt.Errorf("recover Ethereum sender: %w", err)
	}
	from, err := NativeAddress(publicKey.SerializeCompressed())
	if err != nil {
		return EthereumLegacyTransaction{}, err
	}
	return EthereumLegacyTransaction{
		Nonce:      nonce,
		GasPrice:   gasPrice,
		GasLimit:   gasLimit,
		To:         to,
		Value:      int64(value),
		Data:       []byte{},
		ChainID:    int64(chainID),
		V:          v,
		R:          rValue,
		S:          sValue,
		RecoveryID: byte(recoveryID),
		From:       from,
		Fee:        int64(gasPrice * gasLimit),
		Hash:       EthereumTransactionHash(payload),
	}, nil
}

func (tx EthereumLegacyTransaction) Verify(expectedChainID int64) error {
	return tx.ValueTransfer().Verify(expectedChainID)
}

func DecodeEthereumAccessListTransaction(payload []byte) (EthereumAccessListTransaction, error) {
	if len(payload) < 2 || len(payload) > MaxSignedTransactionSize {
		return EthereumAccessListTransaction{}, fmt.Errorf("Ethereum access-list transaction size must be between 2 and %d bytes", MaxSignedTransactionSize)
	}
	if payload[0] != EthereumAccessListType {
		return EthereumAccessListTransaction{}, errors.New("Ethereum access-list transaction must use type 0x01")
	}
	fields, err := decodeCanonicalRLPFields(payload[1:])
	if err != nil {
		return EthereumAccessListTransaction{}, fmt.Errorf("decode Ethereum access-list transaction: %w", err)
	}
	if len(fields) != 11 {
		return EthereumAccessListTransaction{}, fmt.Errorf("Ethereum access-list transaction requires 11 fields, got %d", len(fields))
	}
	for _, index := range []int{0, 1, 2, 3, 4, 5, 6, 8, 9, 10} {
		if fields[index].isList {
			return EthereumAccessListTransaction{}, fmt.Errorf("Ethereum access-list field %d must not be a nested list", index)
		}
	}
	if !fields[7].isList {
		return EthereumAccessListTransaction{}, errors.New("Ethereum access list must be an RLP list")
	}
	if len(fields[7].content) != 0 {
		return EthereumAccessListTransaction{}, errors.New("non-empty Ethereum access lists are not supported")
	}
	chainID, err := decodeRLPUint(fields[0].content, "chain ID")
	if err != nil || chainID == 0 || chainID > math.MaxInt64 {
		return EthereumAccessListTransaction{}, errors.New("Ethereum access-list transaction chain ID is invalid")
	}
	nonce, err := decodeRLPUint(fields[1].content, "nonce")
	if err != nil {
		return EthereumAccessListTransaction{}, err
	}
	gasPrice, err := decodeRLPUint(fields[2].content, "gas price")
	if err != nil {
		return EthereumAccessListTransaction{}, err
	}
	gasLimit, err := decodeRLPUint(fields[3].content, "gas limit")
	if err != nil {
		return EthereumAccessListTransaction{}, err
	}
	if len(fields[4].content) == 0 {
		return EthereumAccessListTransaction{}, errors.New("Ethereum contract creation is not supported")
	}
	if len(fields[4].content) != 20 {
		return EthereumAccessListTransaction{}, errors.New("Ethereum transfer recipient must be exactly 20 bytes")
	}
	to, err := accountaddress.FromBytes(fields[4].content)
	if err != nil {
		return EthereumAccessListTransaction{}, fmt.Errorf("derive Ethereum recipient: %w", err)
	}
	value, err := decodeRLPUint(fields[5].content, "value")
	if err != nil {
		return EthereumAccessListTransaction{}, err
	}
	if value == 0 || value > math.MaxInt64 {
		return EthereumAccessListTransaction{}, errors.New("Ethereum transfer value must fit a positive YNXT amount")
	}
	if len(fields[6].content) != 0 {
		return EthereumAccessListTransaction{}, errors.New("Ethereum transfer calldata is not supported")
	}
	yParity, err := decodeRLPUint(fields[8].content, "signature y parity")
	if err != nil || yParity > 1 {
		return EthereumAccessListTransaction{}, errors.New("Ethereum access-list signature y parity must be 0 or 1")
	}
	if len(fields[9].content) == 0 || len(fields[9].content) > 32 || len(fields[10].content) == 0 || len(fields[10].content) > 32 {
		return EthereumAccessListTransaction{}, errors.New("Ethereum signature r and s must be 1 to 32 bytes")
	}
	var rScalar, sScalar secp256k1.ModNScalar
	if rScalar.SetByteSlice(fields[9].content) || rScalar.IsZero() {
		return EthereumAccessListTransaction{}, errors.New("Ethereum signature r is outside the secp256k1 order")
	}
	if sScalar.SetByteSlice(fields[10].content) || sScalar.IsZero() {
		return EthereumAccessListTransaction{}, errors.New("Ethereum signature s is outside the secp256k1 order")
	}
	if sScalar.IsOverHalfOrder() {
		return EthereumAccessListTransaction{}, errors.New("Ethereum signature is not canonical low-S")
	}
	if gasLimit != EthereumTransferGasLimit {
		return EthereumAccessListTransaction{}, fmt.Errorf("bounded Ethereum transfer gas limit must equal %d", EthereumTransferGasLimit)
	}
	if gasPrice == 0 || gasPrice > uint64(math.MaxInt64)/gasLimit {
		return EthereumAccessListTransaction{}, errors.New("Ethereum gas price produces an invalid bounded fee")
	}
	unsigned := encodeRLPList(
		encodeRLPUint(chainID), encodeRLPUint(nonce), encodeRLPUint(gasPrice), encodeRLPUint(gasLimit),
		encodeRLPBytes(fields[4].content), encodeRLPUint(value), encodeRLPBytes(nil), encodeRLPList(),
	)
	digest := legacyKeccak(append([]byte{EthereumAccessListType}, unsigned...))
	compact := make([]byte, 65)
	compact[0] = 31 + byte(yParity)
	copy(compact[33-len(fields[9].content):33], fields[9].content)
	copy(compact[65-len(fields[10].content):], fields[10].content)
	publicKey, _, err := ecdsa.RecoverCompact(compact, digest)
	if err != nil {
		return EthereumAccessListTransaction{}, fmt.Errorf("recover Ethereum sender: %w", err)
	}
	from, err := NativeAddress(publicKey.SerializeCompressed())
	if err != nil {
		return EthereumAccessListTransaction{}, err
	}
	var rValue, sValue [32]byte
	copy(rValue[len(rValue)-len(fields[9].content):], fields[9].content)
	copy(sValue[len(sValue)-len(fields[10].content):], fields[10].content)
	return EthereumAccessListTransaction{
		ChainID: int64(chainID), Nonce: nonce, GasPrice: gasPrice, GasLimit: gasLimit,
		To: to, Value: int64(value), Data: []byte{}, YParity: yParity,
		R: rValue, S: sValue, RecoveryID: byte(yParity), From: from,
		Fee: int64(gasPrice * gasLimit), Hash: EthereumTransactionHash(payload),
	}, nil
}

func (tx EthereumAccessListTransaction) Verify(expectedChainID int64) error {
	return tx.ValueTransfer().Verify(expectedChainID)
}

func DecodeEthereumDynamicFeeTransaction(payload []byte) (EthereumDynamicFeeTransaction, error) {
	if len(payload) < 2 || len(payload) > MaxSignedTransactionSize {
		return EthereumDynamicFeeTransaction{}, fmt.Errorf("Ethereum dynamic-fee transaction size must be between 2 and %d bytes", MaxSignedTransactionSize)
	}
	if payload[0] != EthereumDynamicFeeType {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic-fee transaction must use type 0x02")
	}
	fields, err := decodeCanonicalRLPFields(payload[1:])
	if err != nil {
		return EthereumDynamicFeeTransaction{}, fmt.Errorf("decode Ethereum dynamic-fee transaction: %w", err)
	}
	if len(fields) != 12 {
		return EthereumDynamicFeeTransaction{}, fmt.Errorf("Ethereum dynamic-fee transaction requires 12 fields, got %d", len(fields))
	}
	for _, index := range []int{0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11} {
		if fields[index].isList {
			return EthereumDynamicFeeTransaction{}, fmt.Errorf("Ethereum dynamic-fee field %d must not be a nested list", index)
		}
	}
	if !fields[8].isList {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic-fee access list must be an RLP list")
	}
	if len(fields[8].content) != 0 {
		return EthereumDynamicFeeTransaction{}, errors.New("non-empty Ethereum dynamic-fee access lists are not supported")
	}
	chainID, err := decodeRLPUint(fields[0].content, "chain ID")
	if err != nil || chainID == 0 || chainID > math.MaxInt64 {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic-fee transaction chain ID is invalid")
	}
	nonce, err := decodeRLPUint(fields[1].content, "nonce")
	if err != nil {
		return EthereumDynamicFeeTransaction{}, err
	}
	maxPriorityFeePerGas, err := decodeRLPUint(fields[2].content, "max priority fee per gas")
	if err != nil {
		return EthereumDynamicFeeTransaction{}, err
	}
	maxFeePerGas, err := decodeRLPUint(fields[3].content, "max fee per gas")
	if err != nil {
		return EthereumDynamicFeeTransaction{}, err
	}
	if maxPriorityFeePerGas == 0 || maxPriorityFeePerGas > maxFeePerGas {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic fee requires 0 < maxPriorityFeePerGas <= maxFeePerGas")
	}
	gasLimit, err := decodeRLPUint(fields[4].content, "gas limit")
	if err != nil {
		return EthereumDynamicFeeTransaction{}, err
	}
	if gasLimit != EthereumTransferGasLimit {
		return EthereumDynamicFeeTransaction{}, fmt.Errorf("bounded Ethereum transfer gas limit must equal %d", EthereumTransferGasLimit)
	}
	if maxFeePerGas > uint64(math.MaxInt64)/gasLimit {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic fee maximum produces an invalid bounded exposure")
	}
	if len(fields[5].content) == 0 {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum contract creation is not supported")
	}
	if len(fields[5].content) != 20 {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum transfer recipient must be exactly 20 bytes")
	}
	to, err := accountaddress.FromBytes(fields[5].content)
	if err != nil {
		return EthereumDynamicFeeTransaction{}, fmt.Errorf("derive Ethereum recipient: %w", err)
	}
	value, err := decodeRLPUint(fields[6].content, "value")
	if err != nil {
		return EthereumDynamicFeeTransaction{}, err
	}
	if value == 0 || value > math.MaxInt64 {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum transfer value must fit a positive YNXT amount")
	}
	if len(fields[7].content) != 0 {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum transfer calldata is not supported")
	}
	yParity, err := decodeRLPUint(fields[9].content, "signature y parity")
	if err != nil || yParity > 1 {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum dynamic-fee signature y parity must be 0 or 1")
	}
	if len(fields[10].content) == 0 || len(fields[10].content) > 32 || len(fields[11].content) == 0 || len(fields[11].content) > 32 {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum signature r and s must be 1 to 32 bytes")
	}
	var rScalar, sScalar secp256k1.ModNScalar
	if rScalar.SetByteSlice(fields[10].content) || rScalar.IsZero() {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum signature r is outside the secp256k1 order")
	}
	if sScalar.SetByteSlice(fields[11].content) || sScalar.IsZero() {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum signature s is outside the secp256k1 order")
	}
	if sScalar.IsOverHalfOrder() {
		return EthereumDynamicFeeTransaction{}, errors.New("Ethereum signature is not canonical low-S")
	}
	unsigned := encodeRLPList(
		encodeRLPUint(chainID), encodeRLPUint(nonce), encodeRLPUint(maxPriorityFeePerGas), encodeRLPUint(maxFeePerGas),
		encodeRLPUint(gasLimit), encodeRLPBytes(fields[5].content), encodeRLPUint(value), encodeRLPBytes(nil), encodeRLPList(),
	)
	digest := legacyKeccak(append([]byte{EthereumDynamicFeeType}, unsigned...))
	compact := make([]byte, 65)
	compact[0] = 31 + byte(yParity)
	copy(compact[33-len(fields[10].content):33], fields[10].content)
	copy(compact[65-len(fields[11].content):], fields[11].content)
	publicKey, _, err := ecdsa.RecoverCompact(compact, digest)
	if err != nil {
		return EthereumDynamicFeeTransaction{}, fmt.Errorf("recover Ethereum sender: %w", err)
	}
	from, err := NativeAddress(publicKey.SerializeCompressed())
	if err != nil {
		return EthereumDynamicFeeTransaction{}, err
	}
	var rValue, sValue [32]byte
	copy(rValue[len(rValue)-len(fields[10].content):], fields[10].content)
	copy(sValue[len(sValue)-len(fields[11].content):], fields[11].content)
	effectiveGasPrice := maxPriorityFeePerGas + EthereumCompatibilityBaseFeePerGas
	if effectiveGasPrice > maxFeePerGas {
		effectiveGasPrice = maxFeePerGas
	}
	return EthereumDynamicFeeTransaction{
		ChainID: int64(chainID), Nonce: nonce, MaxPriorityFeePerGas: maxPriorityFeePerGas,
		MaxFeePerGas: maxFeePerGas, EffectiveGasPrice: effectiveGasPrice, GasLimit: gasLimit,
		To: to, Value: int64(value), Data: []byte{}, YParity: yParity,
		R: rValue, S: sValue, RecoveryID: byte(yParity), From: from,
		Fee: int64(effectiveGasPrice * gasLimit), Hash: EthereumTransactionHash(payload),
	}, nil
}

func (tx EthereumDynamicFeeTransaction) Verify(expectedChainID int64) error {
	return tx.ValueTransfer().Verify(expectedChainID)
}

type canonicalRLPField struct {
	isList  bool
	content []byte
}

func decodeCanonicalRLPFields(payload []byte) ([]canonicalRLPField, error) {
	isList, content, consumed, err := decodeCanonicalRLPItem(payload)
	if err != nil {
		return nil, err
	}
	if !isList || consumed != len(payload) {
		return nil, errors.New("top-level RLP value must be one canonical list")
	}
	fields := make([]canonicalRLPField, 0, 11)
	for len(content) > 0 {
		nested, field, used, err := decodeCanonicalRLPItem(content)
		if err != nil {
			return nil, err
		}
		fields = append(fields, canonicalRLPField{isList: nested, content: append([]byte(nil), field...)})
		content = content[used:]
	}
	return fields, nil
}

func decodeCanonicalRLPList(payload []byte) ([][]byte, error) {
	fields, err := decodeCanonicalRLPFields(payload)
	if err != nil {
		return nil, err
	}
	values := make([][]byte, 0, len(fields))
	for _, field := range fields {
		if field.isList {
			return nil, errors.New("Ethereum legacy transaction fields must not be nested lists")
		}
		values = append(values, field.content)
	}
	return values, nil
}

func decodeCanonicalRLPItem(input []byte) (bool, []byte, int, error) {
	if len(input) == 0 {
		return false, nil, 0, errors.New("truncated RLP item")
	}
	prefix := input[0]
	switch {
	case prefix <= 0x7f:
		return false, input[:1], 1, nil
	case prefix <= 0xb7:
		length := int(prefix - 0x80)
		if len(input) < 1+length {
			return false, nil, 0, errors.New("truncated short RLP string")
		}
		content := input[1 : 1+length]
		if length == 1 && content[0] <= 0x7f {
			return false, nil, 0, errors.New("non-canonical single-byte RLP string")
		}
		return false, content, 1 + length, nil
	case prefix <= 0xbf:
		length, header, err := decodeRLPLongLength(input, int(prefix-0xb7))
		if err != nil {
			return false, nil, 0, err
		}
		if length < 56 || len(input) < header+length {
			return false, nil, 0, errors.New("invalid long RLP string length")
		}
		return false, input[header : header+length], header + length, nil
	case prefix <= 0xf7:
		length := int(prefix - 0xc0)
		if len(input) < 1+length {
			return false, nil, 0, errors.New("truncated short RLP list")
		}
		return true, input[1 : 1+length], 1 + length, nil
	default:
		length, header, err := decodeRLPLongLength(input, int(prefix-0xf7))
		if err != nil {
			return false, nil, 0, err
		}
		if length < 56 || len(input) < header+length {
			return false, nil, 0, errors.New("invalid long RLP list length")
		}
		return true, input[header : header+length], header + length, nil
	}
}

func decodeRLPLongLength(input []byte, lengthOfLength int) (int, int, error) {
	if lengthOfLength < 1 || lengthOfLength > 8 || len(input) < 1+lengthOfLength || input[1] == 0 {
		return 0, 0, errors.New("non-canonical RLP length")
	}
	var length uint64
	for _, value := range input[1 : 1+lengthOfLength] {
		if length > (math.MaxUint64-uint64(value))/256 {
			return 0, 0, errors.New("RLP length overflow")
		}
		length = length*256 + uint64(value)
	}
	if length > uint64(len(input)) || length > uint64(math.MaxInt) {
		return 0, 0, errors.New("RLP item exceeds bounded payload")
	}
	return int(length), 1 + lengthOfLength, nil
}

func decodeRLPUint(value []byte, field string) (uint64, error) {
	if len(value) == 0 {
		return 0, nil
	}
	if value[0] == 0 {
		return 0, fmt.Errorf("Ethereum %s has a leading zero", field)
	}
	if len(value) > 8 {
		return 0, fmt.Errorf("Ethereum %s exceeds uint64", field)
	}
	var result uint64
	for _, item := range value {
		result = result*256 + uint64(item)
	}
	return result, nil
}

func encodeRLPUint(value uint64) []byte {
	if value == 0 {
		return encodeRLPBytes(nil)
	}
	var buffer [8]byte
	index := len(buffer)
	for value > 0 {
		index--
		buffer[index] = byte(value)
		value >>= 8
	}
	return encodeRLPBytes(buffer[index:])
}

func encodeRLPBytes(value []byte) []byte {
	if len(value) == 1 && value[0] <= 0x7f {
		return append([]byte(nil), value...)
	}
	if len(value) <= 55 {
		return append([]byte{0x80 + byte(len(value))}, value...)
	}
	length := encodeRLPSize(len(value))
	out := make([]byte, 0, 1+len(length)+len(value))
	out = append(out, 0xb7+byte(len(length)))
	out = append(out, length...)
	return append(out, value...)
}

func encodeRLPList(items ...[]byte) []byte {
	content := bytes.Join(items, nil)
	if len(content) <= 55 {
		return append([]byte{0xc0 + byte(len(content))}, content...)
	}
	length := encodeRLPSize(len(content))
	out := make([]byte, 0, 1+len(length)+len(content))
	out = append(out, 0xf7+byte(len(length)))
	out = append(out, length...)
	return append(out, content...)
}

func encodeRLPSize(value int) []byte {
	var buffer [8]byte
	index := len(buffer)
	for value > 0 {
		index--
		buffer[index] = byte(value)
		value >>= 8
	}
	return append([]byte(nil), buffer[index:]...)
}

func legacyKeccak(payload []byte) []byte {
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(payload)
	return hasher.Sum(nil)
}

func trimLeadingZeroes(value []byte) []byte {
	for len(value) > 0 && value[0] == 0 {
		value = value[1:]
	}
	return value
}
