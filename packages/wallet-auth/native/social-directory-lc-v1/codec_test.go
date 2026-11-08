package socialdirectorylc

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"testing"
)

func public(t *testing.T) (Binding, map[string]json.RawMessage) {
	t.Helper()
	raw, e := os.ReadFile("testdata/vectors.json")
	if e != nil {
		t.Fatal(e)
	}
	var v map[string]json.RawMessage
	if json.Unmarshal(raw, &v) != nil {
		t.Fatal("json")
	}
	text := func(k string) string {
		var s string
		if json.Unmarshal(v[k], &s) != nil {
			t.Fatal(k)
		}
		return s
	}
	req, _ := hex.DecodeString(text("requestHex"))
	res, _ := hex.DecodeString(text("responseHex"))
	var mapb map[string]string
	json.Unmarshal(v["binding"], &mapb)
	q, _ := hex.DecodeString(mapb["requestOriginalSHA256"])
	var want [32]byte
	copy(want[:], q)
	b, e := BindOriginalBytes(req, res, want)
	if e != nil {
		t.Fatal(e)
	}
	return b, v
}
func TestNodeGoPublicGoldenAndErrorKinds(t *testing.T) {
	b, v := public(t)
	for _, tag := range []string{"W", "A", "A_code0", "A_retained"} {
		var h string
		json.Unmarshal(v[tag], &h)
		raw, _ := hex.DecodeString(h)
		var out []byte
		var e error
		if tag == "W" {
			if DecodeReadRelease(raw, b) != nil {
				t.Fatal(tag)
			}
			out, e = EncodeReadRelease(b)
		} else {
			a, err := DecodeClosedAck(raw, b)
			if err != nil {
				t.Fatal(err)
			}
			out, e = EncodeClosedAck(b, a)
			if tag == "A_code0" && (!a.ErrorPresent || a.ErrorKind != Code || a.ErrorCode != 0) {
				t.Fatal("code0")
			}
			if tag == "A_retained" && a.ErrorKind != Retained {
				t.Fatal("retained")
			}
		}
		if e != nil || !bytes.Equal(raw, out) {
			t.Fatal(tag)
		}
	}
	z := int32(0)
	p, k, c := ErrorFromLocal(errors.New("PUBLIC local"), &z)
	if !p || k != Code || c != 0 {
		t.Fatal("local0")
	}
	p, k, c = ErrorFromLocal(errors.New("PUBLIC local"), nil)
	if !p || k != Retained || c != 0 {
		t.Fatal("local retained")
	}
}
func TestPartialEOFAndForeignResponse(t *testing.T) {
	b, _ := public(t)
	a, _ := EncodeClosedAck(b, ClosedAck{Closed: true})
	partial, e := ReadControlFrame(bytes.NewReader(a[:80]))
	if !errors.Is(e, io.ErrUnexpectedEOF) || !bytes.Equal(partial, a[:80]) {
		t.Fatal("partial before error")
	}
	if _, e = ReadControlFrame(bytes.NewReader(nil)); !errors.Is(e, io.EOF) {
		t.Fatal("EOF")
	}
	foreign := b
	foreign.RootResponseOriginalSHA256[0] ^= 1
	if _, e = DecodeClosedAck(a, foreign); !errors.Is(e, ErrBinding) {
		t.Fatal("foreign")
	}
	bad := append([]byte(nil), a...)
	bad[5] = 1
	if _, e = DecodeClosedAck(bad, b); e == nil {
		t.Fatal("metadata")
	}
}
