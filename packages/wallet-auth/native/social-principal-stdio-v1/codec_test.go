package socialprincipalstdio

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"testing"
)

func TestPublicSharedVectors(t *testing.T) {
	b, e := os.ReadFile("testdata/vectors.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		BindingOriginal string `json:"bindingOriginal"`
		Vectors         []struct {
			Command          string   `json:"command"`
			Request          Request  `json:"request"`
			Response         Response `json:"response"`
			RequestFrameB64  string   `json:"requestFrameB64"`
			ResponseFrameB64 string   `json:"responseFrameB64"`
		} `json:"vectors"`
	}
	if json.Unmarshal(b, &f) != nil {
		t.Fatal("fixture")
	}
	for _, v := range f.Vectors {
		raw, _ := base64.StdEncoding.DecodeString(v.RequestFrameB64)
		actual, e := EncodeRequestFrame(v.Request)
		if e != nil || !bytes.Equal(actual, raw) {
			t.Fatalf("request %s interop %v", v.Request.Sequence, e)
		}
		r, e := DecodeRequestFrame(raw)
		if e != nil || r.Sequence != v.Request.Sequence {
			t.Fatal("u64")
		}
		out, _ := base64.StdEncoding.DecodeString(v.ResponseFrameB64)
		actual, e = EncodeResponseFrame(v.Response, v.Response.Sequence, v.Command)
		if e != nil || !bytes.Equal(actual, out) {
			t.Fatalf("response interop %v", e)
		}
		r2, e := DecodeResponseFrame(out, v.Response.Sequence, v.Command)
		if e != nil || !r2.ErrorPresent || r2.Error.Code != 0 || !r2.PhysicalDone || r2.Original == nil {
			t.Fatal("partial0")
		}
	}
	binding, e := DecodeBindingOriginal(f.BindingOriginal)
	if e != nil || binding.Expected.Generation != "9007199254740993" || !bytes.Contains([]byte(binding.ProfileOriginal), []byte("18446744073709551615")) {
		t.Fatalf("opaque binding %v", e)
	}
}
func TestRejectMalformedNewFrames(t *testing.T) {
	r := Request{1, "9007199254740993", "current", "", "", 0}
	raw, e := EncodeRequestFrame(r)
	if e != nil {
		t.Fatal(e)
	}
	for _, b := range [][]byte{append([]byte{239, 187, 191}, raw...), append([]byte{255}, raw...), bytes.Replace(raw, []byte("{"), []byte("{\"version\":1,"), 1), append([]byte(" "), raw...), append(append([]byte{}, raw...), raw...)} {
		if _, e := DecodeRequestFrame(b); e == nil {
			t.Fatal("accepted malformed")
		}
	}
	if _, e := NextSequence("18446744073709551615"); e == nil {
		t.Fatal("overflow")
	}
	zero := int32(0)
	present, v := ErrorFromLocal(errors.New("PRIVATE_ORIGINAL_LOCAL_ONLY"), &zero)
	if !present || v.Tag != "code" || v.Code != 0 {
		t.Fatal("code0")
	}
	present, v = ErrorFromLocal(errors.New("PRIVATE_ORIGINAL_LOCAL_ONLY"), nil)
	if !present || v.Tag != "retained" || v.Code != 0 {
		t.Fatal("retained")
	}
}
func TestStreamPartialAndCloseSeparate(t *testing.T) {
	raw, _ := EncodeRequestFrame(Request{1, "1", "current", "", "", 0})
	r := NewFrameReader(bytes.NewReader(append(append([]byte{}, raw...), []byte("partial")...)))
	first, e := r.ReadFrame()
	if e != nil || !bytes.Equal(first, raw) {
		t.Fatal("first frame")
	}
	partial, e := r.ReadFrame()
	if e == nil || !bytes.Equal(partial, []byte("partial")) {
		t.Fatal("partial adoption")
	}
	r = NewFrameReader(bytes.NewReader(nil))
	if _, e = r.ReadFrame(); e != io.EOF {
		t.Fatal("EOF")
	}
	resp := Response{Version: 1, Sequence: "1", PhysicalDone: true, Error: ErrorDATA{"none", 0}}
	if _, e := EncodeResponseFrame(resp, "1", "current"); e == nil {
		t.Fatal("physical current")
	}
	resp.ErrorPresent = true
	resp.Error = ErrorDATA{"code", 0}
	if _, e := EncodeResponseFrame(resp, "1", "close"); e != nil {
		t.Fatal("lateerror close")
	}
}
