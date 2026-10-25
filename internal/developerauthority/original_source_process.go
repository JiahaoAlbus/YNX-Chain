package developerauthority

// The genuine ORIGINAL SDK verifier process used by the server supplier. This
// owner is NOT an OriginalSource: a verified DATA projection does not establish
// commissioning, a request principal, KEY7 approval or a resource grant. The
// eventual supplier owns those independent admission decisions. In particular
// it cannot satisfy the 13-method interface by casting this process owner.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var ErrOriginalVerifierConfiguration = errors.New("original verifier configuration rejected")
var ErrOriginalVerifierUnknown = errors.New("original verifier result unconfirmed")
var ErrOriginalVerifierClosed = errors.New("original verifier owner closed")

type OriginalVerifierFile struct {
	Path   string
	Bytes  int64
	SHA256 string
}

// All pins come from the normal startup owner's independently admitted release,
// never HTTP data or process ENV. SDKFiles is the exact complete SDK subtree,
// not just the entrypoint: otherwise replacing an imported verifier would evade
// the entrypoint hash. Normal installed dependencies must also be inside this
// exact subtree. Symlinks are forbidden. Node's permission boundary prevents
// fallback resolution to unpinned ancestor node_modules or other host files.
// This constructor DOES NOT approve the pins, Root or release on their behalf.
type OriginalSourceVerifierConfig struct {
	Node     OriginalVerifierFile
	SDKRoot  string
	SDKFiles []OriginalVerifierFile // relative canonical POSIX paths
}

func (OriginalSourceVerifierConfig) String() string     { return "OriginalSourceVerifierConfig{redacted}" }
func (c OriginalSourceVerifierConfig) GoString() string { return c.String() }

type verifierHeldFile struct {
	file *os.File
	pin  OriginalVerifierFile
	info fs.FileInfo
}
type OriginalSourceVerifierOwner struct {
	mu                                  sync.Mutex
	closeOnce                           sync.Once
	config                              OriginalSourceVerifierConfig
	files                               []verifierHeldFile
	ready, closed                       bool
	firstCause, closeCause, closeResult error
	phase                               string
	// Preserve actual bounded partial process output BEFORE inspecting status.
	// Never export/log these bytes or wrap remote stderr into public errors.
	processStdout, processStderr      []byte
	processCause, processContextCause error
	processPID, processExitCode       int
	processWaited                     bool
	processStarted                    chan struct{}  // private lifecycle observation, no injected launcher
	pinScratch                        [64 << 10]byte // bounded streaming buffer; never cached authorization/file content
}

