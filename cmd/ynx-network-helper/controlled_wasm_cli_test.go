//go:build unix

package main_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

func TestP09ControlledWASMPackagedCLI(t *testing.T) {
	worker, pin := wasmRunnerBinary(t)
	helper := filepath.Join(filepath.Dir(worker), "ynx-network-helper")
	flags := "-X main.resourceWorkerSHA256=" + pin
	if runtime.GOOS == "darwin" {
		_, mpin := resourceMonitorBinary(t, filepath.Dir(worker))
		flags += " -X main.resourceMonitorSHA256=" + mpin
	}
	build := exec.Command(filepath.Join(runtime.GOROOT(), "bin/go"), "build", "-mod=readonly", "-p", "1", "-ldflags", flags, "-o", helper, ".")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("actual helper build: %v %s", err, out)
	}
	ip, ik, _ := ed25519.GenerateKey(rand.Reader)
	cp, ck, _ := ed25519.GenerateKey(rand.Reader)
	keyPin := func(key []byte) string { h := sha256.Sum256(key); return hex.EncodeToString(h[:]) }
	input := []byte(`{"height":"synthetic-cli-fixture"}`)
	limits := contribution.Limits{CPUMilli: "1000", MemoryBytes: "9000000", StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
	w := contribution.Work{Job: "cli-fixture", Kind: contribution.PublicBlockHistogramKind, Issuer: "temporary-issuer", Input: contribution.Bind(input), Limits: limits, ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)}
	c := contribution.Consent{Principal: "temporary-person", Job: w.Job, Manifest: contribution.Bind(contribution.ManifestPayload(w)), Limits: limits, ExpiresAt: w.ExpiresAt, Nonce: "cli-fixture-once", Allow: true}
	packet := map[string]any{"version": "YNX-NETWORK-CONTROLLED-WASM-PACKET/v1", "classification": contribution.SandboxClass, "work": w, "consent": c, "issuerPublicKey": hex.EncodeToString(ip), "consentPublicKey": hex.EncodeToString(cp), "manifestSignature": hex.EncodeToString(ed25519.Sign(ik, contribution.ManifestPayload(w))), "consentSignature": hex.EncodeToString(ed25519.Sign(ck, contribution.ConsentPayload(c))), "input": input}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "packet.json")
	write := func() {
		raw, err := json.Marshal(packet)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write()
	args := []string{"--run-controlled-wasm", file, "--data-dir", dir, "--controlled-issuer-key-sha256", keyPin(ip), "--controlled-consent-key-sha256", keyPin(cp)}
	run := func(arguments []string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, helper, arguments...).CombinedOutput()
	}
	var original string
	for _, starts := range []uint64{1, 0} {
		out, err := run(args)
		if err != nil {
			t.Fatalf("controlled normal CLI: %v %s", err, out)
		}
		var report struct {
			Classification string               `json:"classification"`
			Production     bool                 `json:"productionEnabled"`
			Human          bool                 `json:"humanConsentEstablished"`
			Worker         uint64               `json:"workerExecutions"`
			Stopped        bool                 `json:"stopped"`
			After          bool                 `json:"workerAfterStop"`
			Receipt        contribution.Receipt `json:"receipt"`
			Meter          contribution.Meter   `json:"meter"`
		}
		if err := json.Unmarshal(out, &report); err != nil {
			t.Fatal(err)
		}
		if report.Classification != contribution.SandboxClass || report.Production || report.Human || report.Worker != starts || !report.Stopped || report.After || report.Meter.VerifiedJobs != 1 {
			t.Fatalf("false controlled report: %s", out)
		}
		if original != "" && report.Receipt.ID != original {
			t.Fatal("restart changed original receipt")
		}
		original = report.Receipt.ID
	}
	for _, name := range []string{"wrong-pin", "bad-signature", "unknown-field", "missing-pin", "extra-option", "positional"} {
		t.Run(name, func(t *testing.T) {
			modified := append([]string(nil), args...)
			switch name {
			case "wrong-pin":
				modified[5] = strings.Repeat("0", 64)
			case "bad-signature":
				packet["manifestSignature"] = strings.Repeat("0", 128)
				write()
				defer func() {
					packet["manifestSignature"] = hex.EncodeToString(ed25519.Sign(ik, contribution.ManifestPayload(w)))
					write()
				}()
			case "unknown-field":
				packet["executable"] = "never-allowed"
				write()
				defer func() { delete(packet, "executable"); write() }()
			case "missing-pin":
				modified = modified[:6]
			case "extra-option":
				modified = append(modified, "--rpc", "https://rpc.ynxweb4.com")
			case "positional":
				modified = append(modified, "unexpected")
			}
			if out, err := run(modified); err == nil {
				t.Fatalf("invalid CLI accepted: %s", out)
			}
		})
	}
}
