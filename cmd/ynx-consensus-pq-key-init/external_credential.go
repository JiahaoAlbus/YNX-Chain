//go:build unix

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

const (
	externalCredentialContinuation = "ynx-pq-recovery.install-continuation-intent.json"
	legacyCredentialIntent         = `{"version":"YNX-PQ-RECOVERY-CREDENTIAL-INTENT/v1","encryptionProfile":"systemd-default-auto","automaticRetry":false}`
	legacyCredentialProducerSHA    = "07a142b2642066f0f0865d7cfd4c52be245cef3393a94cdd8485215b1234c1d5"
)

type externalCredentialOptions struct {
	fd                         int
	continuation               bool
	failurePath, failureSHA256 string
	intentSHA256               string
}

// This independently pinned, protected operator DATA records one narrowly
// identified pre-encryption failure. It is not account, Root, validator or
// consensus authority. The source identities prevent cross-host substitution.
type externalCredentialPriorFailure struct {
	Version                      string `json:"version"`
	Classification               string `json:"classification"`
	CredentialPath               string `json:"credentialPath"`
	IntentPath                   string `json:"intentPath"`
	IntentSHA256                 string `json:"intentSHA256"`
	IntentIdentity               string `json:"intentIdentity"`
	HostKeyIdentity              string `json:"hostKeyIdentity"`
	MachineIDIdentity            string `json:"machineIDIdentity"`
	ProducerSHA256               string `json:"producerSHA256"`
	ProducerCommand              string `json:"producerCommand"`
	FailureStage                 string `json:"failureStage"`
	ProcessFailureCode           string `json:"processFailureCode"`
	RejectedOption               string `json:"rejectedOption"`
	OptionParsingRejected        bool   `json:"optionParsingRejected"`
	PrivateReadOnlyMountVerified bool   `json:"privateReadOnlyMountVerified"`
	CiphertextEverInstalled      bool   `json:"ciphertextEverInstalled"`
	PQEpochExecuted              bool   `json:"pqEpochExecuted"`
	AuthorityGranted             bool   `json:"authorityGranted"`
	SigningPerformed             bool   `json:"signingPerformed"`
	ServiceChanged               bool   `json:"serviceChanged"`
}

type externalCredentialIO struct {
	disk      recoveryCredentialIO
	namespace func() (string, error)
}

func realExternalCredentialIO() externalCredentialIO {
	return externalCredentialIO{disk: realRecoveryCredentialIO(), namespace: func() (string, error) {
		return os.Readlink("/proc/self/ns/mnt")
	}}
}

func parseExternalCredentialOptions(args []string) (externalCredentialOptions, error) {
	o := externalCredentialOptions{fd: -1}
	seen := map[string]bool{}
	for i := 0; i < len(args); i++ {
		name := strings.TrimLeft(strings.SplitN(args[i], "=", 2)[0], "-")
		if seen[name] {
			return o, errors.New("duplicate external credential option")
		}
		seen[name] = true
		if name != "continue-prior-failure" && !strings.Contains(args[i], "=") {
			i++
		}
	}
	f := flag.NewFlagSet("install-recovery-credential", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	f.IntVar(&o.fd, "recovery-fd", -1, "owned inherited anonymous pipe or Unix stream FD >=3, exactly raw32 and EOF")
	f.BoolVar(&o.continuation, "continue-prior-failure", false, "explicit pinned legacy pre-encryption failure only")
	f.StringVar(&o.failurePath, "prior-failure", "", "protected canonical public failure DATA")
	f.StringVar(&o.failureSHA256, "prior-failure-sha256", "", "independent complete public failure SHA256")
	f.StringVar(&o.intentSHA256, "prior-intent-sha256", "", "independent complete original intent SHA256")
	if f.Parse(args) != nil || f.NArg() != 0 || o.fd < 3 {
		return o, errors.New("invalid external credential options; only inherited raw32 FD input is accepted")
	}
	if o.continuation {
		if !filepath.IsAbs(o.failurePath) || filepath.Clean(o.failurePath) != o.failurePath || !externalCredentialPin(o.failureSHA256) || !externalCredentialPin(o.intentSHA256) {
			return o, errors.New("continuation requires independent failure and original intent pins")
		}
	} else if o.failurePath != "" || o.failureSHA256 != "" || o.intentSHA256 != "" {
		return o, errors.New("prior failure inputs require explicit continuation")
	}
	return o, nil
}

func externalCredentialPin(pin string) bool {
	b, err := hex.DecodeString(pin)
	return err == nil && len(b) == sha256.Size && hex.EncodeToString(b) == pin && pin != strings.Repeat("0", 64)
}

func runInstallRecoveryCredential(args []string, output, _ io.Writer) error {
	o, err := parseExternalCredentialOptions(args)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(o.fd), "independently-held-recovery-credential")
	if f == nil {
		return errors.New("inherited external credential pipe unavailable")
	}
	defer f.Close()
	if runtime.GOOS == "linux" && os.Geteuid() == 0 {
		if err := unix.Setrlimit(unix.RLIMIT_CORE, &unix.Rlimit{}); err != nil {
			return errors.New("external credential process cannot disable private core dumps")
		}
	}
	return installExternalRecoveryCredential(o, f, output, realExternalCredentialIO())
}

