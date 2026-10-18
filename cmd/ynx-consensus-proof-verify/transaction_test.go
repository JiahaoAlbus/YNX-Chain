//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// This fixture checks schema/precision only. The original envelope intentionally
// is not a signed transaction and cannot establish proof success. Real signed
// CLI cases come from TestPQConsensusTransactionProofPublicFixture in CI.
func transactionContextSyntaxFixture(dir string) transactionTrustContext {
	light := proofContextSyntaxFixture(dir)
	envelope, wire := bytes.Repeat([]byte("e"), 60<<10), bytes.Repeat([]byte("w"), 55<<10)
	eh, wh := sha256.Sum256(envelope), sha256.Sum256(wire)
	successor := light.expected()
	successor.HeaderHeight = "9007199254740994"
	successor.StateHeight = "9007199254740993"
	return transactionTrustContext{Version: transactionContextVersion, LightTrust: light, ExpectedTransaction: transactionExpected{
		Block: light.expected(), Successor: successor, TransactionType: consensus.PQTransferType,
		Envelope: base64.StdEncoding.EncodeToString(envelope), NativeWire: base64.StdEncoding.EncodeToString(wire),
		TransactionHash: hex.EncodeToString(eh[:]), NativeWireHash: hex.EncodeToString(wh[:]), Index: "0",
	}}
}

func transactionJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestTransactionProofContextPinsCompleteOriginalBytesAndCoordinates(t *testing.T) {
	dir := t.TempDir()
	c := transactionContextSyntaxFixture(dir)
	raw := transactionJSON(t, c)
	if len(raw) <= 32<<10 {
		t.Fatal("fixture does not exercise real Member-sized independent context")
	}
	o := proofContextFile(t, filepath.Join(dir, "context.json"), raw)
	read, err := readPublicFile(o.contextPath, maxTransactionContextBytes)
	if err != nil {
		t.Fatal(err)
	}
	got, expected, err := decodeTransactionTrustContext(read, o.contextSHA256)
	if err != nil || got != c || expected.Block.HeaderHeight != 9007199254740993 || expected.Successor.HeaderHeight != 9007199254740994 || len(expected.NativeWire) != 55<<10 {
		t.Fatal("independent target bytes or integer precision changed", err)
	}
	if _, err = readTrustContext(o); err == nil {
		t.Fatal("v1 light context bound/schema expanded")
	}
	changed := bytes.Replace(raw, []byte(`"index":"0"`), []byte(`"index":"1"`), 1)
	if _, _, err = decodeTransactionTrustContext(changed, o.contextSHA256); err == nil {
		t.Fatal("changed independent context accepted under old external hash")
	}
	if _, err = got.LightTrust.load(); err == nil {
		t.Fatal("syntax-only target manufactured authority")
	}
	retained, err := os.ReadFile(o.contextPath)
	if err != nil || !bytes.Equal(retained, raw) {
		t.Fatal("independent context mutated", err)
	}
}

func TestTransactionProofContextRejectsMalformedAndSplitAuthority(t *testing.T) {
	dir := t.TempDir()
	c := transactionContextSyntaxFixture(dir)
	raw := transactionJSON(t, c)
	for name, changed := range map[string][]byte{
		"unknown":         append([]byte(`{"now":"untrusted",`), raw[1:]...),
		"duplicate":       bytes.Replace(raw, []byte(`"index":"0"`), []byte(`"index":"1","index":"0"`), 1),
		"alias":           bytes.Replace(raw, []byte(`"nativeWire":`), []byte(`"NativeWire":`), 1),
		"null-runtime":    bytes.Replace(raw, []byte(`"runtimePlanHash":""`), []byte(`"runtimePlanHash":null`), 1),
		"missing-runtime": bytes.Replace(raw, []byte(`"runtimePlanHash":"",`), nil, 1),
		"number-index":    bytes.Replace(raw, []byte(`"index":"0"`), []byte(`"index":0`), 1),
		"trailing":        append(bytes.Clone(raw), []byte(`{}`)...),
	} {
		t.Run(name, func(t *testing.T) {
			if bytes.Equal(changed, raw) {
				t.Fatal("negative did not alter original")
			}
			h := sha256.Sum256(changed)
			if _, _, err := decodeTransactionTrustContext(changed, hex.EncodeToString(h[:])); err == nil {
				t.Fatal("malformed externally pinned context accepted")
			}
		})
	}
	for name, mutate := range map[string]func(*transactionTrustContext){
		"light-target": func(c *transactionTrustContext) { c.LightTrust.ExpectedBlockHash = strings.Repeat("22", 32) },
		"chain":        func(c *transactionTrustContext) { c.ExpectedTransaction.Successor.ChainID = "another-chain" },
		"not-adjacent": func(c *transactionTrustContext) { c.ExpectedTransaction.Successor = c.ExpectedTransaction.Block },
		"hash-prefix": func(c *transactionTrustContext) {
			c.ExpectedTransaction.TransactionHash = "0x" + c.ExpectedTransaction.TransactionHash
		},
		"hash-mismatch":      func(c *transactionTrustContext) { c.ExpectedTransaction.NativeWireHash = strings.Repeat("22", 32) },
		"base64-newline":     func(c *transactionTrustContext) { c.ExpectedTransaction.NativeWire += "\n" },
		"base64-unpadded":    func(c *transactionTrustContext) { c.ExpectedTransaction.Envelope = "ZQ" },
		"index-overflow":     func(c *transactionTrustContext) { c.ExpectedTransaction.Index = "4294967296" },
		"index-leading-zero": func(c *transactionTrustContext) { c.ExpectedTransaction.Index = "00" },
		"unsupported-type":   func(c *transactionTrustContext) { c.ExpectedTransaction.TransactionType = "eth_sendRawTransaction" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := c
			mutate(&bad)
			changed := transactionJSON(t, bad)
			h := sha256.Sum256(changed)
			if _, _, err := decodeTransactionTrustContext(changed, hex.EncodeToString(h[:])); err == nil {
				t.Fatal("invalid independent coordinates accepted")
			}
		})
	}
}

