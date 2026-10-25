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
	"strconv"
	"strings"
	"testing"
	"time"
)

type recoveryProvisionFixture struct {
	disk                                  recoveryCredentialIO
	secret, issued, decrypted, ciphertext []byte
	generated, processes                  int
}

func newRecoveryProvisionFixture(t *testing.T) *recoveryProvisionFixture {
	t.Helper()
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, "owned-private-control")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"store", "host", "tools"} {
		if err := os.Mkdir(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	f := &recoveryProvisionFixture{secret: bytes.Repeat([]byte{0xa5}, 32), ciphertext: []byte("synthetic-systemd-ciphertext-DATA-not-a-cryptographic-result")}
	f.disk = recoveryCredentialIO{target: filepath.Join(root, "store", recoveryCredentialName), hostKey: filepath.Join(root, "host", "credential.secret"), machineID: filepath.Join(root, "machine-id"), boundary: root, owner: uint32(os.Geteuid()), linux: true, write: writeRecoveryCredentialExclusive}
	for path, mode := range map[string]os.FileMode{f.disk.hostKey: 0400, f.disk.machineID: 0444, filepath.Join(root, "tools", "synthetic-tool"): 0700} {
		if err := os.WriteFile(path, []byte("public synthetic metadata control, never an OS key"), mode); err != nil {
			t.Fatal(err)
		}
	}
	f.disk.tools = []string{filepath.Join(root, "tools", "synthetic-tool")}
	f.disk.generate = func() ([]byte, error) { f.generated++; f.issued = bytes.Clone(f.secret); return f.issued, nil }
	f.disk.process = func(ctx context.Context, operation string, raw []byte, limit int) ([]byte, error) {
		f.processes++
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		switch operation {
		case "encrypt":
			if !bytes.Equal(raw, f.secret) || limit != recoveryCredentialMaximum {
				t.Error("original raw32 did not reach only the private process input")
			}
			return bytes.Clone(f.ciphertext), nil
		case "decrypt":
			if !bytes.Equal(raw, f.ciphertext) || limit != 32 {
				t.Error("round-trip did not use exact original ciphertext and raw32 bound")
			}
			f.decrypted = bytes.Clone(f.secret)
			return f.decrypted, nil
		default:
			t.Error("nonfixed credential operation")
			return nil, errors.New("unexpected operation")
		}
	}
	t.Cleanup(func() { clear(f.secret); clear(f.issued); clear(f.decrypted) })
	return f
}

func assertCredentialNotDisclosed(t *testing.T, f *recoveryProvisionFixture, output []byte) {
	t.Helper()
	if bytes.Contains(output, f.secret) {
		t.Fatal("raw credential reached public output")
	}
	entries, err := os.ReadDir(filepath.Dir(f.disk.target))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(filepath.Dir(f.disk.target), entry.Name()))
		if err != nil || bytes.Contains(raw, f.secret) {
			t.Fatal("raw credential reached a regular file", err)
		}
	}
}

func TestProvisionRecoveryCredentialExclusiveRoundTripAndRestartRefusal(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	var output bytes.Buffer
	if err := provisionRecoveryCredential(nil, &output, f.disk); err != nil {
		t.Fatal(err)
	}
	var result recoveryCredentialReceipt
	if json.Unmarshal(output.Bytes(), &result) != nil || result.Version != "YNX-PQ-RECOVERY-CREDENTIAL-PROVISION/v1" || result.Classification != "data" || result.CredentialPath != f.disk.target || result.CiphertextSHA256 != hash(f.ciphertext) || result.CiphertextBytes != strconv.Itoa(len(f.ciphertext)) || result.OwnerUID != strconv.Itoa(os.Geteuid()) || result.Mode != "600" || result.EncryptionProfile != "systemd-default-auto" || !result.CiphertextInstalled || !result.LocalRoundTripVerified || !result.HostKeyUnchanged || result.MachineKeyCreated || result.AuthorityGranted || result.OffHostRecoveryVerified || result.HRSHistoryVerified || result.SigningPerformed || result.ServiceChanged {
		t.Fatal("credential DATA receipt misstates the original local result", output.String())
	}
	if f.generated != 1 || f.processes != 2 || !bytes.Equal(f.issued, make([]byte, 32)) || !bytes.Equal(f.decrypted, make([]byte, 32)) {
		t.Fatal("credential generation/round-trip count or owned memory cleanup differs")
	}
	assertCredentialNotDisclosed(t, f, output.Bytes())
	before, err := os.Lstat(f.disk.target)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(f.disk.target)
	if err != nil || !bytes.Equal(raw, f.ciphertext) {
		t.Fatal("original ciphertext differs", err)
	}
	if err := provisionRecoveryCredential(nil, io.Discard, f.disk); err == nil {
		t.Fatal("restart automatically rebuilt an existing credential")
	}
	after, err := os.Lstat(f.disk.target)
	if err != nil || recoveryCredentialIdentity(before) != recoveryCredentialIdentity(after) || f.generated != 1 || f.processes != 2 {
		t.Fatal("restart changed original credential or invoked a process", err)
	}
}

