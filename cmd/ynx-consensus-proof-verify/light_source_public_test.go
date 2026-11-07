//go:build (linux || darwin) && ynx_public_trace_testsupport

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Consumes the SAME normal exporter output produced from the fixed PUBLIC DB
// trace. The normal verifier parses the original 24-field context and request;
// this test never reconstructs or replaces its verifier/authority source.
func TestPQLightSourcePUBLICNormalVerifier(t *testing.T) {
	directory := os.Getenv("YNX_PUBLIC_LIGHT_SOURCE_EXPORT")
	if directory == "" || !filepath.IsAbs(directory) {
		t.Fatal("normal PUBLIC light exporter delivery required")
	}
	raw, err := os.ReadFile(filepath.Join(directory, "PUBLIC-test-receipt.json"))
	if err != nil {
		t.Fatal(err)
	}
	var public struct {
		Receipt consensus.PQLightSourceReceipt `json:"receipt"`
		Now     time.Time                      `json:"now"`
	}
	if json.Unmarshal(raw, &public) != nil || public.Now.IsZero() {
		t.Fatal("public receipt/clock required")
	}
	receipt := public.Receipt
	input, err := os.ReadFile(receipt.RequestPath)
	if err != nil {
		t.Fatal(err)
	}
	if !matchesSHA256(input, receipt.RequestSHA256) {
		t.Fatal("normal original request pin differs")
	}
	args := []string{"--trust-context", receipt.ContextPath, "--trust-context-sha256", receipt.ContextSHA256}
	var output bytes.Buffer
	code := run(args, bytes.NewReader(input), &output, func() time.Time { return public.Now })
	var result commandResult
	if code != 0 || json.Unmarshal(output.Bytes(), &result) != nil || result.Code != "VERIFIED_DATA" || result.Result == nil || !result.Result.CommitVerified || !result.Result.LightTransitionVerified || result.Result.HeaderHeight != 12 || result.Result.StateHeight != 11 {
		t.Fatalf("normal verifier rejected exact public output: code=%d result=%s", code, output.String())
	}
	t.Run("independent_expected_substitution", func(t *testing.T) {
		var request proofInput
		if json.Unmarshal(input, &request) != nil {
			t.Fatal("request shape")
		}
		request.Expected.StateHeight = "10"
		bad, _ := json.Marshal(request)
		output.Reset()
		if run(args, bytes.NewReader(bad), &output, func() time.Time { return public.Now }) == 0 {
			t.Fatal("different expected statement accepted")
		}
	})
	t.Run("independent_context_pin", func(t *testing.T) {
		args[3] = "1111111111111111111111111111111111111111111111111111111111111111"
		output.Reset()
		if run(args, bytes.NewReader(input), &output, func() time.Time { return public.Now }) == 0 {
			t.Fatal("foreign context pin accepted")
		}
	})
}
