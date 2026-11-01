//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func externalTestIO(f *recoveryProvisionFixture) externalCredentialIO {
	return externalCredentialIO{disk: f.disk, namespace: func() (string, error) { return "owned-test-mount-namespace", nil }}
}

func externalTestPipe(t *testing.T, raw []byte) *os.File {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r
}

func externalTestFailure(t *testing.T, f *recoveryProvisionFixture) (externalCredentialOptions, externalCredentialPriorFailure) {
	t.Helper()
	intentPath := filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
	if err := writeExclusive(intentPath, []byte(legacyCredentialIntent)); err != nil {
		t.Fatal(err)
	}
	id := func(path string, mode os.FileMode) string {
		t.Helper()
		i, err := recoveryCredentialOriginal(path, f.disk.owner, mode, 16<<20)
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	record := externalCredentialPriorFailure{Version: "YNX-PQ-RECOVERY-CREDENTIAL-PRE-ENCRYPTION-FAILURE/v1", Classification: "data", CredentialPath: f.disk.target, IntentPath: intentPath, IntentSHA256: hash([]byte(legacyCredentialIntent)), IntentIdentity: id(intentPath, 0600), HostKeyIdentity: id(f.disk.hostKey, 0400), MachineIDIdentity: id(f.disk.machineID, 0), ProducerSHA256: legacyCredentialProducerSHA, ProducerCommand: "provision-recovery-credential", FailureStage: "pre-encryption-option-parse", ProcessFailureCode: "exit_1", RejectedOption: "--no-ask-password", OptionParsingRejected: true, PrivateReadOnlyMountVerified: true}
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(f.disk.boundary, "independent-public-failure.json")
	if err := writeExclusive(path, raw); err != nil {
		t.Fatal(err)
	}
	return externalCredentialOptions{continuation: true, failurePath: path, failureSHA256: hash(raw), intentSHA256: record.IntentSHA256}, record
}

func externalTestReplaceFailure(t *testing.T, o *externalCredentialOptions, record externalCredentialPriorFailure) {
	t.Helper()
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(o.failurePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	o.failureSHA256 = hash(raw)
}

func TestInstallRecoveryCredentialFreshExternalPipeAndOriginalRefusal(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	input := externalTestPipe(t, f.secret)
	var output bytes.Buffer
	if err := installExternalRecoveryCredential(externalCredentialOptions{}, input, &output, externalTestIO(f)); err != nil {
		t.Fatal(err)
	}
	var r externalCredentialReceipt
	if json.Unmarshal(output.Bytes(), &r) != nil || r.Version != "YNX-PQ-EXTERNAL-RECOVERY-CREDENTIAL-INSTALL/v1" || !r.ExternalCredentialConsumed || r.Continuation || !r.CiphertextInstalled || !r.LocalRoundTripVerified || !r.HostKeyUnchanged || r.OffHostRecoveryVerified || r.AuthorityGranted || r.SigningPerformed || r.HRSHistoryVerified || r.ServiceChanged || r.MachineKeyCreated {
		t.Fatal("external DATA receipt granted unsupported capability", output.String())
	}
	if f.generated != 0 || f.processes != 2 || !bytes.Equal(f.decrypted, make([]byte, 32)) {
		t.Fatal("external path generated a secret or retained owned decrypted buffer")
	}
	if _, err := input.Stat(); !errors.Is(err, os.ErrClosed) {
		t.Fatal("owned inherited FD was retained", err)
	}
	assertCredentialNotDisclosed(t, f, output.Bytes())
	marker := filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
	raw, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	var intent externalCredentialIntent
	if json.Unmarshal(raw, &intent) != nil || intent.InputSource != "owned-inherited-fd-raw32-eof" || intent.AutomaticRetry || intent.Continuation || intent.HostKeyIdentity == "" || intent.MachineIDIdentity == "" || intent.MountNamespace == "" {
		t.Fatal("fresh permanent intent lost source metadata")
	}
	before, _ := os.ReadFile(f.disk.target)
	if err := provisionRecoveryCredential(nil, io.Discard, f.disk); err == nil || f.generated != 0 {
		t.Fatal("legacy producer retried external install")
	}
	if err := installExternalRecoveryCredential(externalCredentialOptions{}, externalTestPipe(t, f.secret), io.Discard, externalTestIO(f)); err == nil {
		t.Fatal("external install overwrote its existing result")
	}
	after, _ := os.ReadFile(f.disk.target)
	if !bytes.Equal(before, after) {
		t.Fatal("original ciphertext changed")
	}
}

func TestInstallRecoveryCredentialPinnedLegacyContinuationPreservesOldIntent(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	o, _ := externalTestFailure(t, f)
	oldPath := filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
	oldBefore, _ := os.Lstat(oldPath)
	var output bytes.Buffer
	if err := installExternalRecoveryCredential(o, externalTestPipe(t, f.secret), &output, externalTestIO(f)); err != nil {
		t.Fatal(err)
	}
	oldAfter, _ := os.Lstat(oldPath)
	oldRaw, _ := os.ReadFile(oldPath)
	if recoveryCredentialIdentity(oldBefore) != recoveryCredentialIdentity(oldAfter) || string(oldRaw) != legacyCredentialIntent {
		t.Fatal("continuation replaced or modified original legacy intent")
	}
	var receipt externalCredentialReceipt
	if json.Unmarshal(output.Bytes(), &receipt) != nil || !receipt.Continuation || receipt.PriorIntentSHA256 != o.intentSHA256 || receipt.PriorFailureSHA256 != o.failureSHA256 || receipt.OffHostRecoveryVerified || receipt.AuthorityGranted {
		t.Fatal("continuation DATA receipt lost independent pins or granted authority")
	}
	path := filepath.Join(filepath.Dir(f.disk.target), externalCredentialContinuation)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var marker externalCredentialIntent
	if json.Unmarshal(raw, &marker) != nil || marker.ParentIntentSHA256 != o.intentSHA256 || marker.PriorFailureSHA256 != o.failureSHA256 || marker.ParentIntentIdentity == "" || marker.PriorFailureIdentity == "" || !marker.Continuation || marker.AutomaticRetry {
		t.Fatal("new continuation barrier lacks held source identity")
	}
	if err := installExternalRecoveryCredential(o, externalTestPipe(t, f.secret), io.Discard, externalTestIO(f)); err == nil {
		t.Fatal("both intents authorized replay")
	}
	if err := provisionRecoveryCredential(nil, io.Discard, f.disk); err == nil || f.generated != 0 {
		t.Fatal("default producer stopped failing closed")
	}
	assertCredentialNotDisclosed(t, f, output.Bytes())
}

func TestInstallRecoveryCredentialRefusesBeforePersistentIntent(t *testing.T) {
	for _, mode := range []string{"empty", "short", "long", "regular-file", "wrong-owner", "not-linux", "missing-host-key", "existing-target", "old-intent-default", "continuation-without-pin", "foreign-failure", "unsafe-failure", "bad-intent-pin", "unknown-failure", "different-producer", "installed-before", "epoch-executed", "authority", "host-mismatch", "intent-identity-mismatch", "noncanonical-failure"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			d := externalTestIO(f)
			o := externalCredentialOptions{}
			raw := bytes.Clone(f.secret)
			var record externalCredentialPriorFailure
			if mode == "old-intent-default" || mode == "continuation-without-pin" || strings.Contains(mode, "failure") || mode == "bad-intent-pin" || mode == "different-producer" || mode == "installed-before" || mode == "epoch-executed" || mode == "authority" || mode == "host-mismatch" || mode == "intent-identity-mismatch" {
				o, record = externalTestFailure(t, f)
			}
			switch mode {
			case "empty":
				raw = nil
			case "short":
				raw = raw[:31]
			case "long":
				raw = append(raw, 0)
			case "wrong-owner":
				d.disk.owner++
			case "not-linux":
				d.disk.linux = false
			case "missing-host-key":
				os.Remove(f.disk.hostKey)
			case "existing-target":
				os.WriteFile(f.disk.target, []byte("retained original ciphertext"), 0600)
			case "old-intent-default":
				o = externalCredentialOptions{}
			case "continuation-without-pin":
				o.intentSHA256 = ""
			case "foreign-failure":
				o.failureSHA256 = strings.Repeat("a", 64)
			case "unsafe-failure":
				os.Chmod(o.failurePath, 0644)
			case "bad-intent-pin":
				o.intentSHA256 = strings.Repeat("b", 64)
			case "unknown-failure":
				record.FailureStage = "unknown"
				externalTestReplaceFailure(t, &o, record)
			case "different-producer":
				record.ProducerSHA256 = strings.Repeat("c", 64)
				externalTestReplaceFailure(t, &o, record)
			case "installed-before":
				record.CiphertextEverInstalled = true
				externalTestReplaceFailure(t, &o, record)
			case "epoch-executed":
				record.PQEpochExecuted = true
				externalTestReplaceFailure(t, &o, record)
			case "authority":
				record.AuthorityGranted = true
				externalTestReplaceFailure(t, &o, record)
			case "host-mismatch":
				record.HostKeyIdentity = "another host"
				externalTestReplaceFailure(t, &o, record)
			case "intent-identity-mismatch":
				record.IntentIdentity = "another original inode"
				externalTestReplaceFailure(t, &o, record)
			case "noncanonical-failure":
				b, _ := os.ReadFile(o.failurePath)
				b = append([]byte(" "), b...)
				os.WriteFile(o.failurePath, b, 0600)
				o.failureSHA256 = hash(b)
			}
			input := externalTestPipe(t, raw)
			if mode == "regular-file" {
				input.Close()
				p := filepath.Join(f.disk.boundary, "PUBLIC-INVALID-FILE-INPUT")
				os.WriteFile(p, raw, 0600)
				var e error
				input, e = os.Open(p)
				if e != nil {
					t.Fatal(e)
				}
			}
			var output bytes.Buffer
			if err := installExternalRecoveryCredential(o, input, &output, d); err == nil || output.Len() != 0 || f.generated != 0 || f.processes != 0 {
				t.Fatal("invalid external input reached persistent processing", mode, err)
			}
			if _, err := input.Stat(); !errors.Is(err, os.ErrClosed) {
				t.Fatal("rejected owned FD was not closed")
			}
			if _, err := os.Lstat(filepath.Join(filepath.Dir(f.disk.target), externalCredentialContinuation)); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("failed preflight left a new continuation barrier")
			}
		})
	}
}