func TestProvisionRecoveryCredentialRefusesBeforeGenerationOrExecution(t *testing.T) {
	for _, mode := range []string{"arguments", "not-linux", "wrong-owner", "existing", "UNKNOWN", "symlink", "unsafe-parent", "missing-host-key", "hardlink-host-key", "unsafe-tool"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			var args []string
			switch mode {
			case "arguments":
				args = []string{"--output", "must-not-select-a-path"}
			case "not-linux":
				f.disk.linux = false
			case "wrong-owner":
				f.disk.owner++
			case "existing":
				if err := os.WriteFile(f.disk.target, []byte("original retained ciphertext"), 0600); err != nil {
					t.Fatal(err)
				}
			case "UNKNOWN":
				if err := os.WriteFile(filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName), []byte("original UNKNOWN"), 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink(f.disk.machineID, f.disk.target); err != nil {
					t.Fatal(err)
				}
			case "unsafe-parent":
				if err := os.Chmod(filepath.Dir(f.disk.target), 0777); err != nil {
					t.Fatal(err)
				}
			case "missing-host-key":
				if err := os.Remove(f.disk.hostKey); err != nil {
					t.Fatal(err)
				}
			case "hardlink-host-key":
				if err := os.Link(f.disk.hostKey, f.disk.hostKey+".alias"); err != nil {
					t.Fatal(err)
				}
			case "unsafe-tool":
				if err := os.Chmod(f.disk.tools[0], 0777); err != nil {
					t.Fatal(err)
				}
			}
			var output bytes.Buffer
			if err := provisionRecoveryCredential(args, &output, f.disk); err == nil || output.Len() != 0 || f.generated != 0 || f.processes != 0 {
				t.Fatal("invalid input reached secret generation or an executable", err)
			}
		})
	}
}

