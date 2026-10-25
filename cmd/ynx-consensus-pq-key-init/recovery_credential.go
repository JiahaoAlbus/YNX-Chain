//go:build unix

package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"golang.org/x/sys/unix"
)

const (
	recoveryCredentialPath       = "/etc/credstore.encrypted/ynx-pq-recovery"
	recoveryCredentialName       = "ynx-pq-recovery"
	recoveryCredentialIntentName = "ynx-pq-recovery.provision-intent.json"
	recoveryCredentialMaximum    = 1 << 20
)

type recoveryCredentialReceipt struct {
	Version                 string `json:"version"`
	Classification          string `json:"classification"`
	CredentialPath          string `json:"credentialPath"`
	CiphertextSHA256        string `json:"ciphertextSHA256"`
	CiphertextBytes         string `json:"ciphertextBytes"`
	OwnerUID                string `json:"ownerUID"`
	Mode                    string `json:"mode"`
	EncryptionProfile       string `json:"encryptionProfile"`
	CiphertextInstalled     bool   `json:"ciphertextInstalled"`
	LocalRoundTripVerified  bool   `json:"localRoundTripVerified"`
	MachineKeyCreated       bool   `json:"machineKeyCreated"`
	HostKeyUnchanged        bool   `json:"hostKeyUnchanged"`
	OffHostRecoveryVerified bool   `json:"offHostRecoveryVerified"`
	HRSHistoryVerified      bool   `json:"hrsHistoryVerified"`
	AuthorityGranted        bool   `json:"authorityGranted"`
	SigningPerformed        bool   `json:"signingPerformed"`
	ServiceChanged          bool   `json:"serviceChanged"`
}

// Only tests replace these private filesystem/process dependencies. Neither
// command-line input nor an environment variable can choose a target or tool.
type recoveryCredentialIO struct {
	target, hostKey, machineID, boundary string
	owner                                uint32
	linux                                bool
	tools                                []string
	generate                             func() ([]byte, error)
	process                              func(context.Context, string, []byte, int) ([]byte, error)
	write                                func(*os.File, string, []byte) (string, error)
}

func runProvisionRecoveryCredential(args []string, output, diagnostics io.Writer) error {
	_ = diagnostics // Raw tool diagnostics, including any input echo, stay private.
	if len(args) == 0 && runtime.GOOS == "linux" && os.Geteuid() == 0 {
		// This changes only this one-shot process and its children. No core file
		// may contain either the new raw credential or the decrypted check value.
		if err := unix.Setrlimit(unix.RLIMIT_CORE, &unix.Rlimit{}); err != nil {
			return errors.New("credential process could not disable private core dumps")
		}
	}
	return provisionRecoveryCredential(args, output, recoveryCredentialIO{
		target: recoveryCredentialPath, hostKey: "/var/lib/systemd/credential.secret",
		machineID: "/etc/machine-id", boundary: "/", owner: 0, linux: runtime.GOOS == "linux",
		tools:    []string{"/usr/bin/unshare", "/usr/bin/mount", "/bin/sh", "/usr/bin/systemd-creds"},
		generate: ynxconsensusauth.GenerateHostRecoveryCredential,
		process:  runRecoveryCredentialProcess, write: writeRecoveryCredentialExclusive,
	})
}

func recoveryCredentialIdentity(info os.FileInfo) string {
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	v := reflect.ValueOf(s).Elem()
	ct := v.FieldByName("Ctim")
	if !ct.IsValid() {
		ct = v.FieldByName("Ctimespec")
	}
	if !ct.IsValid() {
		return ""
	}
	return fmt.Sprintf("%d:%d:%d:%d:%d:%d:%d:%d:%d", s.Dev, s.Ino, info.Mode(), s.Nlink,
		s.Uid, s.Gid, info.Size(), info.ModTime().UnixNano(), ct.FieldByName("Sec").Int()*1000000000+ct.FieldByName("Nsec").Int())
}

func recoveryCredentialDirectory(path, boundary string, owner uint32) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || !filepath.IsAbs(boundary) {
		return errors.New("credential requires fixed canonical existing directories")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return errors.New("credential directory may not traverse aliases")
	}
	for current := path; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return errors.New("credential parent unavailable")
		}
		s, ok := info.Sys().(*syscall.Stat_t)
		if !ok || !info.IsDir() || s.Uid != owner || info.Mode().Perm()&0022 != 0 {
			return errors.New("credential parent must remain protected and owned")
		}
		if current == boundary {
			return nil
		}
		if current == "/" {
			return errors.New("credential directory outside fixed boundary")
		}
	}
}