func TestInstallRecoveryCredentialHeldInputsAndNamespaceCannotChange(t *testing.T) {
	for _, mode := range []string{"intent-replace-same-bytes", "failure-replace-same-bytes", "namespace", "host-key"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			o, _ := externalTestFailure(t, f)
			d := externalTestIO(f)
			ns := "original-namespace"
			d.namespace = func() (string, error) { return ns, nil }
			process := d.disk.process
			d.disk.process = func(ctx context.Context, op string, raw []byte, n int) ([]byte, error) {
				result, err := process(ctx, op, raw, n)
				if op == "encrypt" {
					switch mode {
					case "namespace":
						ns = "changed-namespace"
					case "host-key":
						if err := os.WriteFile(f.disk.hostKey+".changed", []byte("changed PUBLIC synthetic host"), 0400); err != nil {
							t.Fatal(err)
						}
						if err := os.Rename(f.disk.hostKey+".changed", f.disk.hostKey); err != nil {
							t.Fatal(err)
						}
					default:
						path := o.failurePath
						if mode == "intent-replace-same-bytes" {
							path = filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
						}
						b, _ := os.ReadFile(path)
						os.WriteFile(path+".changed", b, 0600)
						os.Rename(path+".changed", path)
					}
				}
				return result, err
			}
			if err := installExternalRecoveryCredential(o, externalTestPipe(t, f.secret), io.Discard, d); err == nil {
				t.Fatal("changed held original input was accepted")
			}
			if _, err := os.Lstat(f.disk.target); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("changed source acquired a ciphertext")
			}
			if _, err := os.Lstat(filepath.Join(filepath.Dir(f.disk.target), externalCredentialContinuation)); err != nil {
				t.Fatal("new original failure barrier was deleted")
			}
		})
	}
}