// The pipe is owned by this invocation. Do not accept regular plaintext files,
// terminals, argv or environment input. Nonblocking polling bounds a missing
// EOF without leaving a goroutine holding private bytes after cancellation.
func readExternalCredential(ctx context.Context, input *os.File) ([]byte, error) {
	if input == nil || input.Fd() < 3 {
		return nil, errors.New("owned inherited credential descriptor >=3 required")
	}
	info, err := input.Stat()
	if err != nil {
		return nil, errors.New("inherited private credential descriptor unavailable")
	}
	fd := int(input.Fd())
	switch {
	case info.Mode()&os.ModeNamedPipe != 0:
		// Do not reinterpret a named filesystem FIFO as a path-based
		// plaintext interface, including when shared by offline Unix tools.
		if runtime.GOOS == "linux" {
			name, err := os.Readlink("/proc/self/fd/" + strconv.Itoa(fd))
			if err != nil || !strings.HasPrefix(name, "pipe:[") || !strings.HasSuffix(name, "]") {
				return nil, errors.New("external credential requires an anonymous inherited pipe")
			}
		} else {
			var st unix.Stat_t
			if unix.Fstat(fd, &st) != nil || st.Nlink != 0 {
				return nil, errors.New("external credential requires an anonymous inherited pipe")
			}
		}
	case info.Mode()&os.ModeSocket != 0:
		address, err := unix.Getsockname(fd)
		_, local := address.(*unix.SockaddrUnix)
		kind, kindErr := unix.GetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_TYPE)
		if err != nil || !local || kindErr != nil || kind != unix.SOCK_STREAM {
			return nil, errors.New("external credential requires a private inherited Unix stream socket")
		}
	default:
		return nil, errors.New("external credential rejects regular files and terminals")
	}
	unix.CloseOnExec(fd)
	flags, err := unix.FcntlInt(uintptr(fd), unix.F_GETFL, 0)
	if err != nil || unix.SetNonblock(fd, true) != nil {
		return nil, errors.New("external credential pipe cannot be bounded")
	}
	defer unix.FcntlInt(uintptr(fd), unix.F_SETFL, flags)
	var raw [33]byte
	defer clear(raw[:])
	n := 0
	for {
		if ctx.Err() != nil {
			return nil, errors.New("external credential pipe deadline or cancellation")
		}
		milliseconds := 100
		if deadline, ok := ctx.Deadline(); ok {
			left := time.Until(deadline)
			if left <= 0 {
				return nil, errors.New("external credential pipe deadline or cancellation")
			}
			if left < 100*time.Millisecond {
				milliseconds = int(left/time.Millisecond) + 1
			}
		}
		_, err := unix.Poll([]unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN | unix.POLLHUP}}, milliseconds)
		if err == unix.EINTR {
			continue
		}
		if err != nil {
			return nil, errors.New("external credential pipe observation failed")
		}
		got, err := unix.Read(fd, raw[n:])
		if err == unix.EAGAIN || err == unix.EINTR {
			continue
		}
		if err != nil {
			return nil, errors.New("external credential pipe read failed")
		}
		n += got
		if n == len(raw) {
			return nil, errors.New("external credential requires exactly raw32 and EOF")
		}
		if got == 0 {
			if n != 32 {
				return nil, errors.New("external credential requires exactly raw32 and EOF")
			}
			return bytes.Clone(raw[:n]), nil
		}
	}
}

