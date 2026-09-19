// Package ethnative verifies the explicitly bounded Ethereum legacy-envelope
// adapter for whole-YNXT native transfers. It is not an EVM execution engine.
package ethnative

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

const (
	TransferGas uint64 = 25_000
	GasPriceWei int64  = 40_000_000_000_000
	MaxGasLimit uint64 = 30_000_000
	MaxRawBytes        = 1024
	// Existing snapshots already persist and authenticate Memo. Keeping the raw
	// envelope here adds no unknown fields to their version-2 integrity encoding.
	MemoPrefix = "YNX_ETHEREUM_LEGACY_V1:"
)

func WeiPerYNXT() *big.Int       { return new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil) }
func Wei(amount int64) *big.Int  { return new(big.Int).Mul(big.NewInt(amount), WeiPerYNXT()) }
func Quantity(n *big.Int) string { return "0x" + n.Text(16) }

func ParseQuantity(value string) (*big.Int, error) {
	if !strings.HasPrefix(value, "0x") || len(value) < 3 || len(value) > 66 || (len(value) > 3 && value[2] == '0') {
		return nil, errors.New("expected a canonical uint256 hex quantity")
	}
	for _, c := range value[2:] {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return nil, errors.New("expected lowercase hex quantity")
		}
	}
	n, ok := new(big.Int).SetString(value[2:], 16)
	if !ok {
		return nil, errors.New("invalid quantity")
	}
	return n, nil
}

func NativeAmount(value *big.Int) (int64, error) {
	if value == nil || value.Sign() <= 0 {
		return 0, errors.New("native transfer value must be positive")
	}
	amount, remainder := new(big.Int), new(big.Int)
	amount.QuoRem(value, WeiPerYNXT(), remainder)
	if remainder.Sign() != 0 {
		return 0, errors.New("fractional YNXT is not supported by the native integer ledger")
	}
	if !amount.IsInt64() || amount.Int64() > math.MaxInt64-1 {
		return 0, errors.New("amount plus fixed fee exceeds native ledger range")
	}
	return amount.Int64(), nil
}

type Transfer struct {
	Hash, From, To           string
	Nonce, Gas               uint64
	Value, GasPrice, V, R, S *big.Int
	Amount                   int64
	Raw                      []byte
}

// Decode verifies canonical RLP and EIP-155/low-S signatures before returning
// any sender or normalized fields. No unprotected or typed envelope is accepted.
func Decode(raw []byte, chainID int64) (Transfer, error) {
	var tx Transfer
	if chainID <= 0 || len(raw) == 0 || len(raw) > MaxRawBytes {
		return tx, errors.New("invalid chain ID or raw transaction size")
	}
	fields, err := decodeList(raw)
	if err != nil {
		return tx, err
	}
	if len(fields) != 9 {
		return tx, errors.New("legacy transaction requires exactly nine RLP fields")
	}
	values := make([]*big.Int, 9)
	for _, i := range []int{0, 1, 2, 4, 6, 7, 8} {
		if len(fields[i]) > 32 || len(fields[i]) > 0 && fields[i][0] == 0 {
			return tx, errors.New("noncanonical or oversized RLP integer")
		}
		values[i] = new(big.Int).SetBytes(fields[i])
	}
	if !values[0].IsUint64() || values[0].Uint64() == math.MaxUint64 || !values[2].IsUint64() {
		return tx, errors.New("nonce or gas exceeds native adapter range")
	}
	if len(fields[3]) != 20 || len(fields[5]) != 0 {
		return tx, errors.New("only plain transfers to 20-byte recipients are supported; contract creation and calldata are unsupported")
	}
	baseV := new(big.Int).Add(new(big.Int).Mul(big.NewInt(chainID), big.NewInt(2)), big.NewInt(35))
	recovery := new(big.Int).Sub(values[6], baseV)
	if !recovery.IsUint64() || recovery.Uint64() > 1 {
		return tx, errors.New("EIP-155 signature chain ID mismatch or unprotected signature")
	}
	order := secp256k1.Params().N
	if values[7].Sign() <= 0 || values[7].Cmp(order) >= 0 || values[8].Sign() <= 0 || values[8].Cmp(new(big.Int).Rsh(new(big.Int).Set(order), 1)) > 0 {
		return tx, errors.New("invalid or noncanonical low-S signature")
	}
	signFields := append([][]byte(nil), fields[:6]...)
	signFields = append(signFields, big.NewInt(chainID).Bytes(), nil, nil)
	digest := keccak(encodeList(signFields))
	compact := make([]byte, 65)
	compact[0] = 27 + byte(recovery.Uint64())
	values[7].FillBytes(compact[1:33])
	values[8].FillBytes(compact[33:])
	key, _, err := ecdsa.RecoverCompact(compact, digest)
	if err != nil {
		return tx, fmt.Errorf("recover Ethereum signature: %w", err)
	}
	addressHash := keccak(key.SerializeUncompressed()[1:])
	tx = Transfer{Hash: "0x" + hex.EncodeToString(keccak(raw)), From: "0x" + hex.EncodeToString(addressHash[12:]), To: "0x" + hex.EncodeToString(fields[3]), Nonce: values[0].Uint64(), Gas: values[2].Uint64(), Value: values[4], GasPrice: values[1], V: values[6], R: values[7], S: values[8], Raw: append([]byte(nil), raw...)}
	return tx, nil
}