func TestInstallRecoveryCredentialPostIntentFailuresRetainOriginal(t *testing.T) {
	for _, mode := range []string{"encrypt", "decrypt", "ciphertext-write", "public-output"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			d := externalTestIO(f)
			process := d.disk.process
			d.disk.process = func(ctx context.Context, op string, raw []byte, n int) ([]byte, error) {
				if mode == op {
					return nil, errors.New("synthetic private process failure")
				}
				return process(ctx, op, raw, n)
			}
			write := d.disk.write
			d.disk.write = func(dir *os.File, name string, raw []byte) (string, error) {
				if mode == "ciphertext-write" && name == filepath.Base(f.disk.target) {
					return "", io.ErrShortWrite
				}
				return write(dir, name, raw)
			}
			var output io.Writer = io.Discard
			if mode == "public-output" {
				output = credentialRefusedWriter{}
			}
			if err := installExternalRecoveryCredential(externalCredentialOptions{}, externalTestPipe(t, f.secret), output, d); err == nil {
				t.Fatal("uncertain original result was accepted")
			}
			marker := filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
			info, err := os.Lstat(marker)
			if err != nil {
				t.Fatal("failure marker not retained", err)
			}
			before := recoveryCredentialIdentity(info)
			if err := installExternalRecoveryCredential(externalCredentialOptions{}, externalTestPipe(t, f.secret), io.Discard, d); err == nil {
				t.Fatal("retained original attempt was retried")
			}
			after, _ := os.Lstat(marker)
			if recoveryCredentialIdentity(after) != before || f.generated != 0 {
				t.Fatal("retained marker changed or secret was generated")
			}
		})
	}
}