type heldExternalCredentialData struct {
	file     *os.File
	path     string
	identity string
	sha256   string
	raw      []byte
}

func holdExternalCredentialData(path, pin string, maximum int64, disk recoveryCredentialIO) (*heldExternalCredentialData, error) {
	if !externalCredentialPin(pin) || recoveryCredentialDirectory(filepath.Dir(path), disk.boundary, disk.owner) != nil {
		return nil, errors.New("protected canonical independently pinned public DATA required")
	}
	identity, err := recoveryCredentialOriginal(path, disk.owner, 0600, maximum)
	if err != nil {
		return nil, err
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("public DATA read-only descriptor unavailable")
	}
	h := &heldExternalCredentialData{file: os.NewFile(uintptr(fd), path), path: path, identity: identity, sha256: pin}
	if h.raw, err = io.ReadAll(io.LimitReader(h.file, maximum+1)); err != nil || int64(len(h.raw)) > maximum || hash(h.raw) != pin || h.unchanged(disk) != nil {
		h.file.Close()
		return nil, errors.New("pinned public DATA bytes or held identity differ")
	}
	return h, nil
}

func (h *heldExternalCredentialData) unchanged(disk recoveryCredentialIO) error {
	info, err := h.file.Stat()
	if err != nil || recoveryCredentialIdentity(info) != h.identity {
		return errors.New("held public DATA descriptor changed")
	}
	if got, err := recoveryCredentialOriginal(h.path, disk.owner, 0600, 8192); err != nil || got != h.identity {
		return errors.New("original public DATA path or nanosecond identity changed")
	}
	if _, err := h.file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(h.file, 8193))
	if err != nil || len(raw) > 8192 || hash(raw) != h.sha256 {
		return errors.New("held public DATA digest changed")
	}
	return nil
}

type externalCredentialGuard struct {
	disk              recoveryCredentialIO
	directory         *os.File
	parentInfo        os.FileInfo
	host, machine, ns string
	tools             map[string]string
	namespace         func() (string, error)
}

func captureExternalCredentialGuard(d externalCredentialIO) (*externalCredentialGuard, error) {
	disk := d.disk
	if !disk.linux || uint32(os.Geteuid()) != disk.owner || disk.write == nil || disk.process == nil || d.namespace == nil {
		return nil, errors.New("external credential installation requires the original Linux root operator")
	}
	parent := filepath.Dir(disk.target)
	if err := recoveryCredentialDirectory(parent, disk.boundary, disk.owner); err != nil {
		return nil, err
	}
	fd, err := unix.Open(parent, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("original credential parent unavailable")
	}
	g := &externalCredentialGuard{disk: disk, directory: os.NewFile(uintptr(fd), parent), namespace: d.namespace, tools: map[string]string{}}
	ok := false
	defer func() {
		if !ok {
			g.directory.Close()
		}
	}()
	if g.parentInfo, err = g.directory.Stat(); err != nil {
		return nil, err
	}
	if g.host, err = recoveryCredentialOriginal(disk.hostKey, disk.owner, 0400, 16<<20); err != nil {
		return nil, errors.New("original OS host key must already exist; no implicit setup")
	}
	if g.machine, err = recoveryCredentialOriginal(disk.machineID, disk.owner, 0, 4096); err != nil {
		return nil, err
	}
	if g.ns, err = d.namespace(); err != nil || g.ns == "" {
		return nil, errors.New("original mount namespace unavailable")
	}
	for _, tool := range disk.tools {
		resolved, err := filepath.EvalSymlinks(tool)
		if err != nil || recoveryCredentialDirectory(filepath.Dir(resolved), disk.boundary, disk.owner) != nil {
			return nil, errors.New("fixed private credential process tool unavailable")
		}
		identity, err := recoveryCredentialOriginal(resolved, disk.owner, 0, 64<<20)
		info, statErr := os.Stat(resolved)
		if err != nil || statErr != nil || info.Mode().Perm()&0111 == 0 {
			return nil, errors.New("fixed private credential tool is not protected executable")
		}
		g.tools[tool] = resolved + "\n" + identity
	}
	if err := g.unchanged(); err != nil {
		return nil, err
	}
	ok = true
	return g, nil
}

