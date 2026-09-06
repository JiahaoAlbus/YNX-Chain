package executionstate

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"sort"
	"strings"
	"testing"
)

// Independent materialized reference for the documented tree digest protocol.
func referenceTree(v any) [32]byte {
	var b bytes.Buffer
	writeLength := func(n int) { var raw [8]byte; binary.BigEndian.PutUint64(raw[:], uint64(n)); b.Write(raw[:]) }
	switch x := v.(type) {
	case map[string]any:
		b.WriteString(treeDigestAlgorithm + "\x00object\x00")
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			writeLength(len(k))
			b.WriteString(k)
			d := referenceTree(x[k])
			b.Write(d[:])
		}
		writeLength(len(keys))
	case []any:
		b.WriteString(treeDigestAlgorithm + "\x00array\x00")
		for _, v := range x {
			d := referenceTree(v)
			b.Write(d[:])
		}
		writeLength(len(x))
	case nil:
		b.WriteString(treeDigestAlgorithm + "\x00null\x00")
	case string:
		b.WriteString(treeDigestAlgorithm + "\x00string\x00")
		b.WriteString(x)
	case json.Number:
		b.WriteString(treeDigestAlgorithm + "\x00number\x00")
		b.WriteString(string(x))
	case bool:
		b.WriteString(treeDigestAlgorithm + "\x00bool\x00")
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	default:
		panic("non-JSON fixture")
	}
	return sha256.Sum256(b.Bytes())
}
func streamFixture(t *testing.T) (map[string]any, Options) {
	m, o := nativeFixture(t)
	o.SourceFamily = "native-baseline-v2"
	o.TargetFamily = "vnext"
	o.SourceCommit = catalogs()[o.SourceFamily].Commit
	return m, o
}
func moduleDigest(r Report, name string) string {
	for _, m := range r.Modules {
		if m.Name == name {
			return m.SHA256
		}
	}
	return ""
}

func TestStreamingMatchesMaterializedTreeAndReconciliation(t *testing.T) {
	m, o := streamFixture(t)
	data, o := seal(t, m, o)
	r := AuditNativeStream(bytes.NewReader(data), o, DefaultStreamLimits())
	d := referenceTree(m)
	if !r.Verified.SchemaVerified || !r.Verified.FullModuleInventoryVerified || !r.Verified.InputReadComplete || !r.Verified.DigestMatchesDeclaration || r.ContentTreeSHA256 != hex.EncodeToString(d[:]) || r.ModuleDigestAlgorithm != treeDigestAlgorithm || len(r.Modules) != 40 || r.Streaming.Blocks != 1 {
		t.Fatal(r.Issues, r.Streaming)
	}
	full := Audit(data, o)
	for key, v := range full.Amounts {
		if r.Amounts[key] != v {
			t.Fatalf("amount mismatch %s", key)
		}
	}
	for _, entry := range r.Modules {
		v, ok := m[entry.Name]
		if ok {
			h := referenceTree(v)
			if entry.SHA256 != hex.EncodeToString(h[:]) {
				t.Fatalf("module mismatch %s", entry.Name)
			}
		}
	}
	if r.Status != "blocked" || r.MigrationSafe || r.Verified.EmbeddedIntegrityVerified || r.Verified.SourceCommitProven || r.Verified.CommittedStateBindingProven || r.Verified.DurabilityProven {
		t.Fatal("stream checks promoted to migration proof")
	}
}

