package finance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func phaseLine(phase string, ms int) string {
	return fmt.Sprintf(`{"schemaVersion":"ynx-finance-authority-phase/v1","phase":%q,"elapsedMilliseconds":%d}`+"\n", phase, ms)
}
func TestAuthorityPhaseClosedMetadata(t *testing.T) {
	good := phaseLine("cli-ready", 0) + phaseLine("clock-fetch", 20)
	phase, ms, status := decodeAuthorityPhases([]byte(good))
	if phase != "clock-fetch" || ms != 20 || status != "available" {
		t.Fatal(phase, ms, status)
	}
	for name, raw := range map[string]string{
		"unknown":   phaseLine("SECRET_PATH_ACCOUNT_TOKEN", 20),
		"extra":     strings.Replace(good, "{", `{"path":"SECRET_PATH_ACCOUNT_TOKEN",`, 1),
		"duplicate": strings.Replace(good, "{", `{"phase":"clock-fetch",`, 1),
		"malformed": "not-json\n", "trailing": strings.TrimSpace(phaseLine("clock-fetch", 20)) + "{}\n",
		"partial": strings.TrimSpace(good), "backward": phaseLine("clock-body", 20) + phaseLine("clock-fetch", 19),
		"float":      strings.Replace(phaseLine("clock-fetch", 20), ":20", ":1.5", 1),
		"exponent":   strings.Replace(phaseLine("clock-fetch", 20), ":20", ":1e2", 1),
		"time-bound": phaseLine("clock-fetch", 60001), "lines": strings.Repeat(phaseLine("cli-ready", 0), 25),
		"bytes": strings.Repeat("x", 4097), "utf8": string([]byte{0xff, '\n'}),
	} {
		t.Run(name, func(t *testing.T) {
			p, n, s := decodeAuthorityPhases([]byte(raw))
			if p != "unknown" || n != 0 || s != "invalid" {
				t.Fatal(p, n, s)
			}
		})
	}
	if p, n, s := decodeAuthorityPhases(nil); p != "unknown" || n != 0 || s != "none" {
		t.Fatal(p, n, s)
	}
}
func TestAuthorityPhaseActualNodeReporter(t *testing.T) {
	node := os.Getenv("YNX_QA_NODE_BINARY")
	if node == "" {
		node = "/opt/homebrew/bin/node"
	}
	if _, err := os.Stat(node); err != nil {
		t.Fatal("provide existing YNX_QA_NODE_BINARY; no install", err)
	}
	_, file, _, _ := runtime.Caller(0)
	module := (&url.URL{Scheme: "file", Path: filepath.Join(filepath.Dir(file), "../../apps/finance/authority/trusted-time.mjs")}).String()
	for _, tc := range []struct {
		name, body, cause, phase, status string
		timeout                          time.Duration
	}{
		{"real-pipe", `recordFinanceAuthorityPhase('clock-fetch');process.stdout.write(` + fmt.Sprintf("%q", diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK")) + `);process.exitCode=3;`, "AUTHORITY_V2_CLOCK_ROLLBACK", "clock-fetch", "available", time.Second},
		{"real-timeout", `recordFinanceAuthorityPhase('clock-body');setInterval(()=>{},1000);`, "TIMEOUT", "clock-body", "available", 750 * time.Millisecond},
		{"closed-pipe", `import{closeSync}from'node:fs';closeSync(3);recordFinanceAuthorityPhase('clock-fetch');process.stdout.write(` + fmt.Sprintf("%q", diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK")) + `);process.exitCode=3;`, "AUTHORITY_V2_CLOCK_ROLLBACK", "unknown", "none", time.Second},
		{"reporter-bound", `for(let i=0;i<10000;i++)recordFinanceAuthorityPhase('clock-fetch');process.stdout.write(` + fmt.Sprintf("%q", diagnosticFailure("AUTHORITY_V2_CLOCK_ROLLBACK")) + `);process.exitCode=3;`, "AUTHORITY_V2_CLOCK_ROLLBACK", "clock-fetch", "available", time.Second},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var events []EndpointAuthorityDiagnostic
			gate := diagnosticGate(t, "", func(e EndpointAuthorityDiagnostic) { events = append(events, e) })
			script := filepath.Join(t.TempDir(), "phase.mjs")
			source := fmt.Sprintf("import{recordFinanceAuthorityPhase}from %q;\n%s\n", module, tc.body)
			if err := os.WriteFile(script, []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			gate.config.NodeBinary = node
			gate.config.Script = script
			gate.config.Timeout = tc.timeout
			_, err := gate.run(context.Background(), "browser-config")
			var typed *productsessionv2.Error
			if !errors.As(err, &typed) || typed.Status != 503 {
				t.Fatal("public failclosed changed", err)
			}
			if len(events) != 1 || events[0].Cause != tc.cause || events[0].ChildPhase != tc.phase || events[0].ChildTelemetry != tc.status {
				t.Fatal(events)
			}
			bytes, _ := json.Marshal(events)
			if strings.Contains(string(bytes), script) || strings.Contains(string(bytes), module) {
				t.Fatal("path leaked")
			}
		})
	}
}
func TestAuthorityPhaseMalformedChildDoesNotAuthorize(t *testing.T) {
	var events []EndpointAuthorityDiagnostic
	body := "printf '%s\\n' 'SECRET_PATH_ACCOUNT_TOKEN' >&3\nprintf '%s\\n' '" + diagnosticFailure("AUTHORITY_V2_SIGNATURE_INVALID") + "'\nexit 3\n"
	g := diagnosticGate(t, body, func(e EndpointAuthorityDiagnostic) { events = append(events, e) })
	_, err := g.run(context.Background(), "browser-history")
	if err == nil || len(events) != 1 || events[0].Cause != "AUTHORITY_V2_SIGNATURE_INVALID" || events[0].ChildTelemetry != "invalid" || events[0].ChildPhase != "unknown" {
		t.Fatal(err, events)
	}
}

func TestAuthorityPhaseRealClockRollback(t *testing.T) {
	node := os.Getenv("YNX_QA_NODE_BINARY")
	if node == "" {
		node = "/opt/homebrew/bin/node"
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(home, "ynx-phase-clock-qa-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "clock.json")
	if err := os.WriteFile(file, []byte(`{"schemaVersion":"ynx-trusted-time/v1","unixTimeMs":1800000000000}`), 0600); err != nil {
		t.Fatal(err)
	}
	_, caller, _, _ := runtime.Caller(0)
	module := (&url.URL{Scheme: "file", Path: filepath.Join(filepath.Dir(caller), "../../apps/finance/authority/trusted-time.mjs")}).String()
	var events []EndpointAuthorityDiagnostic
	gate := diagnosticGate(t, "", func(e EndpointAuthorityDiagnostic) { events = append(events, e) })
	script := filepath.Join(t.TempDir(), "rollback.mjs")
	body := fmt.Sprintf(`import{sampleFinanceTrustedClock}from %q;
try{await sampleFinanceTrustedClock(%q,{monotonic:()=>0,fetchImpl:async(u,i)=>new Response(JSON.stringify({schemaVersion:2,ok:true,requestId:i.headers['x-request-id'],result:{serverTime:new Date(1790000000000).toISOString()}}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':i.headers['x-request-id']}})});}catch(e){process.stdout.write(JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-runtime/v1',status:'PRIVATE_SERVICE_DEGRADED',code:e.message,officialSandboxVerified:false,providerVerified:false,productionApproved:false}));process.exitCode=3;}`, module, file)
	if err := os.WriteFile(script, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	gate.config.NodeBinary = node
	gate.config.Script = script
	_, err = gate.run(context.Background(), "browser-config")
	if err == nil || len(events) != 1 || events[0].Cause != "AUTHORITY_V2_CLOCK_ROLLBACK" || events[0].ChildPhase != "clock-persist" || events[0].ChildTelemetry != "available" {
		t.Fatal(err, events)
	}
	saved, err := os.ReadFile(file)
	if err != nil || !strings.Contains(string(saved), "1800000000000") {
		t.Fatal("rollback highwater changed", err)
	}
}
