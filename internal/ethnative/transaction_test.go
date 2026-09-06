package ethnative

import (
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"strings"
	"testing"
)

func TestIndependentEthersVectors(t *testing.T) {
	data, err := os.ReadFile("../../testdata/ethereum-native/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Vectors []struct {
			Name, Raw, Hash, Sender string
			Valid                   bool
		}
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixture.Vectors {
		t.Run(v.Name, func(t *testing.T) {
			raw, _ := hex.DecodeString(strings.TrimPrefix(v.Raw, "0x"))
			tx, err := Verify(raw, 6423)
			if !v.Valid {
				if err == nil {
					t.Fatal("unsupported vector accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if tx.Hash != v.Hash || tx.From != v.Sender || tx.Amount != 2 {
				t.Fatalf("independent hash/sender/value mismatch: %+v", tx)
			}
			if new(big.Int).Mul(new(big.Int).SetUint64(TransferGas), tx.GasPrice).Cmp(Wei(1)) != 0 {
				t.Fatal("quote differs from fixed ledger charge")
			}
		})
	}
}

func TestOfficialEIP155Vector(t *testing.T) {
	// https://eips.ethereum.org/EIPS/eip-155 example; structural decoder is
	// independently checked before the YNX-specific fee policy is applied.
	raw, _ := hex.DecodeString("f86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83")
	tx, err := Decode(raw, 1)
	if err != nil {
		t.Fatal(err)
	}
	if tx.From != "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f" || tx.Nonce != 9 {
		t.Fatalf("EIP-155 recovery mismatch: %+v", tx)
	}
	if _, err := Decode(raw, 6423); err == nil {
		t.Fatal("wrong chain accepted")
	}
}

func TestMalformedRLPAndSignature(t *testing.T) {
	for _, value := range []string{"", "01", "c0", "f800", "f90100", "c28101", "c1c0", "c18000", "b80180", "ff0000000000000001"} {
		raw, _ := hex.DecodeString(value)
		if _, err := Decode(raw, 6423); err == nil {
			t.Fatalf("malformed RLP accepted: %s", value)
		}
	}
	data, _ := os.ReadFile("../../testdata/ethereum-native/vectors.json")
	var fixture struct{ Vectors []struct{ Raw string } }
	_ = json.Unmarshal(data, &fixture)
	raw, _ := hex.DecodeString(strings.TrimPrefix(fixture.Vectors[0].Raw, "0x"))
	fields, _ := decodeList(raw)
	for _, index := range []int{0, 1, 2, 4, 6, 7, 8} {
		copyFields := append([][]byte(nil), fields...)
		copyFields[index] = append([]byte{0}, fields[index]...)
		if _, err := Decode(encodeList(copyFields), 6423); err == nil {
			t.Fatalf("leading-zero integer %d accepted", index)
		}
	}
	for _, field := range []int{7, 8} {
		copyFields := append([][]byte(nil), fields...)
		copyFields[field] = nil
		if _, err := Decode(encodeList(copyFields), 6423); err == nil {
			t.Fatal("zero signature scalar accepted")
		}
	}
	copyFields := append([][]byte(nil), fields...)
	copyFields[8] = new(big.Int).Sub(secpOrder(), new(big.Int).SetBytes(fields[8])).Bytes()
	if _, err := Decode(encodeList(copyFields), 6423); err == nil {
		t.Fatal("high-S signature accepted")
	}
	if _, err := Decode(append(raw, 0), 6423); err == nil {
		t.Fatal("trailing RLP accepted")
	}
}

func secpOrder() *big.Int {
	n, _ := new(big.Int).SetString("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16)
	return n
}

func TestQuantityAndNativeBoundaries(t *testing.T) {
	for _, value := range []string{"0x", "0x00", "0X1", "0xA", "1", "-0x1", "0x" + strings.Repeat("f", 65)} {
		if _, err := ParseQuantity(value); err == nil {
			t.Fatalf("bad quantity accepted: %s", value)
		}
	}
	for _, value := range []string{"0x0", "0x1", "0x" + strings.Repeat("f", 64)} {
		if _, err := ParseQuantity(value); err != nil {
			t.Fatal(err)
		}
	}
	max := int64(9223372036854775806)
	if got, err := NativeAmount(Wei(max)); err != nil || got != max {
		t.Fatalf("valid int64 edge: %d %v", got, err)
	}
}

func FuzzDecodeNeverPanics(f *testing.F) {
	f.Add([]byte{0xc0})
	f.Add([]byte{0xf8, 0xff})
	f.Add([]byte{0x02, 0xc0})
	f.Fuzz(func(t *testing.T, raw []byte) { _, _ = Verify(raw, 6423) })
}