func TestProvisionRecoveryCredentialRetainsEveryFailedOriginalWithoutRetry(t *testing.T) {
	for _, mode := range []string{"generate", "encrypt", "decrypt", "mismatch", "overlong", "host-changed", "target-partial", "same-bytes-replaced", "stdout"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			process := f.disk.process
			if mode == "generate" {
				f.disk.generate = func() ([]byte, error) { f.generated++; return nil, errors.New("private generator failure") }
			}
			f.disk.process = func(ctx context.Context, operation string, raw []byte, limit int) ([]byte, error) {
				if mode == operation {
					f.processes++
					return bytes.Clone(f.secret), errors.New("private process diagnostics must not escape")
				}
				if mode == "host-changed" && operation == "encrypt" {
					if err := os.Chmod(f.disk.hostKey, 0600); err != nil {
						t.Error(err)
					}
				}
				if operation == "decrypt" && (mode == "mismatch" || mode == "overlong") {
					f.processes++
					return bytes.Repeat([]byte{7}, map[bool]int{true: 33, false: 32}[mode == "overlong"]), nil
				}
				return process(ctx, operation, raw, limit)
			}
			write := f.disk.write
			f.disk.write = func(dir *os.File, name string, raw []byte) (string, error) {
				if name == recoveryCredentialName && mode == "target-partial" {
					identity, err := write(dir, name, raw[:3])
					return identity, errors.Join(err, errors.New("synthetic partial persistence"))
				}
				identity, err := write(dir, name, raw)
				if err == nil && name == recoveryCredentialName && mode == "same-bytes-replaced" {
					if err = os.Rename(f.disk.target, f.disk.target+".original"); err == nil {
						err = os.WriteFile(f.disk.target, raw, 0600)
					}
				}
				return identity, err
			}
			var output bytes.Buffer
			var destination io.Writer = &output
			if mode == "stdout" {
				destination = credentialRefusedWriter{}
			}
			if err := provisionRecoveryCredential(nil, destination, f.disk); err == nil || !strings.Contains(err.Error(), "original attempt retained") || strings.Contains(err.Error(), "private process diagnostics") {
				t.Fatal("failed attempt lost its classified first cause", err)
			}
			marker := filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
			before, err := os.Lstat(marker)
			if err != nil {
				t.Fatal("failed original intent was removed", err)
			}
			generated, processes := f.generated, f.processes
			if err := provisionRecoveryCredential(nil, io.Discard, f.disk); err == nil || f.generated != generated || f.processes != processes {
				t.Fatal("UNKNOWN automatically regenerated or re-executed", err)
			}
			after, err := os.Lstat(marker)
			if err != nil || recoveryCredentialIdentity(before) != recoveryCredentialIdentity(after) {
				t.Fatal("UNKNOWN marker changed on restart", err)
			}
			assertCredentialNotDisclosed(t, f, output.Bytes())
		})
	}
}

func TestProvisionRecoveryCredentialPartialIntentStopsBeforeGeneration(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	write := f.disk.write
	f.disk.write = func(directory *os.File, name string, raw []byte) (string, error) {
		identity, err := write(directory, name, raw[:1])
		return identity, errors.Join(err, errors.New("synthetic intent durability failure"))
	}
	if err := provisionRecoveryCredential(nil, io.Discard, f.disk); err == nil || f.generated != 0 || f.processes != 0 {
		t.Fatal("partial intent reached credential generation or a process", err)
	}
	marker := filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
	raw, err := os.ReadFile(marker)
	if err != nil || len(raw) != 1 {
		t.Fatal("partial intent was removed or repaired", err)
	}
	f.disk.write = write
	if err := provisionRecoveryCredential(nil, io.Discard, f.disk); err == nil || f.generated != 0 || f.processes != 0 {
		t.Fatal("partial intent authorized automatic retry", err)
	}
}

type credentialRefusedWriter struct{}

func (credentialRefusedWriter) Write([]byte) (int, error) {
	return 0, errors.New("synthetic public output failure")
}

func TestProvisionRecoveryCredentialFixedDefaultProfileAndPrivateMounts(t *testing.T) {
	for _, operation := range []string{"encrypt", "decrypt"} {
		args, err := recoveryCredentialCommand(operation)
		joined := strings.Join(args, " ")
		if err != nil || args[0] != "/usr/bin/unshare" || !strings.Contains(joined, "--mount --propagation private") || !strings.Contains(joined, "mount --bind /var/lib/systemd /var/lib/systemd") || !strings.Contains(joined, "remount,bind,ro") || !strings.Contains(joined, "exec /usr/bin/systemd-creds") || !strings.Contains(joined, "--name=ynx-pq-recovery") || strings.Contains(joined, "--with-key") || strings.Contains(joined, "setup") || strings.Contains(joined, "--user") || strings.Contains(joined, "--allow-null") {
			t.Fatal("fixed child changed encryption or original host write scope", args, err)
		}
		if strings.Join(args[len(args)-3:], " ") != operation+" - -" {
			t.Fatal("credential did not use anonymous input/output", args)
		}
	}
	if _, err := recoveryCredentialCommand("setup"); err == nil {
		t.Fatal("OS setup silently entered credential provisioning")
	}
}

