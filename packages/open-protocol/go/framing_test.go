package openprotocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func TestOPEN02ExistingCommittedContextVector(t *testing.T) {
	var v struct {
		FieldsHex []string
		WireHex   string
	}
	b, e := os.ReadFile("../test/fixtures/existing-context-vector.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &v); e != nil {
		t.Fatal(e)
	}
	fields := make([][]byte, len(v.FieldsHex))
	for i, s := range v.FieldsHex {
		fields[i], e = hex.DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
	}
	want, e := hex.DecodeString(v.WireHex)
	if e != nil {
		t.Fatal(e)
	}
	got, e := EncodeFields(fields...)
	if e != nil || !bytes.Equal(got, want) {
		t.Fatalf("existing golden vector differs: %v", e)
	}
	decoded, e := DecodeFields(got, 8)
	if e != nil {
		t.Fatal(e)
	}
	for i := range fields {
		if !bytes.Equal(fields[i], decoded[i]) {
			t.Fatal("field differs")
		}
	}
	empty, e := EncodeFields()
	if e != nil || hex.EncodeToString(empty) != "00000000" {
		t.Fatal("empty framing differs")
	}
}
func TestOPEN02MalformedAndBounds(t *testing.T) {
	good, _ := EncodeFields([]byte{1}, []byte{2})
	for _, wire := range [][]byte{nil, good[:len(good)-1], append(append([]byte{}, good...), 0), {0xff, 0xff, 0xff, 0xff}, {0, 0, 0, 1, 0xff, 0xff, 0xff, 0xff}} {
		if _, e := DecodeFields(wire, 2); e == nil {
			t.Fatal("malformed accepted")
		}
	}
	if _, e := DecodeFields(good, 1); e == nil {
		t.Fatal("wrong count")
	}
	if _, e := DecodeFields(make([]byte, MaxControlBytes+1), 0); e == nil {
		t.Fatal("oversized")
	}
	if _, e := EncodeFields(make([]byte, MaxControlBytes-8)); e != nil {
		t.Fatal(e)
	}
	if _, e := EncodeFields(make([]byte, MaxControlBytes-7)); e == nil {
		t.Fatal("oversized encode")
	}
	fields := make([][]byte, 1024)
	if _, e := EncodeFields(fields...); e != nil {
		t.Fatal(e)
	}
	if _, e := EncodeFields(append(fields, nil)...); e == nil {
		t.Fatal("count overflow")
	}
	detached, _ := DecodeFields(good, 2)
	good[8] = 9
	if detached[0][0] != 1 {
		t.Fatal("decode aliases wire")
	}
}