func (g *externalCredentialGuard) absent(name string) error {
	var info unix.Stat_t
	if err := unix.Fstatat(int(g.directory.Fd()), name, &info, unix.AT_SYMLINK_NOFOLLOW); !errors.Is(err, unix.ENOENT) {
		return errors.New("original target or intent/UNKNOWN exists; inspect without overwrite or retry")
	}
	return nil
}

func (g *externalCredentialGuard) unchanged() error {
	d := g.disk
	info, err := os.Lstat(filepath.Dir(d.target))
	if err != nil || !os.SameFile(info, g.parentInfo) || info.Mode() != g.parentInfo.Mode() || recoveryCredentialDirectory(filepath.Dir(d.target), d.boundary, d.owner) != nil {
		return errors.New("original credential parent changed")
	}
	if identity, err := recoveryCredentialOriginal(d.hostKey, d.owner, 0400, 16<<20); err != nil || identity != g.host {
		return errors.New("original OS host key changed")
	}
	if identity, err := recoveryCredentialOriginal(d.machineID, d.owner, 0, 4096); err != nil || identity != g.machine {
		return errors.New("original machine identity changed")
	}
	if ns, err := g.namespace(); err != nil || ns != g.ns {
		return errors.New("original mount namespace changed")
	}
	for tool, expected := range g.tools {
		resolved, err := filepath.EvalSymlinks(tool)
		if err != nil {
			return errors.New("fixed credential tool changed")
		}
		identity, err := recoveryCredentialOriginal(resolved, d.owner, 0, 64<<20)
		if err != nil || resolved+"\n"+identity != expected {
			return errors.New("fixed credential tool changed")
		}
	}
	return nil
}

type externalCredentialIntent struct {
	Version              string `json:"version"`
	Classification       string `json:"classification"`
	CredentialPath       string `json:"credentialPath"`
	InputSource          string `json:"inputSource"`
	Continuation         bool   `json:"continuation"`
	AutomaticRetry       bool   `json:"automaticRetry"`
	ParentIntentSHA256   string `json:"parentIntentSHA256"`
	PriorFailureSHA256   string `json:"priorFailureSHA256"`
	ParentIntentIdentity string `json:"parentIntentIdentity"`
	PriorFailureIdentity string `json:"priorFailureIdentity"`
	HostKeyIdentity      string `json:"hostKeyIdentity"`
	MachineIDIdentity    string `json:"machineIDIdentity"`
	MountNamespace       string `json:"mountNamespace"`
}

type externalCredentialReceipt struct {
	recoveryCredentialReceipt
	ExternalCredentialConsumed bool   `json:"externalCredentialConsumed"`
	Continuation               bool   `json:"continuation"`
	IntentPath                 string `json:"intentPath"`
	IntentSHA256               string `json:"intentSHA256"`
	PriorIntentSHA256          string `json:"priorIntentSHA256"`
	PriorFailureSHA256         string `json:"priorFailureSHA256"`
}

type externalCredentialStage string

