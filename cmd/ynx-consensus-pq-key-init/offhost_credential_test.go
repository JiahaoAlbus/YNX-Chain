//go:build unix

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
)

func TestOffhostRecoveryCredentialFiniteRolesAndOriginalProducer(t *testing.T) {
	original := realRecoveryCredentialIO()
	seen := map[string]bool{}
	for _, role := range []string{"primary", "singapore", "silicon-valley", "seoul"} {
		want := "/etc/credstore.encrypted/ynx-pq-offhost/" + role + "/ynx-pq-recovery"
		disk, err := realOffhostRecoveryCredentialIO(role)
		if err != nil || disk.target != want || seen[disk.target] || disk.target == recoveryCredentialPath || disk.requiredParentMode != 0700 {
			t.Fatal("finite role did not select its independent fixed target", role, err)
		}
		seen[disk.target] = true
		if disk.hostKey != original.hostKey || disk.machineID != original.machineID || disk.boundary != original.boundary || disk.owner != original.owner || disk.linux != original.linux || !reflect.DeepEqual(disk.tools, original.tools) || reflect.ValueOf(disk.generate).Pointer() != reflect.ValueOf(original.generate).Pointer() || reflect.ValueOf(disk.process).Pointer() != reflect.ValueOf(original.process).Pointer() || reflect.ValueOf(disk.write).Pointer() != reflect.ValueOf(original.write).Pointer() {
			t.Fatal("off-host role changed the original generator, crypto or system isolation")
		}
		if got, err := parseOffhostRecoveryCredentialRole([]string{"--source-role", role}); err != nil || got != role {
			t.Fatal("fixed source role rejected", err)
		}
	}
	if original.target != recoveryCredentialPath || original.requiredParentMode != 0 {
		t.Fatal("off-host selection changed the original local target or parent policy")
	}
	for _, args := range [][]string{nil, {"--source-role"}, {"--source-role", "PRIMARY"}, {"--source-role", "primary/../seoul"}, {"--source-role", " primary"}, {"--source-role=primary"}, {"--source-role", "primary", "--source-role", "seoul"}, {"--source-role", "primary", "--target", "/tmp/private"}, {"--source-role", "PUBLIC-rejected-private-argument"}, {"--credential", "PUBLIC-rejected-private-argument"}} {
		if _, err := parseOffhostRecoveryCredentialRole(args); err == nil || strings.Contains(err.Error(), "PUBLIC-rejected-private-argument") {
			t.Fatal("arbitrary role/path/credential input accepted or echoed", args, err)
		}
		for _, command := range []string{"provision-offhost-recovery-credential", "inspect-offhost-recovery-credential"} {
			var out, diagnostics bytes.Buffer
			if err := run(append([]string{command}, args...), &out, &diagnostics, realCeremonyIO()); err == nil || out.Len() != 0 || diagnostics.Len() != 0 || strings.Contains(err.Error(), "PUBLIC-rejected-private-argument") {
				t.Fatal("normal command did not reject private inputs before any side effect", command, err)
			}
		}
	}
}