// Capture metadata only. The host credential key and machine-id are never read
// into this process. systemd's original implementation reads them in its child.
func recoveryCredentialOriginal(path string, owner uint32, mode os.FileMode, maximum int64) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	info, statErr := os.Lstat(path)
	if err != nil || statErr != nil || resolved != path || !info.Mode().IsRegular() {
		return "", errors.New("original system credential input unavailable or aliased")
	}
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok || s.Uid != owner || s.Nlink != 1 || info.Mode().Perm()&0022 != 0 || (mode != 0 && info.Mode().Perm() != mode) || info.Size() < 1 || info.Size() > maximum {
		return "", errors.New("original system credential input is not protected")
	}
	identity := recoveryCredentialIdentity(info)
	if identity == "" {
		return "", errors.New("original metadata identity unavailable")
	}
	return identity, nil
}

func provisionRecoveryCredential(args []string, output io.Writer, disk recoveryCredentialIO) error {
	if len(args) != 0 {
		return errors.New("provision-recovery-credential accepts no options or positional input")
	}
	if !disk.linux || uint32(os.Geteuid()) != disk.owner {
		return errors.New("credential provisioning requires the original Linux root operator")
	}
	if disk.generate == nil || disk.process == nil || disk.write == nil {
		return errors.New("missing original credential producer")
	}
	parent := filepath.Dir(disk.target)
	if err := recoveryCredentialDirectory(parent, disk.boundary, disk.owner); err != nil {
		return err
	}
	fd, err := unix.Open(parent, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return errors.New("credential parent open refused")
	}
	directory := os.NewFile(uintptr(fd), parent)
	defer directory.Close()
	parentInfo, err := directory.Stat()
	if err != nil {
		return errors.New("credential parent identity unavailable")
	}
	absent := func(name string) error {
		var st unix.Stat_t
		err := unix.Fstatat(fd, name, &st, unix.AT_SYMLINK_NOFOLLOW)
		if !errors.Is(err, unix.ENOENT) {
			return errors.New("credential or original UNKNOWN already exists; do not recreate")
		}
		return nil
	}
	if err := absent(filepath.Base(disk.target)); err != nil {
		return err
	}
	if err := absent(recoveryCredentialIntentName); err != nil {
		return err
	}
	if err := recoveryCredentialDirectory(filepath.Dir(disk.hostKey), disk.boundary, disk.owner); err != nil {
		return err
	}
	host, err := recoveryCredentialOriginal(disk.hostKey, disk.owner, 0400, 16<<20)
	if err != nil {
		return errors.New("original OS credential host key must already exist; separately authorize OS setup, never implicit setup")
	}
	machine, err := recoveryCredentialOriginal(disk.machineID, disk.owner, 0, 4096)
	if err != nil {
		return err
	}
	tools := make(map[string]string, len(disk.tools))
	for _, tool := range disk.tools {
		resolved, err := filepath.EvalSymlinks(tool)
		if err != nil {
			return errors.New("fixed credential isolation tool unavailable")
		}
		if err := recoveryCredentialDirectory(filepath.Dir(resolved), disk.boundary, disk.owner); err != nil {
			return err
		}
		identity, err := recoveryCredentialOriginal(resolved, disk.owner, 0, 64<<20)
		info, statErr := os.Stat(resolved)
		if err != nil || statErr != nil || info.Mode().Perm()&0111 == 0 {
			return errors.New("fixed credential isolation tool is not a protected executable")
		}
		tools[tool] = resolved + "\n" + identity
	}
	unchanged := func() error {
		info, err := os.Lstat(parent)
		if err != nil || !os.SameFile(parentInfo, info) || info.Mode() != parentInfo.Mode() {
			return errors.New("credential parent changed")
		}
		if got, err := recoveryCredentialOriginal(disk.hostKey, disk.owner, 0400, 16<<20); err != nil || got != host {
			return errors.New("original OS credential key changed")
		}
		if got, err := recoveryCredentialOriginal(disk.machineID, disk.owner, 0, 4096); err != nil || got != machine {
			return errors.New("original machine identity changed")
		}
		for tool, expected := range tools {
			resolved, err := filepath.EvalSymlinks(tool)
			if err != nil {
				return errors.New("credential tool changed")
			}
			got, err := recoveryCredentialOriginal(resolved, disk.owner, 0, 64<<20)
			if err != nil || resolved+"\n"+got != expected {
				return errors.New("credential tool changed")
			}
		}
		return nil
	}
	if err := unchanged(); err != nil {
		return err
	}
	intent := []byte(`{"version":"YNX-PQ-RECOVERY-CREDENTIAL-INTENT/v1","encryptionProfile":"systemd-default-auto","automaticRetry":false}`)
	intentIdentity, err := disk.write(directory, recoveryCredentialIntentName, intent)
	if err != nil {
		return errors.New("credential intent persistence failed; preserve original UNKNOWN")
	}
	fail := func(stage string) error {
		return fmt.Errorf("credential original attempt retained: %s; do not retry or remove UNKNOWN", stage)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	credential, err := disk.generate()
	defer clear(credential)
	if err != nil || len(credential) != 32 {
		return fail("independent credential generation failed")
	}
	if err := unchanged(); err != nil {
		return fail("original inputs changed before encryption")
	}
	ciphertext, err := disk.process(ctx, "encrypt", credential, recoveryCredentialMaximum)
	defer clear(ciphertext)
	if err != nil || len(ciphertext) == 0 || len(ciphertext) > recoveryCredentialMaximum {
		if safe, ok := err.(*recoveryCredentialProcessFailure); ok {
			return fail("systemd encryption " + safe.code)
		}
		return fail("bounded systemd encryption failed")
	}
	if err := unchanged(); err != nil {
		return fail("original inputs changed after encryption")
	}
	plaintext, err := disk.process(ctx, "decrypt", ciphertext, 32)
	defer clear(plaintext)
	if err != nil || len(plaintext) != 32 || subtle.ConstantTimeCompare(credential, plaintext) != 1 {
		if safe, ok := err.(*recoveryCredentialProcessFailure); ok {
			return fail("systemd decrypt " + safe.code)
		}
		return fail("exact local decrypt verification failed")
	}
	if err := unchanged(); err != nil {
		return fail("original inputs changed after decrypt verification")
	}
	cipherIdentity, err := disk.write(directory, filepath.Base(disk.target), ciphertext)
	if err != nil {
		return fail("exclusive ciphertext persistence failed")
	}
	raw, err := readRegular(disk.target, recoveryCredentialMaximum)
	defer clear(raw)
	if err != nil || !bytes.Equal(raw, ciphertext) {
		return fail("original ciphertext readback failed")
	}
	if got, err := recoveryCredentialOriginal(disk.target, disk.owner, 0600, recoveryCredentialMaximum); err != nil || got != cipherIdentity {
		return fail("original ciphertext metadata differs")
	}
	if got, err := recoveryCredentialOriginal(filepath.Join(parent, recoveryCredentialIntentName), disk.owner, 0600, 4096); err != nil || got != intentIdentity {
		return fail("original credential intent changed")
	}
	if err := unchanged(); err != nil {
		return fail("original inputs changed after ciphertext persistence")
	}
	report := recoveryCredentialReceipt{Version: "YNX-PQ-RECOVERY-CREDENTIAL-PROVISION/v1", Classification: "data",
		CredentialPath: disk.target, CiphertextSHA256: hash(ciphertext), CiphertextBytes: strconv.Itoa(len(ciphertext)), OwnerUID: strconv.FormatUint(uint64(disk.owner), 10), Mode: "600", EncryptionProfile: "systemd-default-auto",
		CiphertextInstalled: true, LocalRoundTripVerified: true, HostKeyUnchanged: true}
	if err := json.NewEncoder(output).Encode(report); err != nil {
		return fail("public receipt delivery failed")
	}
	return nil
}

func writeRecoveryCredentialExclusive(directory *os.File, name string, raw []byte) (string, error) {
	fd, err := unix.Openat(int(directory.Fd()), name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return "", err
	}
	f := os.NewFile(uintptr(fd), name)
	n, err := f.Write(raw)
	if err == nil && n != len(raw) {
		err = io.ErrShortWrite
	}
	err = errors.Join(err, f.Sync())
	info, statErr := f.Stat()
	err = errors.Join(err, statErr, f.Close(), directory.Sync())
	if err != nil {
		return "", err
	}
	return recoveryCredentialIdentity(info), nil
}

func recoveryCredentialCommand(operation string) ([]string, error) {
	if operation != "encrypt" && operation != "decrypt" {
		return nil, errors.New("unsupported credential operation")
	}
	// systemd's default auto profile can implicitly create OR replace a host
	// key (including a stale machine-id binding). Protect the original directory
	// in this child's private mount namespace, rather than lowering auto or
	// allowing hidden host setup. No host mount or service is changed.
	script := `set -eu; ulimit -c 0; /usr/bin/mount --bind /var/lib/systemd /var/lib/systemd; /usr/bin/mount -o remount,bind,ro /var/lib/systemd; exec /usr/bin/systemd-creds "$@"`
	args := []string{"/usr/bin/unshare", "--mount", "--propagation", "private", "--", "/bin/sh", "-c", script, "ynx-pq-credential", "--no-ask-password", "--name=ynx-pq-recovery"}
	if operation == "decrypt" {
		args = append(args, "--newline=no")
	}
	return append(args, operation, "-", "-"), nil
}

type recoveryCredentialCapture struct {
	data     []byte
	limit    int
	cancel   context.CancelFunc
	exceeded bool
}

func (w *recoveryCredentialCapture) Write(raw []byte) (int, error) {
	if len(raw) > w.limit-len(w.data) {
		w.exceeded = true
		w.cancel()
		return 0, errors.New("bounded private credential process output exceeded")
	}
	w.data = append(w.data, raw...)
	return len(raw), nil
}

func runRecoveryCredentialProcess(parent context.Context, operation string, input []byte, maximum int) ([]byte, error) {
	args, err := recoveryCredentialCommand(operation)
	if err != nil {
		return nil, err
	}
	return executeRecoveryCredentialProcess(parent, args, input, maximum)
}

type recoveryCredentialProcessFailure struct{ code string }

func (e *recoveryCredentialProcessFailure) Error() string {
	return "bounded credential process: " + e.code
}

func executeRecoveryCredentialProcess(parent context.Context, args []string, input []byte, maximum int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	stdout := &recoveryCredentialCapture{limit: maximum, cancel: cancel}
	stderr := &recoveryCredentialCapture{limit: 4096, cancel: cancel}
	defer func() { clear(stderr.data) }()
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	// The only secret transport is this anonymous pipe, written from the owned
	// input slice without an os/exec Reader copy buffer. No plaintext file exists.
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, &recoveryCredentialProcessFailure{code: "stdin_pipe_unavailable"}
	}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "TZ=UTC", "SYSTEMD_LOG_TARGET=console", "SYSTEMD_LOG_LEVEL=err"}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = time.Second
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		clear(stdout.data)
		return nil, &recoveryCredentialProcessFailure{code: "start_refused"}
	}
	inputDone := make(chan error, 1)
	go func() {
		var writeErr error
		for remaining := input; len(remaining) > 0; {
			var n int
			n, writeErr = stdin.Write(remaining)
			if writeErr != nil {
				break
			}
			if n == 0 {
				writeErr = io.ErrShortWrite
				break
			}
			remaining = remaining[n:]
		}
		inputDone <- errors.Join(writeErr, stdin.Close())
	}()
	err = cmd.Wait() // Joins the actual process and its bounded output workers.
	group := -cmd.Process.Pid
	remaining := syscall.Kill(group, 0)
	if remaining == nil {
		_ = syscall.Kill(group, syscall.SIGKILL)
		deadline := time.Now().Add(time.Second)
		for remaining == nil && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
			remaining = syscall.Kill(group, 0)
		}
		err = errors.New("unexpected owned credential descendant; original attempt retained")
	}
	_ = stdin.Close() // Also releases a blocked owned writer on an early child exit.
	inputErr := <-inputDone
	if err != nil || inputErr != nil || ctx.Err() != nil || !errors.Is(remaining, syscall.ESRCH) {
		clear(stdout.data)
		code := "owned_cleanup_unconfirmed"
		switch {
		case stdout.exceeded || stderr.exceeded:
			code = "private_output_limit"
		case ctx.Err() != nil:
			code = "deadline_or_cancelled"
		case cmd.ProcessState != nil && cmd.ProcessState.ExitCode() != 0:
			code = "exit_" + strconv.Itoa(cmd.ProcessState.ExitCode())
		case inputErr != nil:
			code = "stdin_incomplete"
		}
		return nil, &recoveryCredentialProcessFailure{code: code}
	}
	return stdout.data, nil
}