func TestStreamingDigestObjectOrderArrayOrderAndSameCountChanges(t *testing.T) {
	m, o := streamFixture(t)
	v := cloneMap(obj(arr(m["validators"])[0]))
	v["address"], v["moniker"] = testAddress2, "second"
	m["validators"] = append(arr(m["validators"]), v)
	data, o := seal(t, m, o)
	original := AuditNativeStream(bytes.NewReader(data), o, DefaultStreamLimits())
	keys := sortedKeys(m)
	var b bytes.Buffer
	b.WriteByte('{')
	for i := len(keys) - 1; i >= 0; i-- {
		if i != len(keys)-1 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(keys[i])
		v, _ := json.Marshal(m[keys[i]])
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	o.ExpectedSHA256 = digest(b.Bytes())
	reordered := AuditNativeStream(bytes.NewReader(b.Bytes()), o, DefaultStreamLimits())
	if original.ContentTreeSHA256 != reordered.ContentTreeSHA256 || !reordered.Verified.SchemaVerified {
		t.Fatal("object order changed semantic digest")
	}
	validators := arr(m["validators"])
	validators[0], validators[1] = validators[1], validators[0]
	data, o = seal(t, m, o)
	swapped := AuditNativeStream(bytes.NewReader(data), o, DefaultStreamLimits())
	if moduleDigest(original, "validators") == moduleDigest(swapped, "validators") {
		t.Fatal("array order was lost")
	}
	obj(obj(m["accounts"])[testAddress])["nonce"] = json.Number("1")
	data, o = seal(t, m, o)
	changed := AuditNativeStream(bytes.NewReader(data), o, DefaultStreamLimits())
	if moduleDigest(swapped, "accounts") == moduleDigest(changed, "accounts") {
		t.Fatal("same count hid changed content")
	}
}

func TestStreamingStrictBoundaryMatrix(t *testing.T) {
	m, o := streamFixture(t)
	original, o := seal(t, m, o)
	for _, tc := range []struct {
		name string
		data []byte
		code string
	}{
		{"duplicate", bytes.Replace(original, []byte(`"balance":100`), []byte(`"balance":100,"balance":99`), 1), "DUPLICATE_JSON_KEY"},
		{"unknown", bytes.Replace(original, []byte(`"balance":100`), []byte(`"unknownSecret":"never-print","balance":100`), 1), "UNKNOWN_FIELD"},
		{"fraction", bytes.Replace(original, []byte(`"balance":100`), []byte(`"balance":1.1`), 1), "EXPECTED_EXACT_INTEGER"},
		{"exponent", bytes.Replace(original, []byte(`"balance":100`), []byte(`"balance":1e2`), 1), "EXPECTED_EXACT_INTEGER"},
		{"overflow", bytes.Replace(original, []byte(`"balance":100`), []byte(`"balance":9223372036854775808`), 1), "INTEGER_OUT_OF_RANGE"},
		{"nonce_overflow", bytes.Replace(original, []byte(`"nonce":0`), []byte(`"nonce":18446744073709551616`), 1), "INTEGER_OUT_OF_RANGE"},
		{"quoted", bytes.Replace(original, []byte(`"balance":100`), []byte(`"balance":"100"`), 1), "EXPECTED_EXACT_INTEGER"},
		{"null", bytes.Replace(original, []byte(`"balance":100`), []byte(`"balance":null`), 1), "EXPECTED_EXACT_INTEGER"},
		{"unpaired_surrogate", bytes.Replace(original, []byte(`"moniker":"fixture"`), []byte(`"moniker":"\ud800"`), 1), "INVALID_JSON_UNICODE"},
		{"trailing", append(append([]byte{}, original...), []byte(` {}`)...), "TRAILING_JSON_OR_READ_FAILED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := AuditNativeStream(bytes.NewReader(tc.data), o, DefaultStreamLimits())
			if !has(r, tc.code) || r.Verified.SchemaVerified || r.Verified.InputReadComplete || r.InputSHA256 != "" {
				t.Fatal(r.Issues)
			}
			b, _ := json.Marshal(r)
			if bytes.Contains(b, []byte("never-print")) || bytes.Contains(b, []byte("unknownSecret")) {
				t.Fatal("report leaked unknown data")
			}
		})
	}
	delete(m, "payIntents")
	data, _ := json.Marshal(m)
	if !has(AuditNativeStream(bytes.NewReader(data), o, DefaultStreamLimits()), "MISSING_FIELD") {
		t.Fatal("required field was silently omitted")
	}
}

type repeatingReader struct {
	remaining int64
	b         byte
}

