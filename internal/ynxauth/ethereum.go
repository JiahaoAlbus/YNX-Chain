package ynxauth

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	EthereumValueDomain                  = "YNX-ETHEREUM-VALUE/v1"
	EthereumValueVersion          uint32 = 1
	EthereumABCIIntegerGasProfile        = "ABCI-INTEGER-GAS/v1"
	EthereumValueTransferGasLimit uint64 = 21_000
	// This profile has fixed-width addresses, seven u64 pairs and two empty
	// byte fields. Every valid message is exactly 316 bytes, including E framing.
	MaxEthereumValueIntentBytes = 316
	ethereumValueFieldCount     = 23
)

var ErrEthereumValueIntent = errors.New("invalid Ethereum value intent")

// EthereumValueIntent is a complete TX-BATCH message for the existing bounded
// ABCI value-transfer semantics. It is not an Ethereum signed RLP transaction,
// and it contains no fabricated ECDSA signature or recovered address. Owner
// must be authenticated against the current trusted account policy by callers.
//
// Value and fees are integer YNXT, not wei. Types 0/1 use GasPrice and require
// both dynamic price fields to be zero. Type 2 requires GasPrice to be zero;
// its effective price is MaxPriorityFeePerGas at the fixed zero base fee.
// Data and AccessList are separate zero-length E fields, not RLP or nested E.
// Nonce is the Ethereum current-account nonce, including zero; exhaustion and
// the actual current value remain ledger checks. This type grants no authority.
type EthereumValueIntent struct {
	Profile              string
	ChainID              []byte
	NativeChainID        uint64
	Owner                string
	TxType               uint32
	To                   string
	Value                uint64
	Nonce                uint64
	GasLimit             uint64
	GasPrice             uint64
	MaxPriorityFeePerGas uint64
	MaxFeePerGas         uint64
	Data                 []byte
	AccessList           []byte
}

func invalidEthereumValue(reason string) error {
	return fmt.Errorf("%w: %s", ErrEthereumValueIntent, reason)
}

func (v EthereumValueIntent) Validate() error {
	if v.Profile != EthereumABCIIntegerGasProfile || len(v.ChainID) != 32 || v.NativeChainID == 0 || v.NativeChainID > math.MaxInt64 {
		return invalidEthereumValue("profile or network")
	}
	if !accountaddress.IsCanonical(v.Owner) || !accountaddress.IsCanonical(v.To) || v.Owner == v.To {
		return invalidEthereumValue("distinct canonical owner and recipient required")
	}
	if v.TxType > 2 || v.Value == 0 || v.Value > math.MaxInt64 || v.GasLimit != EthereumValueTransferGasLimit || len(v.Data) != 0 || len(v.AccessList) != 0 {
		return invalidEthereumValue("outside the bounded simple value-transfer profile")
	}
	// Keep the existing type-0 chain range even though this authorization does
	// not encode EIP-155 V or require a classic key after PQ activation.
	if v.TxType == 0 && v.NativeChainID > (math.MaxUint64-36)/2 {
		return invalidEthereumValue("type-0 chain ID exceeds the existing bounded range")
	}
	maximumPrice := v.GasPrice
	if v.TxType == 2 {
		if v.GasPrice != 0 || v.MaxPriorityFeePerGas == 0 || v.MaxPriorityFeePerGas > v.MaxFeePerGas {
			return invalidEthereumValue("dynamic price fields")
		}
		maximumPrice = v.MaxFeePerGas
	} else if v.GasPrice == 0 || v.MaxPriorityFeePerGas != 0 || v.MaxFeePerGas != 0 {
		return invalidEthereumValue("legacy or access-list price fields")
	}
	if maximumPrice > uint64(math.MaxInt64)/v.GasLimit {
		return invalidEthereumValue("maximum gas exposure overflows the ledger")
	}
	// The effective type-2 fee cannot exceed this exposure because priority <=
	// maxFee. Check before multiplying or adding, without wrapping uint64.
	maximumFee := maximumPrice * v.GasLimit
	if v.Value > uint64(math.MaxInt64)-maximumFee {
		return invalidEthereumValue("value plus maximum gas exposure overflows the ledger")
	}
	return nil
}

// SigningBytes returns a detached canonical E frame. Field order is frozen:
// domain, version, profile, network32, chain hi/lo, owner, type, to,
// value hi/lo, nonce hi/lo, gasLimit hi/lo, gasPrice hi/lo,
// priority hi/lo, maxFee hi/lo, complete data, complete access list.
func (v EthereumValueIntent) SigningBytes() ([]byte, error) {
	if err := v.Validate(); err != nil {
		return nil, err
	}
	fields := [][]byte{[]byte(EthereumValueDomain), ynxbatch.U32(EthereumValueVersion), []byte(v.Profile), v.ChainID}
	fields = append(fields, pair(v.NativeChainID)...)
	fields = append(fields, []byte(v.Owner), ynxbatch.U32(v.TxType), []byte(v.To))
	for _, number := range []uint64{v.Value, v.Nonce, v.GasLimit, v.GasPrice, v.MaxPriorityFeePerGas, v.MaxFeePerGas} {
		fields = append(fields, pair(number)...)
	}
	fields = append(fields, v.Data, v.AccessList)
	return ynxbatch.EncodeFields(fields...)
}

// DecodeEthereumValueIntent checks size and field count before allocation,
// returns detached bytes, and rejects every noncanonical alternate spelling.
func DecodeEthereumValueIntent(input []byte) (EthereumValueIntent, error) {
	var v EthereumValueIntent
	f, err := frame(input, ethereumValueFieldCount, MaxEthereumValueIntentBytes)
	if err != nil {
		return v, invalidEthereumValue("framing")
	}
	if string(f[0]) != EthereumValueDomain || !bytes.Equal(f[1], ynxbatch.U32(EthereumValueVersion)) || len(f[7]) != 4 {
		return v, invalidEthereumValue("domain, version or type width")
	}
	v.Profile, v.ChainID, v.Owner, v.To = string(f[2]), f[3], string(f[6]), string(f[8])
	v.TxType = binary.BigEndian.Uint32(f[7])
	v.NativeChainID, err = readPair(f[4], f[5])
	if err != nil {
		return EthereumValueIntent{}, invalidEthereumValue("native chain width")
	}
	values := []*uint64{&v.Value, &v.Nonce, &v.GasLimit, &v.GasPrice, &v.MaxPriorityFeePerGas, &v.MaxFeePerGas}
	for i, value := range values {
		*value, err = readPair(f[9+2*i], f[10+2*i])
		if err != nil {
			return EthereumValueIntent{}, invalidEthereumValue("integer width")
		}
	}
	v.Data, v.AccessList = f[21], f[22]
	canonical, err := v.SigningBytes()
	if err != nil {
		return EthereumValueIntent{}, err
	}
	if !bytes.Equal(canonical, input) {
		return EthereumValueIntent{}, invalidEthereumValue("noncanonical bytes")
	}
	return v, nil
}
