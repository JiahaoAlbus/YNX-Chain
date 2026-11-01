package nativeconsent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type onlyReader struct{ reader *bytes.Reader }

func (r *onlyReader) Read(b []byte) (int, error) { return r.reader.Read(b) }

func TestNativeConsentOutputBoundWithReaderOnlyCopy(t *testing.T) {
	cancelled := false
	output := &capped{limit: 2048, cancel: func() { cancelled = true }}
	// os/exec's copy must always pass through the bounded Write. Promoting
	// bytes.Buffer.ReadFrom would bypass that guard for an io.Reader-only pipe.
	if _, ok := any(output).(io.ReaderFrom); ok {
		t.Fatal("promoted ReaderFrom bypasses output bound")
	}
	_, err := io.Copy(output, &onlyReader{bytes.NewReader(bytes.Repeat([]byte("x"), 4096))})
	if !errors.Is(err, ErrInvalid) || !cancelled || !output.exceeded || output.Len() > 2048 {
		t.Fatalf("output bound: %v cancel%t bytes%d", err, cancelled, output.Len())
	}
}

func TestBundledNativeIdentityAndPreservation(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("actual Cocoa main-bundle identity requires macOS")
	}
	qa, err := filepath.Abs("../qa")
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), executableName)
	command := exec.Command("xcrun", "clang", "-arch", "arm64", "-mmacosx-version-min=12.0", "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Werror", "-framework", "Cocoa", filepath.Join(qa, "native_consent_main.m"), "-o", binary)
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("actual Cocoa executable build: %v %s", err, out)
	}
	code, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	template, err := os.ReadFile(filepath.Join(qa, "native_consent_info.plist"))
	if err != nil {
		t.Fatal(err)
	}
	metadata := []byte(strings.Replace(string(template), "__YNX_CONSENT_BUNDLE_ID__", "dev.ynx.network.consent.qa.h0123456789abcdef", 1))
	pin := func(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
	fixture := func(t *testing.T, info []byte) (string, string) {
		t.Helper()
		base := filepath.Join(t.TempDir(), BundleName, "Contents")
		if err := os.MkdirAll(filepath.Join(base, "MacOS"), 0700); err != nil {
			t.Fatal(err)
		}
		source := filepath.Join(base, "MacOS", executableName)
		if err := os.WriteFile(source, code, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(base, "Info.plist"), info, 0600); err != nil {
			t.Fatal(err)
		}
		return source, filepath.Join(base, "Info.plist")
	}
	open := func(t *testing.T) (*Producer, string, string) {
		t.Helper()
		source, info := fixture(t, metadata)
		p, err := NewBundled(source, pin(code), pin(metadata), "ar", "dark")
		if err != nil {
			t.Fatal(err)
		}
		return p, source, info
	}
	t.Run("actual-captured-main-bundle", func(t *testing.T) {
		p, source, info := open(t)
		root := p.directory
		result, err := p.ReadIdentity(context.Background())
		if err != nil || result.BundleIdentifier != "dev.ynx.network.consent.qa.h0123456789abcdef" || result.Authority {
			t.Fatalf("actual Cocoa capture identity %+v %v", result, err)
		}
		if !strings.HasSuffix(p.captured, filepath.Join(BundleName, "Contents", "MacOS", executableName)) {
			t.Fatal("capture lost bundle hierarchy")
		}
		if err = p.Close(); err != nil {
			t.Fatal(err)
		}
		if err = p.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err = os.Stat(root); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("known capture remained")
		}
		if _, err = os.Stat(source); err != nil {
			t.Fatal(err)
		}
		if _, err = os.Stat(info); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("wrong-independent-info-pin", func(t *testing.T) {
		source, _ := fixture(t, metadata)
		if p, err := NewBundled(source, pin(code), strings.Repeat("0", 64), "en", "light"); err == nil {
			_ = p.Close()
			t.Fatal("bad independent metadata digest accepted")
		}
	})
	for _, test := range []struct {
		name     string
		metadata []byte
	}{{"wrong-executable", []byte(strings.Replace(string(metadata), executableName, "other-program", 1))}, {"wrong-identifier", []byte(strings.Replace(string(metadata), "dev.ynx.network.consent.qa.h0123456789abcdef", "other.identity", 1))}, {"coerced-bool", []byte(strings.Replace(string(metadata), "<key>LSUIElement</key><true/>", "<key>LSUIElement</key><string>true</string>", 1))}, {"extra-metadata", []byte(strings.Replace(string(metadata), "</dict>", "<key>NSMainNibFile</key><string>never-allowed</string></dict>", 1))}} {
		t.Run(test.name, func(t *testing.T) {
			source, _ := fixture(t, test.metadata)
			if p, err := NewBundled(source, pin(code), pin(test.metadata), "en", "light"); err == nil {
				_ = p.Close()
				t.Fatal("unexpected metadata accepted")
			}
		})
	}
	t.Run("source-info-replaced-same-bytes", func(t *testing.T) {
		p, _, info := open(t)
		defer p.Close()
		if err := os.Rename(info, info+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(info, metadata, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := p.ReadIdentity(context.Background()); !errors.Is(err, ErrInvalid) {
			t.Fatalf("replaced metadata identity accepted %v", err)
		}
		if _, err := os.Stat(info + ".original"); err != nil {
			t.Fatal("original source metadata lost")
		}
	})
	t.Run("unknown-capture-entry-preserved", func(t *testing.T) {
		p, _, _ := open(t)
		extra := filepath.Join(p.bundle.dirs[0].path, "unknown")
		if err := os.WriteFile(extra, []byte("retained"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := p.Close(); !errors.Is(err, ErrInvalid) {
			t.Fatalf("unknown capture entry cleanup %v", err)
		}
		if _, err := os.Stat(extra); err != nil {
			t.Fatal("unknown capture entry deleted")
		}
		if _, err := os.Stat(p.captured); err != nil {
			t.Fatal("original captured executable deleted")
		}
		if err := os.Remove(extra); err != nil {
			t.Fatal(err)
		}
		if err := p.Close(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("changed-captured-info-preserved", func(t *testing.T) {
		p, _, _ := open(t)
		t.Cleanup(func() { _ = os.RemoveAll(p.directory) })
		if err := os.WriteFile(p.bundle.infoPath, []byte("changed"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := p.ReadIdentity(context.Background()); !errors.Is(err, ErrInvalid) {
			t.Fatalf("changed capture info admitted %v", err)
		}
		if err := p.Close(); !errors.Is(err, ErrInvalid) {
			t.Fatalf("changed capture info cleanup %v", err)
		}
		if _, err := os.Stat(p.bundle.infoPath); err != nil {
			t.Fatal("changed capture metadata deleted")
		}
	})
	t.Run("changed-bundle-directory-preserved", func(t *testing.T) {
		p, _, _ := open(t)
		t.Cleanup(func() { _ = os.RemoveAll(p.directory) })
		original := p.bundle.dirs[0].path
		if err := os.Rename(original, original+".retained"); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(original, 0700); err != nil {
			t.Fatal(err)
		}
		if _, err := p.ReadIdentity(context.Background()); !errors.Is(err, ErrInvalid) {
			t.Fatalf("changed captured app identity admitted %v", err)
		}
		if err := p.Close(); !errors.Is(err, ErrInvalid) {
			t.Fatalf("unknown replacement app cleanup %v", err)
		}
		if _, err := os.Stat(original + ".retained"); err != nil {
			t.Fatal("original captured app deleted")
		}
		if _, err := os.Stat(original); err != nil {
			t.Fatal("replacement directory deleted")
		}
	})
}
