package openprotocol_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	op "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"os"
	"strconv"
	"strings"
	"testing"
)

type taFixture struct {
	Name            string
	Request         op.TaskAuthorityRequestInputDATA
	RequestOriginal []byte
	Payload         op.TaskAuthorityResponsePayloadDATA
	PayloadOriginal []byte
	Envelope        op.TaskAuthorityWholeResponseInputDATA
	WholeOriginal   []byte
	Expected        op.TaskAuthorityWholeExpectedDATA
}

func taUnpack(t *testing.T, v any) any {
	t.Helper()
	switch x := v.(type) {
	case map[string]any:
		if len(x) == 1 {
			if text, ok := x["bytesHex"].(string); ok {
				b, e := hex.DecodeString(text)
				if e != nil {
					t.Fatal(e)
				}
				return b
			}
		}
		out := map[string]any{}
		for k, y := range x {
			out[k] = taUnpack(t, y)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, y := range x {
			out[i] = taUnpack(t, y)
		}
		return out
	}
	return v
}
func taFixtures(t *testing.T) []taFixture {
	t.Helper()
	raw, e := os.ReadFile("../test/fixtures/task-authority-response-v1.json")
	if e != nil {
		t.Fatal(e)
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		t.Fatal("fixture JSON")
	}
	data := taUnpack(t, value).(map[string]any)
	wire, e := json.Marshal(data["fixtures"])
	if e != nil {
		t.Fatal(e)
	}
	var f []taFixture
	if e = json.Unmarshal(wire, &f); e != nil {
		t.Fatal(e)
	}
	return f
}
func TestTaskAuthoritySharedGoldens(t *testing.T) {
	for _, f := range taFixtures(t) {
		t.Run(f.Name, func(t *testing.T) {
			r, e := op.EncodeTaskAuthorityRequestDATA(f.Request)
			if e != nil || !bytes.Equal(r, f.RequestOriginal) {
				t.Fatal("request bytes", e)
			}
			p, e := op.EncodeTaskAuthorityResponsePayloadDATA(f.Payload)
			if e != nil || !bytes.Equal(p, f.PayloadOriginal) {
				t.Fatal("payload bytes", e)
			}
			o, e := op.EncodeTaskAuthorityWholeResponseDATA(f.Envelope, op.TaskAuthorityWholeMaxBytes)
			if e != nil || !bytes.Equal(o, f.WholeOriginal) {
				t.Fatal("outer bytes", e)
			}
			result, e := op.AssertTaskAuthorityWholeResponseBindingDATA(o, f.Expected)
			if e != nil {
				t.Fatal(e)
			}
			if !result.DataOnly || result.SignatureVerified || result.SourceAdmission || result.NativeAdmission || result.OperationVerified {
				t.Fatal("authority promotion")
			}
			if !bytes.Equal(result.ResponseOriginal, f.Envelope.OriginalBody) || result.Payload.ResponseIssuer.Tenant == result.Payload.Tenant {
				t.Fatal("original/cross-organization registered issuer")
			}
			decoded, e := op.DecodeTaskAuthorityWholeResponseDATA(o, op.TaskAuthorityWholeMaxBytes)
			if e != nil || !decoded.DataOnly || decoded.SignatureVerified || decoded.SourceAdmission {
				t.Fatal(e)
			}
		})
	}
}
func TestTaskAuthorityIndependentBindings(t *testing.T) {
	base := taFixtures(t)[0]
	for _, name := range []string{"method", "tenant", "issuerref", "epoch", "policy", "height", "network", "expiry", "body", "input", "opaque", "source", "response", "singlehashA", "singlehashB"} {
		t.Run(name, func(t *testing.T) {
			f := taFixtures(t)[0]
			expected := f.Expected
			switch name {
			case "method":
				expected.Transport.Method = "GET"
			case "tenant":
				expected.Tenant = "other"
			case "issuerref":
				expected.Issuer.Principal.Tenant = "other"
			case "epoch":
				expected.Issuer.IssuerEpoch = "999"
			case "policy":
				expected.Issuer.PolicyRevision = "999"
			case "height":
				expected.Issuer.Height = "999"
			case "network":
				expected.Issuer.ChainID = strings.Repeat("00", 32)
			case "expiry":
				expected.Issuer.Expires = "19000"
			case "body":
				f.Envelope.OriginalBody[0] ^= 1
				if _, e := op.EncodeTaskAuthorityWholeResponseDATA(f.Envelope, op.TaskAuthorityWholeMaxBytes); e == nil {
					t.Fatal("changed actual body")
				}
				return
			case "input":
				expected.Call.RawInput[0] ^= 1
			case "opaque":
				expected.OpaqueOriginal = "{pretend resource}"
			case "source":
				expected.Resource.SourceBytes[0] ^= 1
			case "response":
				expected.Resource.ResponseOriginal[0] ^= 1
			case "singlehashA", "singlehashB":
				if name == "singlehashA" {
					f.Payload.Call.GrantWire.SHA3_512 = strings.Repeat("00", 64)
				} else {
					f.Payload.Call.HolderWire.SHA512 = strings.Repeat("00", 64)
				}
				payload, e := op.EncodeTaskAuthorityResponsePayloadDATA(f.Payload)
				if e != nil {
					t.Fatal(e)
				}
				f.Envelope.Proof.PayloadOriginal = payload
				outer, e := op.EncodeTaskAuthorityWholeResponseDATA(f.Envelope, op.TaskAuthorityWholeMaxBytes)
				if e != nil {
					t.Fatal(e)
				}
				f.WholeOriginal = outer
			}
			if _, e := op.AssertTaskAuthorityWholeResponseBindingDATA(f.WholeOriginal, expected); e == nil {
				t.Fatal("accepted mismatch")
			}
		})
	}
	for _, field := range []string{"refrev", "method"} {
		p := base.Payload
		if field == "refrev" {
			p.ResponseIssuer.Rev = ""
		} else {
			p.Transport.Method = "GET"
		}
		if _, e := op.EncodeTaskAuthorityResponsePayloadDATA(p); e == nil {
			t.Fatal("invalid payload", field)
		}
	}
}
func TestTaskAuthorityColdQueryResource(t *testing.T) {
	f := taFixtures(t)[1]
	if len(f.Expected.Call.RawInput) != 0 {
		t.Fatal("cold query manufactured original input")
	}
	if _, e := op.AssertTaskAuthorityWholeResponseBindingDATA(f.WholeOriginal, f.Expected); e != nil {
		t.Fatal(e)
	}
	f.Expected.Call.OriginalOperation = strings.Repeat("01", 32)
	if _, e := op.AssertTaskAuthorityWholeResponseBindingDATA(f.WholeOriginal, f.Expected); e == nil {
		t.Fatal("different operation")
	}
	unknown := taFixtures(t)[3]
	unknown.Expected.Resource = taFixtures(t)[0].Expected.Resource
	if _, e := op.AssertTaskAuthorityWholeResponseBindingDATA(unknown.WholeOriginal, unknown.Expected); e == nil {
		t.Fatal("UNKNOWN resource disclosure")
	}
}
func TestTaskAuthorityCanonicalBudgetsAndOwnership(t *testing.T) {
	f := taFixtures(t)[0]
	if _, e := op.EncodeTaskAuthorityWholeResponseDATA(f.Envelope, len(f.WholeOriginal)-1); !errors.Is(e, op.ErrBounds) {
		t.Fatal("registered encoder max", e)
	}
	if _, e := op.DecodeTaskAuthorityWholeResponseDATA(f.WholeOriginal, len(f.WholeOriginal)-1); !errors.Is(e, op.ErrBounds) {
		t.Fatal("registered decoder max", e)
	}
	for _, raw := range [][]byte{append(bytes.Clone(f.WholeOriginal), ' '), []byte(`{"version":"1",` + string(f.WholeOriginal[1:])), []byte(strings.Replace(string(f.WholeOriginal), `"wireOriginal":"CQgH"`, `"wireOriginal":"CQgH="`, 1)), []byte{0xff}} {
		if _, e := op.DecodeTaskAuthorityWholeResponseDATA(raw, op.TaskAuthorityWholeMaxBytes); e == nil {
			t.Fatal("noncanonical outer")
		}
	}
	var wire map[string]any
	if json.Unmarshal(f.WholeOriginal, &wire) != nil {
		t.Fatal("wire")
	}
	proof := wire["proof"].(map[string]any)
	overhead := len(f.WholeOriginal) - len(proof["wireOriginal"].(string))
	n := (op.TaskAuthorityWholeMaxBytes - overhead) * 3 / 4
	for (n*4+2)/3+overhead > op.TaskAuthorityWholeMaxBytes {
		n--
	}
	f.Envelope.Proof.WireOriginal = make([]byte, n)
	exact, e := op.EncodeTaskAuthorityWholeResponseDATA(f.Envelope, op.TaskAuthorityWholeMaxBytes)
	if e != nil || len(exact) > op.TaskAuthorityWholeMaxBytes || op.TaskAuthorityWholeMaxBytes-len(exact) > 2 {
		t.Fatal("outer cap", e, len(exact))
	}
	f.Envelope.Proof.WireOriginal = make([]byte, n+1)
	if _, e = op.EncodeTaskAuthorityWholeResponseDATA(f.Envelope, op.TaskAuthorityWholeMaxBytes); !errors.Is(e, op.ErrBounds) {
		t.Fatal("base64/proof overhead", e)
	}
	if _, e = op.DecodeTaskAuthorityWholeResponseDATA(make([]byte, op.TaskAuthorityWholeMaxBytes+1), op.TaskAuthorityWholeMaxBytes); !errors.Is(e, op.ErrBounds) {
		t.Fatal("over-limit", e)
	}
	p := taFixtures(t)[0].Payload
	p.Call.Binding.Sources[0].Fields = make([]string, 900)
	for i := range p.Call.Binding.Sources[0].Fields {
		p.Call.Binding.Sources[0].Fields[i] = strings.Repeat("0", 4-len(stringIndex(i))) + stringIndex(i) + strings.Repeat("x", 96)
	}
	if _, e := op.EncodeTaskAuthorityResponsePayloadDATA(p); !errors.Is(e, op.ErrBounds) {
		t.Fatal("payload cap", e)
	}
	original := taFixtures(t)[0].WholeOriginal
	d, e := op.DecodeTaskAuthorityWholeResponseDATA(original, op.TaskAuthorityWholeMaxBytes)
	if e != nil {
		t.Fatal(e)
	}
	held := bytes.Clone(d.OriginalBody)
	original[0] = 0
	if !bytes.Equal(held, d.OriginalBody) {
		t.Fatal("decode aliases input")
	}
	d.Proof.WireOriginal[0] = 0
	if taFixtures(t)[0].Envelope.Proof.WireOriginal[0] != 9 {
		t.Fatal("proof alias")
	}
}

func stringIndex(i int) string { return strconv.Itoa(i) }