func (*OriginalSourceVerifierOwner) String() string {
	return "OriginalSourceVerifierOwner{protected diagnostics redacted}"
}
func (o *OriginalSourceVerifierOwner) GoString() string { return o.String() }
func (o *OriginalSourceVerifierOwner) FailurePhase() string {
	if o == nil {
		return "UNAVAILABLE"
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.phase
}

const originalVerifierEntry = "native/original-auth-identity-source-verifier.mjs"
const originalVerifierInputLimit = 2097152
const originalVerifierOutputLimit = 1048576

var originalProcessOwner = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func originalVerifierPath(path string) bool {
	return filepath.IsAbs(path) && filepath.Clean(path) == path && path != "/" && !strings.ContainsAny(path, "\x00\r\n")
}
func originalVerifierRelative(path string) bool {
	return path != "" && path != "." && filepath.ToSlash(filepath.Clean(path)) == path && !filepath.IsAbs(path) && path != ".." && !strings.HasPrefix(path, "../") && !strings.ContainsAny(path, "\\\x00\r\n")
}
func verifierIdentity(info fs.FileInfo) (*syscall.Stat_t, bool) {
	s, ok := info.Sys().(*syscall.Stat_t)
	return s, ok && (s.Uid == 0 || s.Uid == uint32(os.Geteuid())) && info.Mode().Perm()&0022 == 0
}
func verifierDirectory(path string) error {
	if !originalVerifierPath(path) {
		return ErrOriginalVerifierConfiguration
	}
	for p := path; ; p = filepath.Dir(p) {
		info, e := os.Lstat(p)
		if e != nil {
			return e
		}
		if _, ok := verifierIdentity(info); !ok || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrOriginalVerifierConfiguration
		}
		if p == "/" {
			break
		}
	}
	return nil
}
func verifierOpen(pin OriginalVerifierFile) (verifierHeldFile, error) {
	var h verifierHeldFile
	if !originalVerifierPath(pin.Path) || pin.Bytes <= 0 || pin.Bytes > 256<<20 || !readNonceHex.MatchString(pin.SHA256) {
		return h, ErrOriginalVerifierConfiguration
	}
	if e := verifierDirectory(filepath.Dir(pin.Path)); e != nil {
		return h, e
	}
	fd, e := syscall.Open(pin.Path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if e != nil {
		return h, e
	}
	h = verifierHeldFile{file: os.NewFile(uintptr(fd), pin.Path), pin: pin}
	// Return the real held partial before examining fstat/content errors.
	h.info, e = h.file.Stat()
	if e != nil {
		return h, e
	}
	s, ok := verifierIdentity(h.info)
	if !ok || !h.info.Mode().IsRegular() || s.Nlink != 1 || h.info.Size() != pin.Bytes {
		return h, ErrOriginalVerifierConfiguration
	}
	if e = h.check(); e != nil {
		return h, e
	}
	return h, nil
}
func (h *verifierHeldFile) check() error {
	var scratch [64 << 10]byte
	return h.checkWithBuffer(scratch[:])
}

// Rehash EVERY byte on EVERY pre/post check. Streaming replaces the previous
// ReadAll/growing-copy of a potentially256MiB interpreter, not the integrity
// check. Only bounded scratch storage is reused under the same owner mutex.
func verifierDigestHeld(file *os.File, pin OriginalVerifierFile, scratch []byte) error {
	if file == nil || pin.Bytes <= 0 || pin.Bytes > 256<<20 || len(scratch) != 64<<10 {
		return ErrOriginalVerifierConfiguration
	}
	defer clear(scratch)
	digest := sha256.New()
	n, e := io.CopyBuffer(digest, io.NewSectionReader(file, 0, pin.Bytes+1), scratch)
	if e != nil {
		return e
	}
	if n != pin.Bytes || hex.EncodeToString(digest.Sum(nil)) != pin.SHA256 {
		return ErrOriginalVerifierConfiguration
	}
	return nil
}
func (h *verifierHeldFile) checkWithBuffer(scratch []byte) error {
	if h.file == nil || h.info == nil {
		return ErrOriginalVerifierConfiguration
	}
	if e := verifierDirectory(filepath.Dir(h.pin.Path)); e != nil {
		return e
	}
	named, e := os.Lstat(h.pin.Path)
	if e != nil {
		return e
	}
	held, e := h.file.Stat()
	if e != nil {
		return e
	}
	s, ok := verifierIdentity(held)
	original, originalOK := h.info.Sys().(*syscall.Stat_t)
	if !ok || !originalOK || !verifierStableStat(s, original) || s.Nlink != 1 || !held.Mode().IsRegular() || !os.SameFile(h.info, held) || !os.SameFile(named, held) || named.Mode()&os.ModeSymlink != 0 || held.Size() != h.pin.Bytes || held.Mode() != h.info.Mode() {
		return ErrOriginalVerifierConfiguration
	}
	if e = verifierDigestHeld(h.file, h.pin, scratch); e != nil {
		return e
	}
	// Re-check the same actual descriptor AND name after all reads. Content
	// restoration/mtime restoration must not conceal a changed ctime/inode.
	after, e := h.file.Stat()
	if e != nil {
		return e
	}
	postNamed, e := os.Lstat(h.pin.Path)
	if e != nil {
		return e
	}
	post, postOK := verifierIdentity(after)
	namedStat, namedOK := postNamed.Sys().(*syscall.Stat_t)
	if !postOK || !namedOK || !verifierStableStat(s, post) || !verifierStableStat(original, post) || !verifierStableStat(post, namedStat) || !os.SameFile(h.info, after) || !os.SameFile(postNamed, after) || postNamed.Mode()&os.ModeSymlink != 0 {
		return ErrOriginalVerifierConfiguration
	}
	return verifierDirectory(filepath.Dir(h.pin.Path))
}
func (o *OriginalSourceVerifierOwner) inventory() error {
	if e := verifierDirectory(o.config.SDKRoot); e != nil {
		return e
	}
	expected := map[string]bool{}
	for _, f := range o.config.SDKFiles {
		expected[f.Path] = true
	}
	seen := 0
	e := filepath.WalkDir(o.config.SDKRoot, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 {
			return ErrOriginalVerifierConfiguration
		}
		if d.IsDir() {
			return verifierDirectory(path)
		}
		rel, e := filepath.Rel(o.config.SDKRoot, path)
		if e != nil {
			return e
		}
		if !d.Type().IsRegular() || !expected[filepath.ToSlash(rel)] {
			return ErrOriginalVerifierConfiguration
		}
		seen++
		return nil
	})
	if e != nil {
		return e
	}
	if seen != len(expected) {
		return ErrOriginalVerifierConfiguration
	}
	return nil
}