const (
	externalIntentPersist  externalCredentialStage = "intent_persistence"
	externalBeforeEncrypt  externalCredentialStage = "original_inputs_before_encryption"
	externalEncrypt        externalCredentialStage = "encrypt"
	externalAfterEncrypt   externalCredentialStage = "original_inputs_after_encryption"
	externalDecrypt        externalCredentialStage = "decrypt"
	externalAfterDecrypt   externalCredentialStage = "original_inputs_after_decryption"
	externalPersist        externalCredentialStage = "ciphertext_persistence"
	externalReadback       externalCredentialStage = "ciphertext_readback"
	externalCipherMetadata externalCredentialStage = "ciphertext_metadata"
	externalIntentMetadata externalCredentialStage = "intent_metadata"
	externalAfterPersist   externalCredentialStage = "original_inputs_after_persistence"
	externalPublicReceipt  externalCredentialStage = "public_receipt_delivery"
)

// Preserve the first stage without publishing process stderr, private input,
// paths or arbitrary error text. Only the original adapter's safe code grammar
// crosses this DATA diagnostic boundary; cleanup never replaces this error.
func retainedExternalCredential(stage externalCredentialStage, cause error) error {
	switch stage {
	case externalIntentPersist, externalBeforeEncrypt, externalEncrypt, externalAfterEncrypt, externalDecrypt, externalAfterDecrypt, externalPersist, externalReadback, externalCipherMetadata, externalIntentMetadata, externalAfterPersist, externalPublicReceipt:
	default:
		stage = "unclassified_stage"
	}
	code := ""
	var process *recoveryCredentialProcessFailure
	if errors.As(cause, &process) && process != nil {
		switch process.code {
		case "stdin_pipe_unavailable", "start_refused", "owned_cleanup_unconfirmed", "private_output_limit", "deadline_or_cancelled", "stdin_incomplete":
			code = process.code
		default:
			if strings.HasPrefix(process.code, "exit_") {
				n, err := strconv.Atoi(strings.TrimPrefix(process.code, "exit_"))
				if err == nil && n >= -1 && n <= 255 && process.code == "exit_"+strconv.Itoa(n) {
					code = process.code
				}
			}
			if code == "" {
				code = "unclassified_process_failure"
			}
		}
	}
	if code != "" {
		return fmt.Errorf("external credential original attempt retained: %s %s; inspect without retry or replacing any intent", stage, code)
	}
	return fmt.Errorf("external credential original attempt retained: %s; inspect without retry or replacing any intent", stage)
}