func TestInstallRecoveryCredentialSafeStagePreservesFirstCause(t *testing.T) {
	for _, mode := range []string{"encrypt", "decrypt", "untrusted-error", "untrusted-code"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			d := externalTestIO(f)
			input := externalTestPipe(t, f.secret)
			process := d.disk.process
			d.disk.process = func(ctx context.Context, op string, raw []byte, n int) ([]byte, error) {
				if op == mode || op == "encrypt" && strings.HasPrefix(mode, "untrusted-") {
					// The accepted FD was closed before processing. Its deferred
					// second Close must not replace the actual first process error.
					if err := input.Close(); !errors.Is(err, os.ErrClosed) {
						t.Fatal("input remained open during private process")
					}
					if mode == "untrusted-error" {
						return nil, errors.New(string(raw))
					}
					if mode == "untrusted-code" {
						return nil, &recoveryCredentialProcessFailure{code: "PRIVATE-ARBITRARY-DIAGNOSTIC"}
					}
					return nil, &recoveryCredentialProcessFailure{code: "exit_1"}
				}
				return process(ctx, op, raw, n)
			}
			err := installExternalRecoveryCredential(externalCredentialOptions{}, input, io.Discard, d)
			if err == nil || !strings.Contains(err.Error(), "original attempt retained") || !strings.Contains(err.Error(), "without retry") || strings.Contains(err.Error(), string(f.secret)) || strings.Contains(err.Error(), "PRIVATE-ARBITRARY") || strings.Contains(err.Error(), os.ErrClosed.Error()) {
				t.Fatal("first cause was obscured or private error crossed boundary", err)
			}
			if (mode == "encrypt" || mode == "decrypt") && !strings.Contains(err.Error(), mode+" exit_1") {
				t.Fatal("safe original stage/process code lost", err)
			}
			if mode == "untrusted-code" && !strings.Contains(err.Error(), "unclassified_process_failure") {
				t.Fatal("arbitrary process code accepted", err)
			}
			if _, e := os.Lstat(filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)); e != nil {
				t.Fatal("error removed permanent original intent")
			}
		})
	}
}

func TestExternalRecoveryCredentialPipeEOFDeadlineAndStrictOptions(t *testing.T) {
	if raw, err := readExternalCredential(context.Background(), os.Stdin); err == nil || len(raw) != 0 {
		t.Fatal("shared FD reader accepted standard input instead of an explicit inherited fd>=3")
	}
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	defer w.Close()
	if _, err = w.Write(bytes.Repeat([]byte{0x61}, 32)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if raw, err := readExternalCredential(ctx, r); err == nil || len(raw) != 0 {
		t.Fatal("missing EOF escaped bounded input")
	}
	for _, args := range [][]string{{}, {"--recovery-fd", "2"}, {"--recovery-fd", "3", "--recovery-fd", "4"}, {"--recovery-fd", "3", "--credential", "must-never-be-accepted"}, {"--recovery-fd", "3", "--prior-intent-sha256", strings.Repeat("a", 64)}, {"--recovery-fd", "3", "--continue-prior-failure"}} {
		if _, err := parseExternalCredentialOptions(args); err == nil || strings.Contains(err.Error(), "must-never-be-accepted") {
			t.Fatal("ambiguous/private option accepted or echoed", args, err)
		}
	}
	if _, err := parseExternalCredentialOptions([]string{"--recovery-fd=3"}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"install-recovery-credential"}, io.Discard, io.Discard, realCeremonyIO()); err == nil || strings.Contains(err.Error(), "new epoch") {
		t.Fatal("normal command dispatch bypassed external parser", err)
	}
}

