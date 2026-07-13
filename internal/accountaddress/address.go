package accountaddress

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	HRP           = "ynx"
	PayloadLength = 20
	checksumSize  = 6
	maxLength     = 90
)

const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

var charsetReverse = func() [128]byte {
	var table [128]byte
	for i := range table {
		table[i] = 0xff
	}
	for i := range charset {
		table[charset[i]] = byte(i)
	}
	return table
}()

// Normalize returns the canonical lowercase EVM representation for either a
// 20-byte hex address or its checksummed YNX Bech32 alias.
func Normalize(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) >= 4 && strings.EqualFold(value[:4], HRP+"1") {
		return Decode(value)
	}
	payload, err := decodeHex(value)
	if err != nil {
		return "", err
	}
	return FromBytes(payload)
}

func Encode(value string) (string, error) {
	payload, err := decodeHex(strings.TrimSpace(value))
	if err != nil {
		return "", err
	}
	data, err := convertBits(payload, 8, 5, true)
	if err != nil {
		return "", err
	}
	checksum := createChecksum(HRP, data)
	var out strings.Builder
	out.Grow(len(HRP) + 1 + len(data) + checksumSize)
	out.WriteString(HRP)
	out.WriteByte('1')
	for _, value := range append(data, checksum...) {
		out.WriteByte(charset[value])
	}
	return out.String(), nil
}

func Decode(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) > maxLength {
		return "", errors.New("YNX address exceeds Bech32 maximum length")
	}
	if value != strings.ToLower(value) && value != strings.ToUpper(value) {
		return "", errors.New("YNX address must not mix uppercase and lowercase")
	}
	value = strings.ToLower(value)
	separator := strings.LastIndexByte(value, '1')
	if separator <= 0 || separator+1+checksumSize > len(value) {
		return "", errors.New("YNX address has an invalid Bech32 separator or checksum length")
	}
	if value[:separator] != HRP {
		return "", fmt.Errorf("YNX address HRP must be %q", HRP)
	}
	data := make([]byte, len(value)-separator-1)
	for i, character := range []byte(value[separator+1:]) {
		if character >= byte(len(charsetReverse)) || charsetReverse[character] == 0xff {
			return "", errors.New("YNX address contains an invalid Bech32 character")
		}
		data[i] = charsetReverse[character]
	}
	if !verifyChecksum(HRP, data) {
		return "", errors.New("YNX address checksum is invalid")
	}
	payload, err := convertBits(data[:len(data)-checksumSize], 5, 8, false)
	if err != nil {
		return "", fmt.Errorf("decode YNX address payload: %w", err)
	}
	if len(payload) != PayloadLength {
		return "", fmt.Errorf("YNX address payload must be %d bytes", PayloadLength)
	}
	return FromBytes(payload)
}

func FromBytes(payload []byte) (string, error) {
	if len(payload) != PayloadLength {
		return "", fmt.Errorf("account address must be %d bytes", PayloadLength)
	}
	return "0x" + hex.EncodeToString(payload), nil
}

func IsCanonical(value string) bool {
	if len(value) != 2+PayloadLength*2 || !strings.HasPrefix(value, "0x") {
		return false
	}
	for _, character := range value[2:] {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func decodeHex(value string) ([]byte, error) {
	if len(value) != 2+PayloadLength*2 || !(strings.HasPrefix(value, "0x") || strings.HasPrefix(value, "0X")) {
		return nil, fmt.Errorf("account address must be 0x-prefixed with %d hex characters", PayloadLength*2)
	}
	payload, err := hex.DecodeString(value[2:])
	if err != nil || len(payload) != PayloadLength {
		return nil, fmt.Errorf("account address must be 0x-prefixed with %d hex characters", PayloadLength*2)
	}
	return payload, nil
}

func hrpExpand(hrp string) []byte {
	expanded := make([]byte, 0, len(hrp)*2+1)
	for _, character := range []byte(hrp) {
		expanded = append(expanded, character>>5)
	}
	expanded = append(expanded, 0)
	for _, character := range []byte(hrp) {
		expanded = append(expanded, character&31)
	}
	return expanded
}

func polymod(values []byte) uint32 {
	generators := [5]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	checksum := uint32(1)
	for _, value := range values {
		top := checksum >> 25
		checksum = (checksum&0x1ffffff)<<5 ^ uint32(value)
		for i, generator := range generators {
			if (top>>i)&1 == 1 {
				checksum ^= generator
			}
		}
	}
	return checksum
}

func createChecksum(hrp string, data []byte) []byte {
	values := append(hrpExpand(hrp), data...)
	values = append(values, make([]byte, checksumSize)...)
	mod := polymod(values) ^ 1
	checksum := make([]byte, checksumSize)
	for i := range checksum {
		checksum[i] = byte(mod >> (5 * (checksumSize - 1 - i)) & 31)
	}
	return checksum
}

func verifyChecksum(hrp string, data []byte) bool {
	return polymod(append(hrpExpand(hrp), data...)) == 1
}

func convertBits(data []byte, fromBits, toBits uint, pad bool) ([]byte, error) {
	var accumulator uint32
	var bits uint
	maxValue := uint32(1<<toBits) - 1
	maxAccumulator := uint32(1<<(fromBits+toBits-1)) - 1
	result := make([]byte, 0, (len(data)*int(fromBits)+int(toBits)-1)/int(toBits))
	for _, value := range data {
		if value>>fromBits != 0 {
			return nil, errors.New("address payload value exceeds conversion bit width")
		}
		accumulator = (accumulator<<fromBits | uint32(value)) & maxAccumulator
		bits += fromBits
		for bits >= toBits {
			bits -= toBits
			result = append(result, byte(accumulator>>bits&maxValue))
		}
	}
	if pad {
		if bits > 0 {
			result = append(result, byte(accumulator<<(toBits-bits)&maxValue))
		}
	} else if bits >= fromBits || byte(accumulator<<(toBits-bits)&maxValue) != 0 {
		return nil, errors.New("address payload has invalid Bech32 padding")
	}
	return result, nil
}