func TestOffhostRecoveryCredentialRealGenerationRoleIsolationAndLocalPreservation(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	localTarget := f.disk.target
	localIntent := filepath.Join(filepath.Dir(localTarget), recoveryCredentialIntentName)
	for path, raw := range map[string][]byte{localTarget: []byte("PUBLIC retained original local ciphertext"), localIntent: []byte("PUBLIC retained local failed UNKNOWN intent")} {
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	localBefore := map[string]string{}
	for _, path := range []string{localTarget, localIntent, f.disk.hostKey, f.disk.machineID} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		localBefore[path] = recoveryCredentialIdentity(info)
	}
	seen := map[string]bool{}
	for _, role := range []string{"primary", "singapore", "silicon-valley", "seoul"} {
		t.Run(role, func(t *testing.T) {
			parent := filepath.Join(f.disk.boundary, "offhost-"+role)
			if err := os.Mkdir(parent, 0700); err != nil {
				t.Fatal(err)
			}
			disk := f.disk
			disk.target = filepath.Join(parent, recoveryCredentialName)
			var issued, roundtrip, copyForCheck, ciphertext []byte
			defer func() { clear(issued); clear(roundtrip); clear(copyForCheck); clear(ciphertext) }()
			generated, processes := 0, 0
			disk.generate = func() ([]byte, error) {
				generated++
				var err error
				issued, err = ynxconsensusauth.GenerateHostRecoveryCredential()
				copyForCheck = bytes.Clone(issued)
				if seen[hash(issued)] {
					t.Error("source roles reused a raw recovery credential")
				}
				seen[hash(issued)] = true
				return issued, err
			}
			disk.process = func(_ context.Context, op string, raw []byte, bound int) ([]byte, error) {
				processes++
				switch op {
				case "encrypt":
					if !bytes.Equal(raw, copyForCheck) || bound != recoveryCredentialMaximum {
						t.Fatal("raw32 left original bounded encryption input")
					}
					ciphertext = []byte("PUBLIC SYNTHETIC CIPHERTEXT " + hash(raw))
					return bytes.Clone(ciphertext), nil
				case "decrypt":
					if !bytes.Equal(raw, ciphertext) || bound != 32 {
						t.Fatal("local roundtrip changed original ciphertext or raw32 bound")
					}
					roundtrip = bytes.Clone(copyForCheck)
					return roundtrip, nil
				}
				return nil, errors.New("nonfixed process operation")
			}
			var out bytes.Buffer
			if err := provisionOffhostRecoveryCredential(role, &out, disk); err != nil {
				t.Fatal(err)
			}
			var receipt offhostCredentialReceipt
			if json.Unmarshal(out.Bytes(), &receipt) != nil || receipt.Version != "YNX-PQ-OFFHOST-RECOVERY-CREDENTIAL-PROVISION/v1" || receipt.SourceRole != role || receipt.Classification != "data" || receipt.CredentialPath != disk.target || receipt.CiphertextSHA256 != hash(ciphertext) || receipt.EncryptionProfile != "systemd-default-auto" || !receipt.CiphertextInstalled || !receipt.LocalRoundTripVerified || !receipt.HostKeyUnchanged || receipt.IndependentHostVerified || receipt.OffHostRecoveryVerified || receipt.HRSHistoryVerified || receipt.AuthorityGranted || receipt.SigningPerformed || receipt.ServiceChanged || receipt.MachineKeyCreated {
				t.Fatal("off-host DATA receipt misstates authority or source placement", out.String())
			}
			if generated != 1 || processes != 2 || !bytes.Equal(issued, make([]byte, 32)) || !bytes.Equal(roundtrip, make([]byte, 32)) || bytes.Contains(out.Bytes(), copyForCheck) || bytes.Contains(out.Bytes(), []byte("hostKeyIdentity")) || bytes.Contains(out.Bytes(), []byte(f.disk.hostKey)) || bytes.Contains(out.Bytes(), []byte("machineID")) {
				t.Fatal("producer reused generation, retained raw32 or exposed host data")
			}
			for _, name := range []string{recoveryCredentialName, recoveryCredentialIntentName} {
				raw, err := os.ReadFile(filepath.Join(parent, name))
				info, statErr := os.Stat(filepath.Join(parent, name))
				if err != nil || statErr != nil || info.Mode() != 0600 || bytes.Contains(raw, copyForCheck) {
					t.Fatal("raw32 reached a file or original exclusive permissions changed", err, statErr)
				}
			}
			before, _ := os.Stat(disk.target)
			if err := provisionOffhostRecoveryCredential(role, io.Discard, disk); err == nil || generated != 1 || processes != 2 {
				t.Fatal("restart regenerated or replayed a source role")
			}
			after, _ := os.Stat(disk.target)
			if recoveryCredentialIdentity(before) != recoveryCredentialIdentity(after) {
				t.Fatal("existing off-host ciphertext changed")
			}
		})
	}
	if len(seen) != 4 {
		t.Fatal("roles did not independently generate four credentials")
	}
	for path, before := range localBefore {
		info, err := os.Stat(path)
		if err != nil || recoveryCredentialIdentity(info) != before {
			t.Fatal("off-host producer touched original local credential, intent or host inputs", err)
		}
	}
}

