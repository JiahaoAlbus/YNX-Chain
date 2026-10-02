package finance

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func diagnosticFailure(code string) string {
	value, _ := json.Marshal(map[string]any{"schemaVersion": "ynx-finance-endpoint-authority-runtime/v1", "status": "PRIVATE_SERVICE_DEGRADED", "code": code, "officialSandboxVerified": false, "providerVerified": false, "productionApproved": false})
	return string(value)
}
func diagnosticGate(t *testing.T, body string, observe func(EndpointAuthorityDiagnostic)) *nodeEndpointAuthority {
	t.Helper()
	dir := t.TempDir()
	script := filepath.Join(dir, "reader.sh")
	if err := os.WriteFile(script, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	gate, err := NewNodeEndpointAuthority(NodeEndpointAuthorityConfig{NodeBinary: "/bin/sh", Script: script, TrustRootFile: filepath.Join(dir, "root"), ManifestFile: filepath.Join(dir, "manifest"), CheckpointFile: filepath.Join(dir, "prefix"), TrustedTimeFile: filepath.Join(dir, "time"), Timeout: time.Second, Diagnostic: observe})
	if err != nil {
		t.Fatal(err)
	}
	return gate.(*nodeEndpointAuthority)
}
func TestEndpointAuthorityDiagnosticChildFailures(t *testing.T) {
	for _, tc := range []struct {
		name, output, cause, public string
		stderr                      bool
	}{
		{"clock", diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK"), "AUTHORITY_V2_CLOCK_ROLLBACK", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"expiry", diagnosticFailure("AUTHORITY_V2_EXPIRED_OR_FUTURE"), "AUTHORITY_V2_EXPIRED_OR_FUTURE", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"signature", diagnosticFailure("AUTHORITY_V2_SIGNATURE_INVALID"), "AUTHORITY_V2_SIGNATURE_INVALID", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"unknown", diagnosticFailure("SECRET_PATH_TOKEN_DO_NOT_LOG"), "UNKNOWN_CAUSE", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"malformed", `{broken SECRET_PATH_TOKEN_DO_NOT_LOG`, "INVALID_FAILURE_SHAPE", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"duplicate", strings.Replace(diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK"), "{", `{"code":"AUTHORITY_V2_CLOCK_ROLLBACK",`, 1), "INVALID_FAILURE_SHAPE", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"trailing", diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK") + "{}", "INVALID_FAILURE_SHAPE", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"extra", strings.Replace(diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK"), "{", `{"extra":"SECRET_PATH_TOKEN_DO_NOT_LOG",`, 1), "INVALID_FAILURE_SHAPE", "FINANCE_AUTHORITY_V2_REJECTED", false},
		{"oversize", strings.Repeat("X", 16385), "OUTPUT_BOUND", "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", false},
		{"stderr", diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK"), "STDERR_PRESENT", "FINANCE_AUTHORITY_V2_INVALID_RESPONSE", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var events []EndpointAuthorityDiagnostic
			script := "printf '%s\\n' '" + tc.output + "'\n"
			if tc.stderr {
				script += "printf '%s\\n' 'SECRET_PATH_TOKEN_DO_NOT_LOG' >&2\n"
			}
			script += "exit 3\n"
			gate := diagnosticGate(t, script, func(event EndpointAuthorityDiagnostic) { events = append(events, event) })
			_, err := gate.run(context.Background(), "browser-config")
			var typed *productsessionv2.Error
			if !errors.As(err, &typed) || typed.Code != tc.public || typed.Status != 503 {
				t.Fatal("public failure semantics changed", err)
			}
			if len(events) != 1 || events[0].Cause != tc.cause || events[0].Operation != "browser-config" || events[0].Exit != "degraded" || events[0].TotalMilliseconds < 0 || events[0].ExecutionMilliseconds < 0 {
				t.Fatal("incorrect diagnostic event", events)
			}
			encoded, _ := json.Marshal(events)
			if strings.Contains(string(encoded), "SECRET_PATH_TOKEN_DO_NOT_LOG") || strings.Contains(string(encoded), gate.config.Script) {
				t.Fatal("diagnostic contains child text or path")
			}
		})
	}
}
func TestEndpointAuthorityDiagnosticBusyTimeoutAndObserverIsolation(t *testing.T) {
	var events []EndpointAuthorityDiagnostic
	gate := diagnosticGate(t, "exec /bin/sleep 2\n", func(e EndpointAuthorityDiagnostic) { events = append(events, e) })
	_, err := gate.run(context.Background(), "")
	var typed *productsessionv2.Error
	if !errors.As(err, &typed) || typed.Code != "FINANCE_AUTHORITY_V2_TIMEOUT" || events[0].Cause != "TIMEOUT" || events[0].Exit != "signal" {
		t.Fatal("execution timeout not identified", err, events)
	}
	events = nil
	for i := 0; i < cap(gate.slots); i++ {
		gate.slots <- struct{}{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err = gate.run(ctx, "browser-history")
	if !errors.As(err, &typed) || typed.Code != "FINANCE_AUTHORITY_V2_BUSY" || events[0].Cause != "BUSY" || events[0].Exit != "not_started" {
		t.Fatal("queue timeout not identified", err, events)
	}
	other := diagnosticGate(t, "exit 3\n", func(EndpointAuthorityDiagnostic) { panic("observer") })
	if _, err = other.run(context.Background(), ""); !errors.As(err, &typed) || typed.Code != "FINANCE_AUTHORITY_V2_REJECTED" {
		t.Fatal("observer changed fail-closed decision", err)
	}
}

func TestEndpointAuthorityDiagnosticSuccessfulChildInvalidResponse(t *testing.T) {
	var events []EndpointAuthorityDiagnostic
	gate := diagnosticGate(t, "printf '%s\\n' '{\"malformed\":\"SECRET_PATH_TOKEN_DO_NOT_LOG\"}'\n", func(e EndpointAuthorityDiagnostic) { events = append(events, e) })
	_, err := gate.BrowserConfig(context.Background())
	var typed *productsessionv2.Error
	if !errors.As(err, &typed) || typed.Code != "FINANCE_AUTHORITY_V2_INVALID_RESPONSE" || len(events) != 1 || events[0].Phase != "response" || events[0].Cause != "STRICT_RESPONSE_INVALID" || events[0].Exit != "success" {
		t.Fatal("successful process invalid response not safely classified", err, events)
	}
}
