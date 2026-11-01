package main_test

import (
	"context"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestP09NativeConsentBundledCaptureContract(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("actual Cocoa main bundle requires macOS")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin/go"), "test", "-race", "-mod=readonly", "-p", "1", "-run", "^(TestBundledNativeIdentityAndPreservation|TestNativeConsentOutputBoundWithReaderOnlyCopy)$", "-count=1", "-v", "./apps/network/nativeconsent")
	cmd.Dir = "../.."
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("actual capture bundle contract: %v %s", err, out)
	}
	if !strings.Contains(string(out), "--- PASS: TestBundledNativeIdentityAndPreservation") || !strings.Contains(string(out), "--- PASS: TestNativeConsentOutputBoundWithReaderOnlyCopy") {
		t.Fatalf("new native capture tests did not run: %s", out)
	}
	t.Logf("%s", out)
}

func TestP09QANativeConsentIdentityEntry(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("actual Cocoa main bundle requires macOS")
	}
	qa, err := filepath.Abs("../../apps/network/qa")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	binary := filepath.Join(dir, "ynx-network-native-consent")
	harness := filepath.Join(dir, "identity-contract")
	fixtures := filepath.Join(dir, "fixtures")
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	for _, step := range []struct{ source, framework, out string }{{"native_consent_main.m", "Cocoa", binary}, {"native_consent_identity_test.m", "Foundation", harness}} {
		cmd := exec.CommandContext(ctx, "xcrun", "clang", "-arch", "arm64", "-mmacosx-version-min=12.0", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror", "-framework", step.framework, filepath.Join(qa, step.source), "-o", step.out)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("actual identity executable compile: %v %s", err, out)
		}
	}
	if out, err := exec.CommandContext(ctx, harness, binary, fixtures).CombinedOutput(); err != nil {
		t.Fatalf("actual main bundle identity: %v %s", err, out)
	} else {
		t.Logf("%s", out)
	}
}