// Actual production constructor: fixed exec.Command, no injected driver,
// provider, arbitrary operation dispatcher or child launcher. No child process
// is launched at open; the Source owner supplies its own original bounded input.
func OpenOriginalSourceVerifier(c OriginalSourceVerifierConfig) (*OriginalSourceVerifierOwner, error) {
	if !originalVerifierPath(c.SDKRoot) || len(c.SDKFiles) == 0 || len(c.SDKFiles) > 16384 {
		return nil, ErrOriginalVerifierConfiguration
	}
	// Complete SDK19 runtime union already exceeds 4096. Never silently drop
	// pinned files to fit a test fixture or raise a process/system resource limit.
	// Admission requires current soft limit for every held file plus Node/stdio
	// and existing service reserve. OS open failure still returns its real partial.
	var limit syscall.Rlimit
	if e := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &limit); e != nil || limit.Cur < uint64(len(c.SDKFiles)+1+256) {
		return nil, ErrOriginalVerifierConfiguration
	}
	c.SDKFiles = append([]OriginalVerifierFile(nil), c.SDKFiles...)
	seen := map[string]bool{}
	for _, p := range c.SDKFiles {
		if !originalVerifierRelative(p.Path) || seen[p.Path] {
			return nil, ErrOriginalVerifierConfiguration
		}
		seen[p.Path] = true
	}
	if !seen[originalVerifierEntry] {
		return nil, ErrOriginalVerifierConfiguration
	}
	o := &OriginalSourceVerifierOwner{config: c, processStarted: make(chan struct{}, 1)}
	fail := func(cause error) (*OriginalSourceVerifierOwner, error) {
		o.firstCause = cause
		o.phase = "OPEN"
		_ = o.Close()
		return o, ErrOriginalVerifierConfiguration
	}
	if e := o.inventory(); e != nil {
		return fail(e)
	}
	pins := append([]OriginalVerifierFile{c.Node}, c.SDKFiles...)
	for i, p := range pins {
		if i > 0 {
			p.Path = filepath.Join(c.SDKRoot, p.Path)
		}
		h, e := verifierOpen(p)
		if h.file != nil {
			o.files = append(o.files, h)
		}
		if e != nil {
			return fail(e)
		}
		if i == 0 && h.info.Mode().Perm()&0111 == 0 {
			return fail(ErrOriginalVerifierConfiguration)
		}
	}
	o.ready = true
	return o, nil
}

type originalVerifierCapture struct {
	raw       []byte
	limit     int
	rejected  bool
	rejectAny bool
}

func (w *originalVerifierCapture) Write(p []byte) (int, error) {
	// Both streams are drained by os/exec, even after rejection. This avoids a
	// full pipe deadlocking Wait. Never retain unbounded or public error output.
	n := len(p)
	remaining := w.limit - len(w.raw)
	if remaining > 0 {
		if remaining > n {
			remaining = n
		}
		w.raw = append(w.raw, p[:remaining]...)
	}
	if (w.rejectAny && n > 0) || n > remaining {
		w.rejected = true
	}
	return n, nil
}