func (r *repeatingReader) Read(p []byte) (int, error) {
	if r.remaining == 0 {
		return 0, io.EOF
	}
	n := len(p)
	if int64(n) > r.remaining {
		n = int(r.remaining)
	}
	for i := 0; i < n; i++ {
		p[i] = r.b
	}
	r.remaining -= int64(n)
	return n, nil
}
func TestStreamingHugeTokenStopsBeforeUnboundedAllocation(t *testing.T) {
	limits := DefaultStreamLimits()
	limits.MaxTokenBytes = 1024
	input := &countedReader{Reader: io.MultiReader(strings.NewReader(`{"config":{"name":"`), &repeatingReader{remaining: 64 << 20, b: 'a'}, strings.NewReader(`"}}`))}
	_, o := streamFixture(t)
	r := AuditNativeStream(input, o, limits)
	if !has(r, "STREAM_TOKEN_BUDGET_EXCEEDED") || input.count > 128<<10 || r.Verified.InputReadComplete {
		t.Fatal(r.Issues, input.count)
	}
	if r.Streaming.PeakCaptureEstimateBytes > 4096 {
		t.Fatal("huge value allocated before token rejection")
	}
}
func TestStreamingDepthAndObjectCaptureBudgets(t *testing.T) {
	limits := DefaultStreamLimits()
	limits.MaxDepth = 8
	r := Report{Streaming: &StreamEvidence{Limits: limits}}
	a := streamAudit{r: &r, limits: limits, lexer: &streamLexer{r: bufio.NewReader(strings.NewReader(strings.Repeat("[", 20) + "0" + strings.Repeat("]", 20))), max: 1024}}
	if _, e := a.parse("any", "fixture", false, 0); e == nil || e.Error() != "JSON_DEPTH_LIMIT" {
		t.Fatal(e)
	}
	m, o := streamFixture(t)
	data, o := seal(t, m, o)
	limits = DefaultStreamLimits()
	limits.MaxObjectIndexBytes = 128
	if !has(AuditNativeStream(bytes.NewReader(data), o, limits), "STREAM_OBJECT_INDEX_BUDGET_EXCEEDED") {
		t.Fatal("unbounded object index")
	}
	limits = DefaultStreamLimits()
	limits.MaxCaptureBytes = 128
	if !has(AuditNativeStream(bytes.NewReader(data), o, limits), "STREAM_CAPTURE_BUDGET_EXCEEDED") {
		t.Fatal("unbounded retained state")
	}
}

func TestStreamingDEXSupplyInflationMatchesFullAuditor(t *testing.T) {
	m, o := streamFixture(t)
	c := catalogs()[o.SourceFamily]
	asset := obj(zero(c, "chain.NativeDexAsset"))
	asset["id"], asset["decimals"], asset["maxSupply"], asset["totalSupply"] = "usd-test", json.Number("6"), json.Number("10000"), json.Number("10000")
	m["dexAssets"] = map[string]any{"usd-test": asset}
	m["dexBalances"] = map[string]any{"usd-test": map[string]any{testAddress: json.Number("8050")}}
	pool := obj(zero(c, "chain.NativeDexPool"))
	pool["id"], pool["asset0"], pool["asset1"], pool["reserve0"] = "dex_fixture", "usd-test", "YNXT", json.Number("2000")
	m["dexPools"] = map[string]any{"dex_fixture": pool}
	data, o := seal(t, m, o)
	stream := AuditNativeStream(bytes.NewReader(data), o, DefaultStreamLimits())
	full := Audit(data, o)
	if !stream.Verified.SchemaVerified || !has(stream, "DEX_TOKEN_SUPPLY_MISMATCH") || len(stream.AssetReconciliations) != 1 || stream.AssetReconciliations[0].HoldingsMinusSupply != "50" {
		t.Fatal(stream.Issues, stream.AssetReconciliations)
	}
	b1, _ := json.Marshal(stream.AssetReconciliations)
	b2, _ := json.Marshal(full.AssetReconciliations)
	if !bytes.Equal(b1, b2) {
		t.Fatal("stream supply diverged from full auditor")
	}
}