func TestTransactionProofCLIPinsTargetBeforeSourceOrClock(t *testing.T) {
	dir := t.TempDir()
	c := transactionContextSyntaxFixture(dir)
	raw := transactionJSON(t, c)
	o := proofContextFile(t, filepath.Join(dir, "context.json"), raw)
	args := []string{"--trust-context", o.contextPath, "--trust-context-sha256", o.contextSHA256}
	request := transactionInput{Version: transactionRequestVersion, Expected: c.ExpectedTransaction, Proof: json.RawMessage(`{}`)}
	for name, mutate := range map[string]func(*transactionInput){
		"index":     func(r *transactionInput) { r.Expected.Index = "1" },
		"header":    func(r *transactionInput) { r.Expected.Block.BlockHash = strings.Repeat("22", 32) },
		"successor": func(r *transactionInput) { r.Expected.Successor.StateAppHash = strings.Repeat("22", 32) },
		"type":      func(r *transactionInput) { r.Expected.TransactionType = consensus.PQWholeType },
	} {
		t.Run(name, func(t *testing.T) {
			bad := request
			mutate(&bad)
			var output bytes.Buffer
			clockCalled := false
			status := run(args, bytes.NewReader(transactionJSON(t, bad)), &output, func() time.Time { clockCalled = true; return time.Now() })
			var response transactionCommandResult
			if err := json.Unmarshal(output.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if status != 1 || clockCalled || response.Version != transactionResultVersion || response.Code != "INVALID_REQUEST" || response.Result != nil || !strings.Contains(response.Error, "independently pinned invocation target") {
				t.Fatal("untrusted target selected source/clock or result", output.String())
			}
		})
	}
	// A changed context pin must reject before even consuming untrusted proof.
	badArgs := append([]string(nil), args...)
	badArgs[3] = strings.Repeat("22", 32)
	input := &observedInput{}
	var output bytes.Buffer
	if status := run(badArgs, input, &output, time.Now); status != 1 || input.reads != 0 {
		t.Fatal("unpinned transaction context consumed proof")
	}
	var failure transactionCommandResult
	if json.Unmarshal(output.Bytes(), &failure) != nil || failure.Code != "TRUST_CONTEXT_INVALID" || failure.Result != nil {
		t.Fatal(output.String())
	}
	// Proof syntax cannot switch a v1 pinned context to the new larger profile.
	v1 := transactionJSON(t, c.LightTrust)
	o = proofContextFile(t, o.contextPath, v1)
	args[3] = o.contextSHA256
	output.Reset()
	if run(args, bytes.NewReader(transactionJSON(t, request)), &output, time.Now) != 1 {
		t.Fatal("stdin selected transaction authority profile")
	}
	assertProofFailure(t, output.Bytes(), "INVALID_REQUEST")
}

func TestTransactionProofCLIRejectsNestedAuthorityAndMissingFields(t *testing.T) {
	dir := t.TempDir()
	c := transactionContextSyntaxFixture(dir)
	o := proofContextFile(t, filepath.Join(dir, "context.json"), transactionJSON(t, c))
	args := []string{"--trust-context", o.contextPath, "--trust-context-sha256", o.contextSHA256}
	base := transactionJSON(t, transactionInput{Version: transactionRequestVersion, Expected: c.ExpectedTransaction, Proof: json.RawMessage(`{}`)})
	for _, raw := range [][]byte{
		append([]byte(`{"trust":{},`), base[1:]...),
		bytes.Replace(base, []byte(`"index":"0"`), []byte(`"index":null`), 1),
		bytes.Replace(base, []byte(`"successor":`), []byte(`"Successor":`), 1),
		bytes.Replace(base, []byte(`"index":"0"`), []byte(`"index":"1","index":"0"`), 1),
		bytes.Replace(base, []byte(`"proof":{}`), []byte(`"proof":null`), 1),
		append(bytes.Clone(base), []byte(`{}`)...),
	} {
		var output bytes.Buffer
		called := false
		if run(args, bytes.NewReader(raw), &output, func() time.Time { called = true; return time.Now() }) != 1 || called {
			t.Fatal("malformed input reached source or verifier clock")
		}
		var failure transactionCommandResult
		if json.Unmarshal(output.Bytes(), &failure) != nil || failure.Code != "INVALID_REQUEST" || failure.Result != nil {
			t.Fatal(output.String())
		}
	}
	// Explicit decimal/binary representation survives roundtrip without float.
	raw := transactionJSON(t, c.ExpectedTransaction)
	got, _, err := decodeTransactionExpected(raw)
	if err != nil || !reflect.DeepEqual(got, c.ExpectedTransaction) {
		t.Fatal("expected target roundtrip changed", err)
	}
}