func TestProvisionRecoveryCredentialNormalOperatorSourceUsesOriginalRuntimeAndTransport(t *testing.T) {
	path := filepath.Join("..", "..", "scripts", "ops", "prepare-consensus-recovery-credential.sh")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{"ynx_ops_init", "YNX_DEPLOY_CONNECTION_ATTEMPTS=1", "CONSENSUS_CANDIDATE_KEY_CEREMONY_APPROVED", "ynx_require_clean_worktree", `validate_runtime_bundle "$bundle" "$commit" "$manifest_pin"`, `prepare_runtime_bundle "$bundle" "$commit" "$manifest_pin"`, "ynx_ops_ssh", "ynx_ops_copy", "primary)", "singapore)", "silicon-valley)", "seoul)", "--kill-after=1 25", `exec "$stage/verified/ynx-consensus-pq-key-init" provision-recovery-credential`, "credential.json.partial", "machineKeyCreated", "authorityGranted"} {
		if !strings.Contains(source, required) {
			t.Fatal("normal credential operator lost original caller boundary", required)
		}
	}
	if strings.Contains(source, "systemd-creds encrypt") || strings.Contains(source, "systemctl ") || strings.Contains(source, "--new-epoch") || strings.Contains(source, "ssh -i") || strings.Contains(source, "rm -") {
		t.Fatal("operator bypassed fixed producer, transport or UNKNOWN preservation")
	}
	if strings.Index(source, `validate_runtime_bundle "$bundle" "$commit" "$manifest_pin"`) > strings.Index(source, `ynx_ops_ssh "$role"`) {
		t.Fatal("credential host contacted before full normal runtime validation")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if output, err := exec.CommandContext(ctx, "bash", "-n", path).CombinedOutput(); err != nil {
		t.Fatal("normal credential wrapper shell syntax", err, string(output))
	}
}

// The child fixture tests the actual bounded pipe/process adapter. It never
// runs systemd, mount, unshare, SSH, a node, or an operator credential.
func TestRecoveryCredentialProcessHelper(t *testing.T) {
	args := os.Args
	if len(args) < 3 || args[len(args)-2] != "credential-process-control" {
		return
	}
	mode := args[len(args)-1]
	if mode == "sleep" {
		time.Sleep(5 * time.Second)
		os.Exit(0)
	}
	info, err := os.Stdin.Stat()
	if err != nil || info.Mode()&os.ModeNamedPipe == 0 {
		os.Exit(4)
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 33))
	if err != nil || len(raw) != 32 {
		os.Exit(5)
	}
	if mode == "overflow" {
		_, _ = os.Stdout.Write(bytes.Repeat([]byte{'x'}, 4096))
		os.Exit(0)
	}
	if mode == "private-error" {
		_, _ = os.Stderr.Write(raw)
		clear(raw)
		os.Exit(7)
	}
	_, _ = os.Stdout.Write([]byte("public-control"))
	clear(raw)
	os.Exit(0)
}

func TestProvisionRecoveryCredentialProcessBoundsAnonymousPipeAndDiagnosticRedaction(t *testing.T) {
	secret := bytes.Repeat([]byte{0x53}, 32)
	defer clear(secret)
	for _, mode := range []string{"success", "overflow", "private-error", "sleep"} {
		budget := 2 * time.Second
		if mode == "sleep" {
			budget = 100 * time.Millisecond
		}
		ctx, cancel := context.WithTimeout(context.Background(), budget)
		args := []string{os.Args[0], "-test.run=^TestRecoveryCredentialProcessHelper$", "--", "credential-process-control", mode}
		raw, err := executeRecoveryCredentialProcess(ctx, args, secret, 32)
		cancel()
		if mode == "success" {
			if err != nil || string(raw) != "public-control" {
				t.Fatal("real anonymous pipe process failed", err)
			}
		} else if err == nil || len(raw) != 0 || strings.Contains(err.Error(), string(secret)) {
			t.Fatal("bounded process leaked output or ignored failure", mode, err)
		}
		clear(raw)
	}
}