func TestOffhostRecoveryCredentialPreconditionsBeforeIntentOrSecret(t *testing.T) {
	for _, mode := range []string{"role", "not-linux", "not-root-operator", "missing-parent", "parent-0755", "writable-parent", "aliased-parent", "missing-host-key", "host-key-mode", "hardlinked-host-key", "existing-target", "existing-intent", "missing-machine", "unsafe-tool"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			role := "primary"
			target := f.disk.target
			intent := filepath.Join(filepath.Dir(target), recoveryCredentialIntentName)
			switch mode {
			case "role":
				role = "source/../primary"
			case "not-linux":
				f.disk.linux = false
			case "not-root-operator":
				f.disk.owner++
			case "missing-parent":
				if err := os.Remove(filepath.Dir(target)); err != nil {
					t.Fatal(err)
				}
			case "parent-0755":
				if err := os.Chmod(filepath.Dir(target), 0755); err != nil {
					t.Fatal(err)
				}
			case "writable-parent":
				if err := os.Chmod(filepath.Dir(target), 0777); err != nil {
					t.Fatal(err)
				}
			case "aliased-parent":
				parent := filepath.Dir(target)
				if err := os.Rename(parent, parent+"-retained"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(parent+"-retained", parent); err != nil {
					t.Fatal(err)
				}
			case "missing-host-key":
				if err := os.Remove(f.disk.hostKey); err != nil {
					t.Fatal(err)
				}
			case "host-key-mode":
				if err := os.Chmod(f.disk.hostKey, 0600); err != nil {
					t.Fatal(err)
				}
			case "hardlinked-host-key":
				if err := os.Link(f.disk.hostKey, f.disk.hostKey+"-link"); err != nil {
					t.Fatal(err)
				}
			case "existing-target":
				if err := os.WriteFile(target, []byte("PUBLIC original retained ciphertext"), 0600); err != nil {
					t.Fatal(err)
				}
			case "existing-intent":
				if err := os.WriteFile(intent, []byte("PUBLIC original retained UNKNOWN"), 0600); err != nil {
					t.Fatal(err)
				}
			case "missing-machine":
				if err := os.Remove(f.disk.machineID); err != nil {
					t.Fatal(err)
				}
			case "unsafe-tool":
				if err := os.Chmod(f.disk.tools[0], 0777); err != nil {
					t.Fatal(err)
				}
			}
			before := map[string]string{}
			for _, path := range []string{target, intent} {
				if info, err := os.Lstat(path); err == nil {
					before[path] = recoveryCredentialIdentity(info)
				}
			}
			var out bytes.Buffer
			if err := provisionOffhostRecoveryCredential(role, &out, f.disk); err == nil || out.Len() != 0 || f.generated != 0 || f.processes != 0 {
				t.Fatal("invalid off-host prerequisites reached intent, raw32 or a process", err)
			}
			for _, path := range []string{target, intent} {
				info, err := os.Lstat(path)
				if prior, ok := before[path]; ok {
					if err != nil || recoveryCredentialIdentity(info) != prior {
						t.Fatal("original retained input changed", err)
					}
				} else if !os.IsNotExist(err) {
					t.Fatal("invalid prerequisites wrote an intent/target", err)
				}
			}
		})
	}
}

func TestOffhostRecoveryCredentialFailuresRetainOriginalWithoutRetry(t *testing.T) {
	for _, mode := range []string{"encrypt", "parent-mode-change", "public-receipt"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			process := f.disk.process
			f.disk.process = func(ctx context.Context, op string, raw []byte, limit int) ([]byte, error) {
				if mode == "encrypt" {
					f.processes++
					return nil, errors.New("PUBLIC private provider stderr must not escape")
				}
				result, err := process(ctx, op, raw, limit)
				if mode == "parent-mode-change" && op == "encrypt" {
					if err := os.Chmod(filepath.Dir(f.disk.target), 0755); err != nil {
						t.Fatal(err)
					}
				}
				return result, err
			}
			var out bytes.Buffer
			var destination io.Writer = &out
			if mode == "public-receipt" {
				destination = credentialRefusedWriter{}
			}
			if err := provisionOffhostRecoveryCredential("primary", destination, f.disk); err == nil || strings.Contains(err.Error(), "provider stderr") {
				t.Fatal("failed producer lost failure or exposed raw process diagnostics", err)
			}
			intent := filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName)
			before, err := os.Stat(intent)
			if err != nil {
				t.Fatal("failed original lost durable UNKNOWN", err)
			}
			if err := os.Chmod(filepath.Dir(f.disk.target), 0700); err != nil {
				t.Fatal(err)
			}
			generated, processes := f.generated, f.processes
			if err := provisionOffhostRecoveryCredential("primary", io.Discard, f.disk); err == nil || generated != f.generated || processes != f.processes {
				t.Fatal("failed original automatically regenerated or retried")
			}
			after, _ := os.Stat(intent)
			if recoveryCredentialIdentity(before) != recoveryCredentialIdentity(after) || !bytes.Equal(f.issued, make([]byte, 32)) {
				t.Fatal("original UNKNOWN or raw32 cleanup changed")
			}
			assertCredentialNotDisclosed(t, f, out.Bytes())
		})
	}
}