func Verify(raw []byte, chainID int64) (Transfer, error) {
	tx, err := Decode(raw, chainID)
	if err != nil {
		return tx, err
	}
	if tx.From == tx.To {
		return tx, errors.New("native sender and recipient must differ")
	}
	if tx.Gas < TransferGas || tx.Gas > MaxGasLimit {
		return tx, errors.New("native transfer gas limit must be between 25000 and 30000000")
	}
	if tx.GasPrice.Cmp(big.NewInt(GasPriceWei)) != 0 {
		return tx, errors.New("native adapter gasPrice must equal 40000000000000 wei for the fixed 1 YNXT fee")
	}
	tx.Amount, err = NativeAmount(tx.Value)
	return tx, err
}

func FromMemo(memo string, chainID int64) (Transfer, bool, error) {
	if !strings.HasPrefix(memo, MemoPrefix) {
		return Transfer{}, false, nil
	}
	hexRaw := strings.TrimPrefix(memo, MemoPrefix)
	if len(hexRaw) > MaxRawBytes*2 || hexRaw != strings.ToLower(hexRaw) {
		return Transfer{}, true, errors.New("invalid Ethereum memo encoding")
	}
	raw, err := hex.DecodeString(hexRaw)
	if err != nil {
		return Transfer{}, true, err
	}
	tx, err := Verify(raw, chainID)
	return tx, true, err
}

func keccak(data []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(data)
	return h.Sum(nil)
}

// These bounded RLP helpers accept one flat list only, never recursive input.
func decodeList(raw []byte) ([][]byte, error) {
	payload, rest, list, err := item(raw)
	if err != nil || !list || len(rest) != 0 {
		return nil, errors.New("expected one canonical legacy RLP list; typed transactions are unsupported")
	}
	var fields [][]byte
	for len(payload) > 0 {
		value, remaining, nested, err := item(payload)
		if err != nil || nested || len(fields) >= 9 {
			return nil, errors.New("invalid legacy RLP field")
		}
		fields = append(fields, value)
		payload = remaining
	}
	return fields, nil
}

func item(raw []byte) ([]byte, []byte, bool, error) {
	fail := func() ([]byte, []byte, bool, error) {
		return nil, nil, false, errors.New("invalid or noncanonical RLP")
	}
	if len(raw) == 0 {
		return fail()
	}
	if raw[0] <= 0x7f {
		return raw[:1], raw[1:], false, nil
	}
	list := raw[0] >= 0xc0
	base := byte(0x80)
	if list {
		base = 0xc0
	}
	n := int(raw[0] - base)
	offset := 1
	if n > 55 {
		lengthBytes := n - 55
		if lengthBytes > 4 || len(raw) < 1+lengthBytes || raw[1] == 0 {
			return fail()
		}
		n = 0
		for _, b := range raw[1 : 1+lengthBytes] {
			n = n*256 + int(b)
		}
		offset += lengthBytes
		if n < 56 {
			return fail()
		}
	}
	if n > len(raw)-offset {
		return fail()
	}
	value := raw[offset : offset+n]
	if !list && n == 1 && value[0] < 0x80 {
		return fail()
	}
	return value, raw[offset+n:], list, nil
}

func encodeList(fields [][]byte) []byte {
	var payload []byte
	for _, field := range fields {
		if len(field) == 1 && field[0] < 0x80 {
			payload = append(payload, field...)
			continue
		}
		payload = append(payload, prefix(len(field), 0x80)...)
		payload = append(payload, field...)
	}
	return append(prefix(len(payload), 0xc0), payload...)
}
func prefix(length int, base byte) []byte {
	if length < 56 {
		return []byte{base + byte(length)}
	}
	b := new(big.Int).SetInt64(int64(length)).Bytes()
	return append([]byte{base + 55 + byte(len(b))}, b...)
}

func Matches(tx Transfer, hash, from, to string, amount, fee int64, nonce uint64) bool {
	return tx.Hash == hash && tx.From == from && tx.To == to && tx.Amount == amount && fee == 1 && tx.Nonce+1 == nonce
}