func installExternalRecoveryCredential(o externalCredentialOptions, input *os.File, output io.Writer, d externalCredentialIO) error {
	if input == nil {
		return errors.New("owned inherited credential pipe unavailable")
	}
	defer input.Close()
	g, err := captureExternalCredentialGuard(d)
	if err != nil {
		return err
	}
	defer g.directory.Close()
	for _, name := range []string{filepath.Base(d.disk.target), externalCredentialContinuation} {
		if err := g.absent(name); err != nil {
			return err
		}
	}
	intent := externalCredentialIntent{Version: "YNX-PQ-EXTERNAL-RECOVERY-CREDENTIAL-INTENT/v1", Classification: "data", CredentialPath: d.disk.target, InputSource: "owned-inherited-fd-raw32-eof", Continuation: o.continuation, HostKeyIdentity: g.host, MachineIDIdentity: g.machine, MountNamespace: g.ns}
	var held []*heldExternalCredentialData
	defer func() {
		for _, h := range held {
			h.file.Close()
		}
	}()
	check := func() error {
		if err := g.unchanged(); err != nil {
			return err
		}
		for _, h := range held {
			if err := h.unchanged(d.disk); err != nil {
				return err
			}
		}
		return nil
	}
	intentName := recoveryCredentialIntentName
	if o.continuation {
		oldPath := filepath.Join(filepath.Dir(d.disk.target), recoveryCredentialIntentName)
		old, err := holdExternalCredentialData(oldPath, o.intentSHA256, 4096, d.disk)
		if err != nil {
			return err
		}
		held = append(held, old)
		if !bytes.Equal(old.raw, []byte(legacyCredentialIntent)) {
			return errors.New("only the exact legacy pre-encryption provision intent can continue")
		}
		failure, err := holdExternalCredentialData(o.failurePath, o.failureSHA256, 8192, d.disk)
		if err != nil {
			return err
		}
		held = append(held, failure)
		var record externalCredentialPriorFailure
		decoder := json.NewDecoder(bytes.NewReader(failure.raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&record) != nil || decoder.Decode(new(any)) != io.EOF {
			return errors.New("canonical independently pinned prior failure DATA required")
		}
		canonical, err := json.Marshal(record)
		if err != nil || !bytes.Equal(bytes.TrimSuffix(failure.raw, []byte("\n")), canonical) {
			return errors.New("prior failure DATA has duplicate, missing or noncanonical fields")
		}
		if record.Version != "YNX-PQ-RECOVERY-CREDENTIAL-PRE-ENCRYPTION-FAILURE/v1" || record.Classification != "data" || record.CredentialPath != d.disk.target || record.IntentPath != oldPath || record.IntentSHA256 != o.intentSHA256 || record.IntentIdentity != old.identity || record.HostKeyIdentity != g.host || record.MachineIDIdentity != g.machine || record.ProducerSHA256 != legacyCredentialProducerSHA || record.ProducerCommand != "provision-recovery-credential" || record.FailureStage != "pre-encryption-option-parse" || record.ProcessFailureCode != "exit_1" || record.RejectedOption != "--no-ask-password" || !record.OptionParsingRejected || !record.PrivateReadOnlyMountVerified || record.CiphertextEverInstalled || record.PQEpochExecuted || record.AuthorityGranted || record.SigningPerformed || record.ServiceChanged {
			return errors.New("prior DATA is not the independently recorded legacy unsupported-option failure")
		}
		intentName = externalCredentialContinuation
		intent.ParentIntentSHA256, intent.PriorFailureSHA256 = o.intentSHA256, o.failureSHA256
		intent.ParentIntentIdentity, intent.PriorFailureIdentity = old.identity, failure.identity
	} else {
		if o.failurePath != "" || o.failureSHA256 != "" || o.intentSHA256 != "" {
			return errors.New("prior inputs require explicit continuation")
		}
		if err := g.absent(recoveryCredentialIntentName); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	readCtx, readCancel := context.WithTimeout(ctx, 8*time.Second)
	credential, err := readExternalCredential(readCtx, input)
	readCancel()
	defer clear(credential)
	closeErr := input.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return errors.New("external credential pipe close failed")
	}
	if ctx.Err() != nil {
		return errors.New("external credential input deadline expired before persistent intent")
	}
	if err := check(); err != nil {
		return err
	}
	if err := g.absent(filepath.Base(d.disk.target)); err != nil {
		return err
	}
	if err := g.absent(intentName); err != nil {
		return err
	}
	rawIntent, err := json.Marshal(intent)
	if err != nil {
		return err
	}
	intentIdentity, err := d.disk.write(g.directory, intentName, rawIntent)
	if err != nil {
		return retainedExternalCredential(externalIntentPersist, nil)
	}
	if err := check(); err != nil {
		return retainedExternalCredential(externalBeforeEncrypt, nil)
	}
	ciphertext, err := d.disk.process(ctx, "encrypt", credential, recoveryCredentialMaximum)
	defer clear(ciphertext)
	if err != nil || len(ciphertext) == 0 || len(ciphertext) > recoveryCredentialMaximum {
		return retainedExternalCredential(externalEncrypt, err)
	}
	if err := check(); err != nil {
		return retainedExternalCredential(externalAfterEncrypt, nil)
	}
	plain, err := d.disk.process(ctx, "decrypt", ciphertext, 32)
	defer clear(plain)
	if err != nil || len(plain) != 32 || subtle.ConstantTimeCompare(plain, credential) != 1 {
		return retainedExternalCredential(externalDecrypt, err)
	}
	if err := check(); err != nil {
		return retainedExternalCredential(externalAfterDecrypt, nil)
	}
	identity, err := d.disk.write(g.directory, filepath.Base(d.disk.target), ciphertext)
	if err != nil {
		return retainedExternalCredential(externalPersist, nil)
	}
	readback, err := readRegular(d.disk.target, recoveryCredentialMaximum)
	defer clear(readback)
	if err != nil || !bytes.Equal(readback, ciphertext) {
		return retainedExternalCredential(externalReadback, nil)
	}
	if got, err := recoveryCredentialOriginal(d.disk.target, d.disk.owner, 0600, recoveryCredentialMaximum); err != nil || got != identity {
		return retainedExternalCredential(externalCipherMetadata, nil)
	}
	intentPath := filepath.Join(filepath.Dir(d.disk.target), intentName)
	if got, err := recoveryCredentialOriginal(intentPath, d.disk.owner, 0600, 8192); err != nil || got != intentIdentity {
		return retainedExternalCredential(externalIntentMetadata, nil)
	}
	if err := check(); err != nil {
		return retainedExternalCredential(externalAfterPersist, nil)
	}
	report := externalCredentialReceipt{recoveryCredentialReceipt: recoveryCredentialReceipt{Version: "YNX-PQ-EXTERNAL-RECOVERY-CREDENTIAL-INSTALL/v1", Classification: "data", CredentialPath: d.disk.target, CiphertextSHA256: hash(ciphertext), CiphertextBytes: strconv.Itoa(len(ciphertext)), OwnerUID: strconv.FormatUint(uint64(d.disk.owner), 10), Mode: "600", EncryptionProfile: "systemd-default-auto", CiphertextInstalled: true, LocalRoundTripVerified: true, HostKeyUnchanged: true}, ExternalCredentialConsumed: true, Continuation: o.continuation, IntentPath: intentPath, IntentSHA256: hash(rawIntent), PriorIntentSHA256: o.intentSHA256, PriorFailureSHA256: o.failureSHA256}
	if err := json.NewEncoder(output).Encode(report); err != nil {
		return retainedExternalCredential(externalPublicReceipt, nil)
	}
	return nil
}

// Read-only recovery inquiry: no credential is accepted or decrypted, and no
// intent is repaired. The identities support independently prepared DATA pins.
func runInspectRecoveryCredential(args []string, output, _ io.Writer) error {
	if len(args) != 0 {
		return errors.New("inspect-recovery-credential accepts no arguments")
	}
	d := realExternalCredentialIO()
	g, err := captureExternalCredentialGuard(d)
	if err != nil {
		return err
	}
	defer g.directory.Close()
	files := map[string]any{}
	for _, name := range []string{filepath.Base(d.disk.target), recoveryCredentialIntentName, externalCredentialContinuation} {
		path := filepath.Join(filepath.Dir(d.disk.target), name)
		if errors.Is(func() error { _, e := os.Lstat(path); return e }(), os.ErrNotExist) {
			files[name] = map[string]any{"exists": false}
			continue
		}
		identity, err := recoveryCredentialOriginal(path, d.disk.owner, 0600, recoveryCredentialMaximum)
		if err != nil {
			return err
		}
		raw, err := readRegular(path, recoveryCredentialMaximum)
		if err != nil {
			return err
		}
		files[name] = map[string]any{"exists": true, "identity": identity, "bytes": len(raw), "sha256": hash(raw)}
		clear(raw)
	}
	if err := g.unchanged(); err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(map[string]any{"version": "YNX-PQ-RECOVERY-CREDENTIAL-INSPECTION/v1", "classification": "data", "files": files, "hostKeyIdentity": g.host, "machineIDIdentity": g.machine, "mountNamespace": g.ns, "credentialDecrypted": false, "authorityGranted": false, "offHostRecoveryVerified": false, "signingPerformed": false, "serviceChanged": false})
}
