package main

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestPQNodeOptionsNeverSilentlyDowngradePartialConfiguration(t *testing.T) {
	legacy := pqOptions{recoveryFD: -1}
	if legacy.enabled() {
		t.Fatal("legacy mode changed")
	}
	for _, options := range []pqOptions{{migration: "original.json", recoveryFD: -1}, {recoveryFD: 0}, {vault: "existing.enc", recoveryFD: 3}} {
		if !options.enabled() || options.validate() == nil {
			t.Fatal("partial PQ configuration silently downgraded")
		}
	}
}

func TestPQNodeRemoteOptionsRequireIndependentPinsAndExcludeLocalCustody(t *testing.T) {
	valid := pqOptions{migration: "migration.json", state: "committed.json", genesisHash: "genesis-pin", originalGenesisHash: "native-pin", migrationHash: "migration-pin", schedule: "schedule.json", scheduleHash: "schedule-pin", binding: "public-binding.json", recoveryFD: -1, remoteAddress: "tcp://127.0.0.1:27701", transportKey: "existing.transport", peerPin: "full-signer.pub"}
	if !valid.enabled() || !valid.remote() || valid.validate() != nil || valid.transport().Timeout != 5*time.Second {
		t.Fatal("explicit remote mode rejected")
	}
	for _, mutate := range []func(*pqOptions){func(p *pqOptions) { p.peerPin = "" }, func(p *pqOptions) { p.transportKey = "" }, func(p *pqOptions) { p.originalGenesisHash = "" }, func(p *pqOptions) { p.remoteAddress = "" }, func(p *pqOptions) { p.vault = "local.vault" }, func(p *pqOptions) { p.recoveryFD = 3 }, func(p *pqOptions) { p.remoteTimeout = -time.Second }, func(p *pqOptions) { p.remoteAddress = "http://signer" }} {
		bad := valid
		mutate(&bad)
		if bad.validate() == nil {
			t.Fatal("partial/dual-mode remote configuration accepted")
		}
	}
	for _, partial := range []pqOptions{{peerPin: "full-signer.pub", recoveryFD: -1}, {transportKey: "existing.transport", recoveryFD: -1}, {remoteTimeout: time.Second, recoveryFD: -1}} {
		if !partial.enabled() || partial.validate() == nil {
			t.Fatal("partial remote flags fell through to legacy command")
		}
	}
}

func TestPQNodeCredentialDescriptorConsumesExactRawLength(t *testing.T) {
	if _, err := readRecoveryCredential(0); err == nil {
		t.Fatal("standard input selected as implicit credential")
	}
	for _, size := range []int{0, 31, 32, 33} {
		reader, writer, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		input := bytes.Repeat([]byte{0x31}, size)
		if _, err := writer.Write(input); err != nil {
			t.Fatal(err)
		}
		writer.Close()
		// Model an inherited descriptor with one owning File wrapper. Avoid
		// two os.File finalizers referring to the same numeric descriptor.
		fd, err := syscall.Dup(int(reader.Fd()))
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		credential, err := readRecoveryCredential(fd)
		if size == 32 {
			if err != nil || !bytes.Equal(credential, input) {
				t.Fatal("exact private credential rejected")
			}
			clear(credential)
		} else if err == nil || credential != nil {
			t.Fatal("malformed credential accepted or retained")
		}
	}
}

func TestPQNodePublicBindingsKeepExactUint64AndRejectDuplicateConfiguration(t *testing.T) {
	type public struct {
		Nonce uint64 `json:"nonce"`
	}
	var value public
	if err := decodeStrict([]byte(`{"nonce":18446744073709551615}`), &value); err != nil || value.Nonce != math.MaxUint64 {
		t.Fatal("public uint64 lost precision", err)
	}
	for _, raw := range []string{`{"nonce":1,"nonce":2}`, `{"nonce":1,"foreign":true}`, `{"nonce":1} {"nonce":2}`, `null`} {
		if err := decodeStrict([]byte(raw), &public{}); err == nil {
			t.Fatal("ambiguous operator binding accepted")
		}
	}
}

func TestPQNodeExistingIdentityFilesCannotBeMissingPublicOrSymlinked(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "isolated-identity.json")
	if err := existingPrivateFile(path); err == nil {
		t.Fatal("missing identity would be generated")
	}
	if err := os.WriteFile(path, []byte("public-only-fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := existingPrivateFile(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := existingPrivateFile(path); err == nil {
		t.Fatal("public-readable key accepted")
	}
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(directory, "identity-link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if err := existingPrivateFile(link); err == nil {
		t.Fatal("symlink identity accepted")
	}
}
