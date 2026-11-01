package main_test

import (
	"bytes"
	"context"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// The root helper CI discovers the actual Cocoa contract without displaying a
// dialog. Injected test decisions are never evidence of an actual human click.
func TestP09QANativeConsentContract(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("actual Cocoa visible producer requires macOS")
	}
	qa, err := filepath.Abs("../../apps/network/qa")
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "native-consent-contract")
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	compile := exec.CommandContext(ctx, "xcrun", "clang", "-fobjc-arc", "-fblocks", "-DQA_NATIVE_CONSENT_TESTING=1", "-Wall", "-Wextra", "-Werror", "-framework", "Cocoa", filepath.Join(qa, "native_consent.m"), filepath.Join(qa, "native_consent_test.m"), "-o", binary)
	if out, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("actual Cocoa consent contract compile: %v %s", err, out)
	}
	if out, err := exec.CommandContext(ctx, binary).CombinedOutput(); err != nil {
		t.Fatalf("actual Cocoa consent contract: %v %s", err, out)
	} else {
		t.Logf("%s", out)
	}
}

func TestP09QANativeConsentExecutableBoundary(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("actual Cocoa executable requires macOS")
	}
	qa, err := filepath.Abs("../../apps/network/qa")
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "ynx-network-native-consent")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	compile := exec.CommandContext(ctx, "xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror", "-framework", "Cocoa", filepath.Join(qa, "native_consent_main.m"), "-o", binary)
	if out, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("actual fixed native producer compile: %v %s", err, out)
	}
	for _, args := range [][]string{nil, {"--native-consent"}, {"--native-consent", "--path", "never-allowed"}} {
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Stdin = bytes.NewBufferString(`{}`)
		var output bytes.Buffer
		cmd.Stdout = &output
		if err := cmd.Run(); err == nil || output.Len() != 0 {
			t.Fatalf("invalid native executable mode/input accepted: %v stdout%d", err, output.Len())
		}
	}
}
