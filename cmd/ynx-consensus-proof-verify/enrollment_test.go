//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type enrollmentBrokenWriter struct{}

func (enrollmentBrokenWriter) Write([]byte) (int, error) {
	return 0, errors.New("synthetic output failure")
}

func TestPQLabEnrollmentVerifierNormalEntryAndOriginalRefusals(t *testing.T) {
	t.Run("legacy-funding", func(t *testing.T) { testPQLabEnrollmentVerifier(t, true) })
	t.Run("pq-funding", func(t *testing.T) { testPQLabEnrollmentVerifier(t, false) })
}

func testPQLabEnrollmentVerifier(t *testing.T, legacy bool) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixturePath := filepath.Join(dir, "synthetic-original-fixture.json")
	producerTest := "^TestPQLabEnrollmentCLIPublicFixture$"
	if legacy {
		producerTest = "^TestPQLabEnrollmentLegacyCLIPublicFixture$"
	}
	producer := exec.Command("go", "test", "../../internal/consensus", "-run", producerTest, "-count=1")
	producer.Env = append(os.Environ(), "YNX_ENROLLMENT_FIXTURE_OUT="+fixturePath)
	if output, err := producer.CombinedOutput(); err != nil {
		t.Fatalf("real synthetic proof fixture producer: %v: %s", err, output)
	}
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Version           string            `json:"version"`
		SyntheticOnly     bool              `json:"syntheticOnly"`
		Materials         map[string][]byte `json:"materials"`
		Trust             map[string]string `json:"trust"`
		Pins              map[string]string `json:"pins"`
		FundingExpected   json.RawMessage   `json:"fundingExpected"`
		MigrationExpected json.RawMessage   `json:"migrationExpected"`
		FundingProof      json.RawMessage   `json:"fundingProof"`
		MigrationProof    json.RawMessage   `json:"migrationProof"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil || fixture.Version != "YNX-PQ-ENROLLMENT-PUBLIC-FIXTURE/v1" || !fixture.SyntheticOnly {
		t.Fatal("invalid synthetic source fixture", err)
	}
	for name, data := range fixture.Materials {
		if filepath.Base(name) != name || len(data) == 0 {
			t.Fatal("invalid material")
		}
		if err = os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for field, name := range map[string]string{"migrationFile": "migration.json", "genesisFile": "genesis.json", "stateFile": "state.json", "scheduleFile": "schedule.json", "trustedLightBlockFile": "trusted.json"} {
		fixture.Trust[field] = filepath.Join(dir, name)
	}
	context := map[string]any{"version": enrollmentContextVersion, "lightTrust": fixture.Trust, "pins": fixture.Pins, "fundingExpected": fixture.FundingExpected, "migrationExpected": fixture.MigrationExpected, "fundingOriginalFile": filepath.Join(dir, "funding.tx"), "migrationOriginalFile": filepath.Join(dir, "migration.tx")}
	contextRaw := transactionJSON(t, context)
	path := filepath.Join(dir, "context.json")
	if err = os.WriteFile(path, contextRaw, 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"enrollment", "--trust-context", path, "--trust-context-sha256", hostTestSHA(contextRaw)}
	request := map[string]any{"version": enrollmentRequestVersion, "fundingProof": fixture.FundingProof, "migrationProof": fixture.MigrationProof}
	requestRaw := transactionJSON(t, request)
	invoke := func(a []string, input []byte) (int, enrollmentResult) {
		t.Helper()
		var out bytes.Buffer
		status := run(a, bytes.NewReader(input), &out, time.Now)
		var result enrollmentResult
		if err := json.Unmarshal(out.Bytes(), &result); err != nil {
			t.Fatalf("invalid CLI output %s: %v", out.String(), err)
		}
		return status, result
	}
	status, result := invoke(args, requestRaw)
	if status != 0 || result.Code != "VERIFIED_HISTORICAL_DATA" || result.CurrentEligibility != "UNKNOWN" || result.OperationIdentity != "UNKNOWN" || result.NativeGrant || result.Result == nil || !result.Result.Funding.ExecutionSuccessful || !result.Result.Migration.ExecutionSuccessful {
		t.Fatal("normal offline enrollment verification failed", status, result)
	}
	t.Run("broken output never reports success", func(t *testing.T) {
		if status := run(args, bytes.NewReader(requestRaw), enrollmentBrokenWriter{}, time.Now); status != 1 {
			t.Fatal("failed successful-result output reported success")
		}
		if status := run([]string{"enrollment"}, bytes.NewReader(nil), enrollmentBrokenWriter{}, time.Now); status != 1 {
			t.Fatal("failed error output reported success")
		}
	})
	badArgs := append([]string(nil), args...)
	badArgs[4] = strings.Repeat("1", 64)
	if s, r := invoke(badArgs, requestRaw); s == 0 || r.Code != "TRUST_CONTEXT_INVALID" || r.Result != nil {
		t.Fatal("wrong context pin accepted", s, r)
	}
	t.Run("expired trust public stage retained", func(t *testing.T) {
		previous := fixture.Trust["trustingPeriodNanoseconds"]
		fixture.Trust["trustingPeriodNanoseconds"] = "1"
		expired := transactionJSON(t, context)
		fixture.Trust["trustingPeriodNanoseconds"] = previous
		if err := os.WriteFile(path, expired, 0600); err != nil {
			t.Fatal(err)
		}
		a := append([]string(nil), args...)
		a[4] = hostTestSHA(expired)
		if s, r := invoke(a, requestRaw); s == 0 || r.Code != "PROOF_REJECTED" || !strings.HasPrefix(r.Error, "expired_trust:") || r.OperationIdentity != "UNKNOWN" || r.CurrentEligibility != "UNKNOWN" || r.NativeGrant {
			t.Fatal("expired trust cause not preserved", s, r)
		}
		if err := os.WriteFile(path, contextRaw, 0600); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("fabricated operation identity refused", func(t *testing.T) {
		context["operationId"] = "invented"
		forged := transactionJSON(t, context)
		delete(context, "operationId")
		if err := os.WriteFile(path, forged, 0600); err != nil {
			t.Fatal(err)
		}
		a := append([]string(nil), args...)
		a[4] = hostTestSHA(forged)
		if s, r := invoke(a, requestRaw); s == 0 || r.Code != "TRUST_CONTEXT_INVALID" || r.OperationIdentity != "UNKNOWN" {
			t.Fatal("fabricated outbox identity accepted", s, r)
		}
		if err := os.WriteFile(path, contextRaw, 0600); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("oversize context refused", func(t *testing.T) {
		large := filepath.Join(dir, "oversize.json")
		file, err := os.OpenFile(large, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			t.Fatal(err)
		}
		if err = file.Truncate(maxEnrollmentContextBytes + 1); err != nil {
			t.Fatal(err)
		}
		if err = file.Close(); err != nil {
			t.Fatal(err)
		}
		a := append([]string(nil), args...)
		a[2] = large
		if s, r := invoke(a, requestRaw); s == 0 || r.Code != "TRUST_CONTEXT_INVALID" || r.Result != nil {
			t.Fatal("oversize context accepted", s, r)
		}
	})
	modes := []string{"missing original", "symlink original", "proof substitution"}
	if legacy {
		modes = append(modes, "same owner wrong original")
	}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			fundingPath := filepath.Join(dir, "funding.tx")
			original := fixture.Materials["funding.tx"]
			switch mode {
			case "same owner wrong original":
				alternate := fixture.Materials["same-owner-alternate.tx"]
				if len(alternate) == 0 || bytes.Equal(alternate, original) {
					t.Fatal("missing signed alternate original")
				}
				if err := os.WriteFile(fundingPath, alternate, 0600); err != nil {
					t.Fatal(err)
				}
			case "missing original":
				if err := os.Remove(fundingPath); err != nil {
					t.Fatal(err)
				}
			case "symlink original":
				if err := os.Remove(fundingPath); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(dir, "migration.tx"), fundingPath); err != nil {
					t.Fatal(err)
				}
			}
			input := requestRaw
			if mode == "proof substitution" {
				changed := map[string]any{"version": enrollmentRequestVersion, "fundingProof": fixture.MigrationProof, "migrationProof": fixture.MigrationProof}
				input = transactionJSON(t, changed)
			}
			s, r := invoke(args, input)
			if s == 0 || r.Result != nil || r.CurrentEligibility != "UNKNOWN" || r.OperationIdentity != "UNKNOWN" || r.NativeGrant {
				t.Fatal("invalid original accepted", s, r)
			}
			if mode == "proof substitution" && (r.Code != "PROOF_REJECTED" || !strings.Contains(r.Error, ":")) {
				t.Fatal("bounded proof failure stage missing", r)
			}
			if mode != "proof substitution" {
				if err := os.Remove(fundingPath); err != nil && !os.IsNotExist(err) {
					t.Fatal(err)
				}
				if err := os.WriteFile(fundingPath, original, 0600); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
