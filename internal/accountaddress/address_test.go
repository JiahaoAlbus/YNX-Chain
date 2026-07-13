package accountaddress

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type addressVector struct {
	Hex    string `json:"hex"`
	Bech32 string `json:"bech32"`
}

func TestSharedAddressVectors(t *testing.T) {
	payload, err := os.ReadFile("../../testdata/address-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []addressVector
	if err := json.Unmarshal(payload, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors {
		encoded, err := Encode(vector.Hex)
		if err != nil || encoded != vector.Bech32 {
			t.Fatalf("encode %s: value=%s err=%v", vector.Hex, encoded, err)
		}
		decoded, err := Decode(vector.Bech32)
		if err != nil || decoded != vector.Hex {
			t.Fatalf("decode %s: value=%s err=%v", vector.Bech32, decoded, err)
		}
		upperDecoded, err := Decode(strings.ToUpper(vector.Bech32))
		if err != nil || upperDecoded != vector.Hex {
			t.Fatalf("uppercase decode %s: value=%s err=%v", vector.Bech32, upperDecoded, err)
		}
	}
}

func TestRejectsInvalidAddresses(t *testing.T) {
	valid, err := Encode("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf")
	if err != nil {
		t.Fatal(err)
	}
	badChecksum := valid[:len(valid)-1] + "q"
	if badChecksum == valid {
		badChecksum = valid[:len(valid)-1] + "p"
	}
	for _, value := range []string{
		"0x1234",
		"0x7e5f4552091a69125d5dfcb7b8c2659029395bg",
		"eth" + valid[3:],
		"Y" + valid[1:],
		badChecksum,
		"ynx1qqqqqq",
	} {
		if _, err := Normalize(value); err == nil {
			t.Fatalf("invalid address %q passed normalization", value)
		}
	}
	if IsCanonical(strings.ToUpper("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf")) {
		t.Fatal("uppercase hex address was treated as canonical")
	}
}
