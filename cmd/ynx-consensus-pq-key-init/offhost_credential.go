//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/sys/unix"
)

// A source role selects DATA custody, not the identity or authority of the
// machine running this command. Independent host placement is checked by the
// operator outside this command. These are the only supported output targets.
func offhostRecoveryCredentialTarget(role string) (string, error) {
	switch role {
	case "primary":
		return "/etc/credstore.encrypted/ynx-pq-offhost/primary/ynx-pq-recovery", nil
	case "singapore":
		return "/etc/credstore.encrypted/ynx-pq-offhost/singapore/ynx-pq-recovery", nil
	case "silicon-valley":
		return "/etc/credstore.encrypted/ynx-pq-offhost/silicon-valley/ynx-pq-recovery", nil
	case "seoul":
		return "/etc/credstore.encrypted/ynx-pq-offhost/seoul/ynx-pq-recovery", nil
	default:
		return "", errors.New("one fixed off-host source role required")
	}
}

func parseOffhostRecoveryCredentialRole(args []string) (string, error) {
	if len(args) != 2 || args[0] != "--source-role" {
		return "", errors.New("off-host credential accepts only --source-role and one fixed role")
	}
	if _, err := offhostRecoveryCredentialTarget(args[1]); err != nil {
		return "", err
	}
	return args[1], nil
}

func realOffhostRecoveryCredentialIO(role string) (recoveryCredentialIO, error) {
	target, err := offhostRecoveryCredentialTarget(role)
	if err != nil {
		return recoveryCredentialIO{}, err
	}
	disk := realRecoveryCredentialIO()
	disk.target = target
	disk.requiredParentMode = 0700
	return disk, nil
}

type offhostCredentialReceipt struct {
	recoveryCredentialReceipt
	SourceRole              string `json:"sourceRole"`
	IndependentHostVerified bool   `json:"independentHostVerified"`
}

func runProvisionOffhostRecoveryCredential(args []string, output, _ io.Writer) error {
	role, err := parseOffhostRecoveryCredentialRole(args)
	if err != nil {
		return err
	}
	disk, err := realOffhostRecoveryCredentialIO(role)
	if err != nil {
		return err
	}
	if runtime.GOOS == "linux" && os.Geteuid() == 0 {
		if err := unix.Setrlimit(unix.RLIMIT_CORE, &unix.Rlimit{}); err != nil {
			return errors.New("off-host credential process cannot disable private core dumps")
		}
	}
	return provisionOffhostRecoveryCredential(role, output, disk)
}

// Only private tests inject filesystem/process dependencies. Production selects
// the role statically above and otherwise uses the original producer unchanged:
// new raw32 in owned memory, default-auto encryption, exact roundtrip, original
// exclusive intent/ciphertext writer and fsync, then clear all owned raw bytes.
func provisionOffhostRecoveryCredential(role string, output io.Writer, disk recoveryCredentialIO) error {
	if _, err := offhostRecoveryCredentialTarget(role); err != nil {
		return err
	}
	disk.requiredParentMode = 0700
	var original bytes.Buffer // Contains only the original public DATA receipt.
	if err := provisionRecoveryCredential(nil, &original, disk); err != nil {
		return err
	}
	var receipt recoveryCredentialReceipt
	if json.Unmarshal(original.Bytes(), &receipt) != nil {
		return errors.New("off-host credential original result retained; inspect fixed role without retry")
	}
	receipt.Version = "YNX-PQ-OFFHOST-RECOVERY-CREDENTIAL-PROVISION/v1"
	if err := json.NewEncoder(output).Encode(offhostCredentialReceipt{recoveryCredentialReceipt: receipt, SourceRole: role}); err != nil {
		return errors.New("off-host credential original result retained: public receipt delivery failed; inspect fixed role without retry")
	}
	return nil
}

type offhostCredentialFile struct {
	Exists   bool   `json:"exists"`
	Identity string `json:"identity,omitempty"`
	Bytes    int    `json:"bytes,omitempty"`
	SHA256   string `json:"sha256,omitempty"`
}

type offhostCredentialInspection struct {
	Version                 string                           `json:"version"`
	Classification          string                           `json:"classification"`
	SourceRole              string                           `json:"sourceRole"`
	CredentialPath          string                           `json:"credentialPath"`
	IntentPath              string                           `json:"intentPath"`
	Files                   map[string]offhostCredentialFile `json:"files"`
	CredentialDecrypted     bool                             `json:"credentialDecrypted"`
	IndependentHostVerified bool                             `json:"independentHostVerified"`
	OffHostRecoveryVerified bool                             `json:"offHostRecoveryVerified"`
	HRSHistoryVerified      bool                             `json:"hrsHistoryVerified"`
	AuthorityGranted        bool                             `json:"authorityGranted"`
	SigningPerformed        bool                             `json:"signingPerformed"`
	ServiceChanged          bool                             `json:"serviceChanged"`
}

func runInspectOffhostRecoveryCredential(args []string, output, _ io.Writer) error {
	role, err := parseOffhostRecoveryCredentialRole(args)
	if err != nil {
		return err
	}
	disk, err := realOffhostRecoveryCredentialIO(role)
	if err != nil {
		return err
	}
	d := realExternalCredentialIO()
	d.disk = disk
	return inspectOffhostRecoveryCredential(role, output, d)
}

// Inspect retains the original FD/path identities through the full readback. It
// reads only bounded ciphertext and the public intent, never decrypts, generates,
// repairs, removes UNKNOWN or outputs host-key/machine-id metadata or contents.
func inspectOffhostRecoveryCredential(role string, output io.Writer, d externalCredentialIO) error {
	if _, err := offhostRecoveryCredentialTarget(role); err != nil {
		return err
	}
	d.disk.requiredParentMode = 0700
	g, err := captureExternalCredentialGuard(d)
	if err != nil {
		return err
	}
	defer g.directory.Close()
	if err := recoveryCredentialRequiredParent(g.parentInfo, d.disk); err != nil {
		return err
	}
	var held []*capsuleHeldFile
	defer capsuleClose(held)
	files := map[string]offhostCredentialFile{}
	for _, name := range []string{filepath.Base(d.disk.target), recoveryCredentialIntentName} {
		path := filepath.Join(filepath.Dir(d.disk.target), name)
		if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
			files[name] = offhostCredentialFile{}
			continue
		}
		h, err := capsuleOpen(path, recoveryCredentialMaximum, false, true, false)
		if err != nil {
			return errors.New("original off-host ciphertext or intent is not protected; preserve and reconcile")
		}
		held = append(held, h)
		info, err := h.file.Stat()
		if err != nil {
			return errors.New("original off-host ciphertext metadata unavailable")
		}
		files[name] = offhostCredentialFile{Exists: true, Identity: recoveryCredentialIdentity(info), Bytes: len(h.raw), SHA256: hash(h.raw)}
	}
	for name, file := range files {
		if !file.Exists && g.absent(name) != nil {
			return errors.New("original off-host absence changed during inspection")
		}
	}
	if err := capsuleUnchanged(held); err != nil {
		return err
	}
	if err := g.unchanged(); err != nil {
		return err
	}
	if err := recoveryCredentialRequiredParent(g.parentInfo, d.disk); err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(offhostCredentialInspection{Version: "YNX-PQ-OFFHOST-RECOVERY-CREDENTIAL-INSPECTION/v1", Classification: "data", SourceRole: role, CredentialPath: d.disk.target, IntentPath: filepath.Join(filepath.Dir(d.disk.target), recoveryCredentialIntentName), Files: files})
}