// InvokeOriginalCurrentDATA uses only the existing ORIGINAL CLI operation.
// The returned bytes are DATA, never a Principal or Approval. Caller must bind
// previous to its durable original watermarks, not a request or default zero.
// It also owns independent Root/release commissioning and the 13-method supplier.
func (o *OriginalSourceVerifierOwner) InvokeOriginalCurrentDATA(ctx context.Context, input []byte) ([]byte, error) {
	if len(input) == 0 || len(input) > originalVerifierInputLimit {
		return nil, ErrDenied
	}
	// Reject unknown/duplicate outer fields before starting a child. The ORIGINAL
	// verifier alone parses/verifies the signed originals, full pairs and current.
	var operation string
	var node, policy, previous json.RawMessage
	var root, enrollment, profile, head string
	if decodeExactObject(input, originalVerifierInputLimit, map[string]any{"operation": &operation, "node": &node, "rootRaw": &root, "enrollmentRaw": &enrollment, "profileRaw": &profile, "headRaw": &head, "policy": &policy, "previous": &previous}) != nil || operation != "auth-source-v2-native-node/v1" {
		return nil, ErrDenied
	}
	return o.invokeDATA(ctx, input, originalVerifierOutputLimit, false, checkOriginalCurrentProcessOutput)
}

// Actual production entry to the SDK's ORIGINAL fixed CLI branch. Public R13
// MUST come from independently current registered publisher custody, not the
// same signature/request. Even successful N1 mathematics is expressly DATA.
// No key generation, signer or new private-key API is used by this method.
func (o *OriginalSourceVerifierOwner) InspectOriginalArtifactDATA(ctx context.Context, signature, manifest, registeredPublic []byte) ([]byte, error) {
	if len(signature) == 0 || len(signature) > 100000 || len(manifest) == 0 || len(manifest) > 16384 || len(registeredPublic) == 0 || len(registeredPublic) > 8192 {
		return nil, ErrDenied
	}
	encode := base64.RawURLEncoding.EncodeToString
	// Go's string-map JSON order is canonical for these ASCII/base64url fields.
	// Only the envelope is built. Each original byte buffer is passed unchanged.
	input, e := json.Marshal(map[string]string{"operation": "ide-artifact-signature-data/v1", "signatureOriginal": encode(signature), "manifestOriginal": encode(manifest), "expectedPublicOriginal": encode(registeredPublic)})
	if e != nil || len(input) > 262144 {
		return nil, ErrDenied
	}
	return o.invokeDATA(ctx, input, 4097, true, checkOriginalArtifactProcessOutput)
}