func TestOffhostRecoveryCredentialInspectionIsReadOnlyData(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	d := externalTestIO(f)
	var out bytes.Buffer
	for _, state := range []string{"absent", "provisioned"} {
		if state == "provisioned" {
			if err := provisionOffhostRecoveryCredential("seoul", io.Discard, f.disk); err != nil {
				t.Fatal(err)
			}
		}
		generated, processes := f.generated, f.processes
		before := map[string]string{}
		for _, path := range []string{f.disk.target, filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName), f.disk.hostKey, f.disk.machineID} {
			if info, err := os.Stat(path); err == nil {
				before[path] = recoveryCredentialIdentity(info)
			}
		}
		out.Reset()
		if err := inspectOffhostRecoveryCredential("seoul", &out, d); err != nil {
			t.Fatal(err)
		}
		var result offhostCredentialInspection
		if json.Unmarshal(out.Bytes(), &result) != nil || result.Version != "YNX-PQ-OFFHOST-RECOVERY-CREDENTIAL-INSPECTION/v1" || result.Classification != "data" || result.SourceRole != "seoul" || result.CredentialPath != f.disk.target || result.IntentPath != filepath.Join(filepath.Dir(f.disk.target), recoveryCredentialIntentName) || len(result.Files) != 2 || result.CredentialDecrypted || result.IndependentHostVerified || result.OffHostRecoveryVerified || result.AuthorityGranted || result.SigningPerformed || result.ServiceChanged || result.HRSHistoryVerified {
			t.Fatal("inspection misstates DATA or created recovery authority", out.String())
		}
		if generated != f.generated || processes != f.processes || bytes.Contains(out.Bytes(), f.secret) || bytes.Contains(out.Bytes(), []byte("hostKey")) || bytes.Contains(out.Bytes(), []byte("machineID")) {
			t.Fatal("inspection decrypted/generated/exposed private host data")
		}
		for name, file := range result.Files {
			path := filepath.Join(filepath.Dir(f.disk.target), name)
			if state == "absent" {
				if file.Exists {
					t.Fatal("missing original reported as installed")
				}
				if _, err := os.Lstat(path); !os.IsNotExist(err) {
					t.Fatal("inspection created an original", err)
				}
			} else {
				raw, err := os.ReadFile(path)
				info, statErr := os.Stat(path)
				if err != nil || statErr != nil || !file.Exists || file.Identity != recoveryCredentialIdentity(info) || file.SHA256 != hash(raw) || file.Bytes != len(raw) {
					t.Fatal("inspection exact ciphertext tuple differs", err, statErr)
				}
			}
		}
		for path, identity := range before {
			info, err := os.Stat(path)
			if err != nil || recoveryCredentialIdentity(info) != identity {
				t.Fatal("inspection changed original custody", err)
			}
		}
	}
	for _, mode := range []string{"wrong-role", "parent-not-private", "linked-ciphertext", "namespace-change"} {
		t.Run(mode, func(t *testing.T) {
			f := newRecoveryProvisionFixture(t)
			if err := provisionOffhostRecoveryCredential("primary", io.Discard, f.disk); err != nil {
				t.Fatal(err)
			}
			d := externalTestIO(f)
			role := "primary"
			switch mode {
			case "wrong-role":
				role = "../primary"
			case "parent-not-private":
				if err := os.Chmod(filepath.Dir(f.disk.target), 0755); err != nil {
					t.Fatal(err)
				}
			case "linked-ciphertext":
				if err := os.Link(f.disk.target, f.disk.target+"-link"); err != nil {
					t.Fatal(err)
				}
			case "namespace-change":
				count := 0
				d.namespace = func() (string, error) {
					count++
					if count > 2 {
						return "changed-namespace", nil
					}
					return "owned-test-mount-namespace", nil
				}
			}
			var out bytes.Buffer
			if err := inspectOffhostRecoveryCredential(role, &out, d); err == nil || out.Len() != 0 || f.generated != 1 || f.processes != 2 {
				t.Fatal("invalid inspection produced a tuple or touched private producer", err)
			}
		})
	}
}

func TestOffhostRecoveryCredentialOriginalLocalParentPolicyUnchanged(t *testing.T) {
	f := newRecoveryProvisionFixture(t)
	if err := os.Chmod(filepath.Dir(f.disk.target), 0755); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := provisionRecoveryCredential(nil, &out, f.disk); err != nil {
		t.Fatal("original local protected-parent policy changed", err)
	}
	var receipt recoveryCredentialReceipt
	if json.Unmarshal(out.Bytes(), &receipt) != nil || receipt.Version != "YNX-PQ-RECOVERY-CREDENTIAL-PROVISION/v1" || bytes.Contains(out.Bytes(), []byte("sourceRole")) {
		t.Fatal("original local receipt changed")
	}
}