func TestInstallRecoveryCredentialPrivateInheritedUnixSocket(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err != nil {
		t.Fatal(err)
	}
	r := os.NewFile(uintptr(fds[0]), "owned-private-unix-receiver")
	w := os.NewFile(uintptr(fds[1]), "independent-test-custody-sender")
	defer r.Close()
	defer w.Close()
	if _, err := w.Write(f.secret); err != nil {
		t.Fatal(err)
	}
	w.Close()
	if err := installExternalRecoveryCredential(externalCredentialOptions{}, r, io.Discard, externalTestIO(f)); err != nil {
		t.Fatal("actual inherited Unix socket failed", err)
	}
	if f.generated != 0 {
		t.Fatal("external socket created a credential")
	}
}

func TestExternalRecoveryCredentialRejectsNamedFilesystemFIFO(t *testing.T) {
	p := filepath.Join(t.TempDir(), "PUBLIC-INVALID-NAMED-CREDENTIAL-FIFO")
	if err := unix.Mkfifo(p, 0600); err != nil {
		t.Fatal(err)
	}
	rfd, err := unix.Open(p, unix.O_RDONLY|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	r := os.NewFile(uintptr(rfd), "filesystem-FIFO-cannot-become-private-FD-interface")
	defer r.Close()
	wfd, err := unix.Open(p, unix.O_WRONLY|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := unix.Write(wfd, bytes.Repeat([]byte{0x61}, 32)); err != nil {
		unix.Close(wfd)
		t.Fatal(err)
	}
	unix.Close(wfd)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if raw, err := readExternalCredential(ctx, r); err == nil || len(raw) != 0 || !strings.Contains(err.Error(), "anonymous") {
		t.Fatal("named FIFO was accepted as anonymous inherited input", err)
	}
}

func TestExternalRecoveryCredentialInheritedFDHelper(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-1] != "external-credential-fd-worker" {
		return
	}
	f := newRecoveryProvisionFixture(t)
	input := os.NewFile(3, "owned-inherited-test-pipe")
	var output bytes.Buffer
	if err := installExternalRecoveryCredential(externalCredentialOptions{}, input, &output, externalTestIO(f)); err != nil {
		os.Exit(11)
	}
	if _, err := input.Stat(); !errors.Is(err, os.ErrClosed) {
		os.Exit(12)
	}
	if bytes.Contains(output.Bytes(), f.secret) || f.generated != 0 {
		os.Exit(13)
	}
	clear(f.secret)
	clear(f.issued)
	clear(f.decrypted)
	_, _ = os.Stdout.Write(output.Bytes())
	os.Exit(0)
}

func TestInstallRecoveryCredentialActualInheritedFDProcess(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	defer w.Close()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestExternalRecoveryCredentialInheritedFDHelper$", "--", "external-credential-fd-worker")
	cmd.ExtraFiles = []*os.File{r}
	cmd.Env = append(os.Environ(), "TMPDIR="+t.TempDir())
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	r.Close()
	if _, err := w.Write(bytes.Repeat([]byte{0xa5}, 32)); err != nil {
		t.Fatal(err)
	}
	w.Close()
	if err := cmd.Wait(); err != nil {
		t.Fatal("real inherited FD child failed", err, stderr.String())
	}
	var receipt externalCredentialReceipt
	if json.Unmarshal(stdout.Bytes(), &receipt) != nil || !receipt.ExternalCredentialConsumed || !receipt.LocalRoundTripVerified || receipt.AuthorityGranted || receipt.OffHostRecoveryVerified {
		t.Fatal("real FD child supplied invalid DATA receipt")
	}
}

func TestInstallRecoveryCredentialMainRealCapsuleRoutes(t *testing.T) {
	f, _, parent := capsulePUBLICFixture(t)
	export := filepath.Join(parent, "normal-main-export")
	args := capsulePUBLICExportArgs(t, f, export, f.credential)
	var output, diagnostics bytes.Buffer
	if err := func() error {
		defer capsulePUBLICCloseFD(args)
		return run(append([]string{"export-recovery-capsule"}, args...), &output, &diagnostics, realCeremonyIO())
	}(); err != nil {
		t.Fatal("normal main export did not reach real capsule callee", err)
	}
	capsulePUBLICNoAuthority(t, output.Bytes())
	verify := capsulePUBLICVerifyArgs(t, f, export, filepath.Join(parent, "normal-main-verify"), f.credential)
	output.Reset()
	if err := func() error {
		defer capsulePUBLICCloseFD(verify)
		return run(append([]string{"verify-recovery-capsule"}, verify...), &output, &diagnostics, realCeremonyIO())
	}(); err != nil {
		t.Fatal("normal main verify did not reach real capsule callee", err)
	}
	capsulePUBLICNoAuthority(t, output.Bytes())
}