// Validator is package-private fixed CODE, never config/provider/HTTP injection.
func (o *OriginalSourceVerifierOwner) invokeDATA(ctx context.Context, input []byte, outputLimit int, artifact bool, check func([]byte, time.Time) string) ([]byte, error) {
	if o == nil || ctx == nil {
		return nil, ErrOriginalVerifierClosed
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed || !o.ready || o.firstCause != nil {
		return nil, ErrOriginalVerifierClosed
	}
	if ctx.Err() != nil {
		return nil, ErrOriginalVerifierUnknown
	}
	// Preserve original input bytes: do not parse/rebuild signed bodies, URLs or
	// policy into a second codec. Production CLI enforces canonical JSON itself.
	for i := range o.files {
		if e := o.files[i].checkWithBuffer(o.pinScratch[:]); e != nil {
			o.firstCause = e
			o.phase = "PRE_FILES"
			return nil, ErrOriginalVerifierUnknown
		}
	}
	if e := o.inventory(); e != nil {
		o.firstCause = e
		o.phase = "PRE_INVENTORY"
		return nil, ErrOriginalVerifierUnknown
	}
	before := time.Now()
	bounded, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, o.config.Node.Path, "--permission", "--allow-fs-read="+o.config.SDKRoot, filepath.Join(o.config.SDKRoot, originalVerifierEntry))
	cmd.Env = []string{} // no NODE_OPTIONS, NODE_PATH, proxy, loader or caller ENV
	cmd.Dir = o.config.SDKRoot
	cmd.Stdin = bytes.NewReader(append([]byte(nil), input...))
	out := &originalVerifierCapture{limit: outputLimit}
	errout := &originalVerifierCapture{limit: 4096, rejectAny: true}
	cmd.Stdout = out
	cmd.Stderr = errout
	cmd.WaitDelay = time.Second
	// Capture the actual child immediately after Start, before inspecting its
	// terminal status. Always Wait (including cancellation) to join child+drains.
	e := cmd.Start()
	if e == nil {
		o.processPID = cmd.Process.Pid
		select {
		case o.processStarted <- struct{}{}:
		default:
		}
		e = cmd.Wait()
	}
	o.processStdout = append([]byte(nil), out.raw...)
	o.processStderr = append([]byte(nil), errout.raw...)
	o.processCause = e
	o.processContextCause = bounded.Err()
	if cmd.Process != nil {
		o.processPID = cmd.Process.Pid
	}
	if cmd.ProcessState != nil {
		o.processExitCode = cmd.ProcessState.ExitCode()
		o.processWaited = true
	}
	// A completed fixed SDK mathematical rejection is an untrusted request's
	// DENIED result, not a process custody failure that lets one bad signature
	// disable every tenant. Only this exact original code/exit/no-output pattern
	// is recognized; stderr on success, loader errors, timeout or partial output
	// remain UNKNOWN with sticky owner first cause and no resubmission.
	var childExit *exec.ExitError
	if artifact && errors.As(e, &childExit) && childExit.ExitCode() == 1 && bounded.Err() == nil && len(out.raw) == 0 && !out.rejected && string(errout.raw) == "IDE_ARTIFACT_SIGNATURE_DATA_INVALID\n" {
		for i := range o.files {
			if failure := o.files[i].checkWithBuffer(o.pinScratch[:]); failure != nil {
				o.firstCause = failure
				o.phase = "POST_FILES"
				return nil, ErrOriginalVerifierUnknown
			}
		}
		if failure := o.inventory(); failure != nil {
			o.firstCause = failure
			o.phase = "POST_INVENTORY"
			return nil, ErrOriginalVerifierUnknown
		}
		if ctx.Err() != nil {
			o.firstCause = ctx.Err()
			o.phase = "POST_CONTEXT"
			return nil, ErrOriginalVerifierUnknown
		}
		return nil, ErrDenied
	}
	if e != nil || bounded.Err() != nil || out.rejected || errout.rejected || len(out.raw) == 0 {
		if e == nil {
			e = ErrOriginalVerifierUnknown
		}
		o.firstCause = e
		o.phase = "PROCESS"
		return nil, ErrOriginalVerifierUnknown
	}
	for i := range o.files {
		if e = o.files[i].checkWithBuffer(o.pinScratch[:]); e != nil {
			o.firstCause = e
			o.phase = "POST_FILES"
			return nil, ErrOriginalVerifierUnknown
		}
	}
	if e = o.inventory(); e != nil {
		o.firstCause = e
		o.phase = "POST_INVENTORY"
		return nil, ErrOriginalVerifierUnknown
	}
	if phase := check(out.raw, before); phase != "" {
		o.firstCause = ErrDenied
		o.phase = phase
		return nil, ErrOriginalVerifierUnknown
	}
	if ctx.Err() != nil {
		o.firstCause = ctx.Err()
		o.phase = "POST_CONTEXT"
		return nil, ErrOriginalVerifierUnknown
	}
	return append([]byte(nil), out.raw...), nil
}

func checkOriginalCurrentProcessOutput(raw []byte, before time.Time) string {
	var projection json.RawMessage
	var current string
	if !bytes.HasSuffix(raw, []byte("\n")) || decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), originalVerifierOutputLimit, map[string]any{"projection": &projection, "currentRaw": &current}) != nil || len(current) == 0 || len(current) > 393216 || len(projection) == 0 {
		return "OUTPUT"
	}
	// Final process-bound current time fence; DATA flags cannot be promoted by
	// malformed output or a future callback. Full crypto remains sole SDK code.
	var expires, timeFloor int64
	var data, admission bool
	var status, principal, subject, keyVersion, head, profileDigest, source, instance, height string
	var generation, sequence, floor uint64
	var selection json.RawMessage
	e := decodeExactObject(projection, originalVerifierOutputLimit, map[string]any{"selection": &selection, "principalId": &principal, "subjectOwner": &subject, "subjectKeyVersion": &keyVersion, "generation": &generation, "sequence": &sequence, "floor": &floor, "head": &head, "status": &status, "timeFloor": &timeFloor, "expiresAtMs": &expires, "profileDigest": &profileDigest, "sourceId": &source, "instanceId": &instance, "executionHeight": &height, "dataOnly": &data, "nativeAdmission": &admission})
	_, ke := strconv.ParseUint(keyVersion, 10, 64)
	_, he := strconv.ParseUint(height, 10, 64)
	if e != nil || len(selection) < 2 || !text(principal) || !originalProcessOwner.MatchString(subject) || ke != nil || keyVersion == "0" || strings.HasPrefix(keyVersion, "0") || he != nil || (height != "0" && strings.HasPrefix(height, "0")) || generation == 0 || generation > 9007199254740991 || sequence == 0 || sequence > 9007199254740991 || floor > sequence || !readNonceHex.MatchString(head) || !readNonceHex.MatchString(profileDigest) || !text(source) || !text(instance) || !data || admission || status != "active" || timeFloor < before.UnixMilli() || time.Now().UnixMilli() < timeFloor || time.Now().UnixMilli() >= expires {
		return "POST_CURRENT"
	}
	return ""
}

func checkOriginalArtifactProcessOutput(raw []byte, _ time.Time) string {
	var network, owner, account, project, publisher, revision, purpose, role string
	var verified, data, trusted, authorized, admission, registered, current, publication bool
	var count, index int
	e := decodeExactObject(bytes.TrimSuffix(raw, []byte("\n")), 4096, map[string]any{
		"networkId": &network, "subjectOwner": &owner, "account": &account, "projectId": &project, "publisherId": &publisher, "publisherKeyVersion": &revision,
		"purpose": &purpose, "keyRole": &role, "signatureVerified": &verified, "memberCount": &count, "memberIndex": &index, "dataOnly": &data,
		"trusted": &trusted, "authorized": &authorized, "nativeAdmission": &admission, "registered": &registered, "current": &current, "publicationAuthorized": &publication,
	})
	_, re := strconv.ParseUint(revision, 10, 64)
	if !bytes.HasSuffix(raw, []byte("\n")) || e != nil || !readNonceHex.MatchString(network) || !originalProcessOwner.MatchString(owner) || !text(account) || !text(project) || !text(publisher) || revision == "0" || strings.HasPrefix(revision, "0") || re != nil || purpose != "ARTIFACT-RELEASE" || role != "ide-artifact-publisher" || !verified || count != 1 || index != 0 || !data || trusted || authorized || admission || registered || current || publication {
		return "ARTIFACT_OUTPUT"
	}
	return ""
}

// Close waits behind an in-flight bounded invocation. It closes every retained
// file once, preserves the original failure and a distinct first close error.
// Closed descriptors are never retried (the numeric FD may have been recycled).
func (o *OriginalSourceVerifierOwner) Close() error {
	if o == nil {
		return nil
	}
	o.closeOnce.Do(func() {
		o.mu.Lock()
		defer o.mu.Unlock()
		o.closed = true
		o.ready = false
		for i := range o.files {
			if o.files[i].file != nil {
				e := o.files[i].file.Close()
				o.files[i].file = nil
				if e != nil && o.closeCause == nil {
					o.closeCause = e
					o.closeResult = ErrOriginalVerifierUnknown
				}
			}
		}
	})
	return o.closeResult
}

// Compile-time guard is intentionally NOT OriginalSource: adding a default
// always-deny 13-method façade here would conceal the missing real approvals.
var _ io.Closer = (*OriginalSourceVerifierOwner)(nil)
