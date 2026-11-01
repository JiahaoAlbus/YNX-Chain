// Package taskactionv6 invokes the original installed SDK V6 DATA projection.
// It never serializes a V6 signed message, verifies a signature or admits Source.
package taskactionv6

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const CLIPath = "scripts/inspect-task-action-v6.mjs"
const maxBody = 1048576
const maxHeader = 196608
const maxInput = 2097152
const maxOutput = 2048
const maxStderr = 4096

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)
var headerASCII = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
var errorCode = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,127}\n$`)

// FilePin is a row of the sole normal build owner's complete runtime closure.
// Path is package-relative. This package checks rows, not graph completeness or
// trust provenance. An HTTP request must never supply BuildInputs or these pins.
type FilePin struct {
	Path   string
	Bytes  int64
	SHA256 string
}
type BuildInputs struct {
	NodePath     string
	NodeBytes    int64
	NodeSHA256   string
	PackageRoot  string
	CLI_SHA256   string
	RuntimeFiles []FilePin
}
type Request struct {
	NetworkID    string
	ProofHeader  string
	BodyOriginal []byte
}
type Projection struct {
	Version           string `json:"version"`
	RequestDigest     string `json:"requestDigest"`
	BodyDigest        string `json:"bodyDigest"`
	BodyBytes         string `json:"bodyBytes"`
	DataOnly          bool   `json:"dataOnly"`
	SignatureVerified bool   `json:"signatureVerified"`
	SourceAdmission   bool   `json:"SourceAdmission"`
	NativeAdmission   bool   `json:"NativeAdmission"`
}
type Error struct {
	Code     string
	CLI_Code string
	cause    error
}

func (e *Error) Error() string { return e.Code }
func (e *Error) Unwrap() error { return e.cause }
func bad(code string) error    { return &Error{Code: code} }

type Bridge struct {
	node    string
	root    string
	nodePin FilePin
	files   []FilePin
}

// OpenInstalledCLI accepts only original protected build/startup inputs; no
// request-controlled command, arguments, environment, module or endpoint exists.
func OpenInstalledCLI(in BuildInputs) (*Bridge, error) {
	if !hex64.MatchString(in.NodeSHA256) || !hex64.MatchString(in.CLI_SHA256) || in.NodeBytes < 1 || in.NodeBytes > 536870912 || len(in.RuntimeFiles) < 10 || len(in.RuntimeFiles) > 4096 {
		return nil, bad("TASK_V6_BUILD_INPUT_INVALID")
	}
	if !canonicalAbsolute(in.NodePath) || !canonicalAbsolute(in.PackageRoot) {
		return nil, bad("TASK_V6_BUILD_PATH_INVALID")
	}
	st, err := os.Lstat(in.PackageRoot)
	if err != nil || !st.IsDir() {
		return nil, bad("TASK_V6_BUILD_PATH_INVALID")
	}
	b := &Bridge{node: in.NodePath, root: in.PackageRoot, nodePin: FilePin{Bytes: in.NodeBytes, SHA256: in.NodeSHA256}, files: append([]FilePin(nil), in.RuntimeFiles...)}
	required := map[string]bool{CLIPath: false, "package.json": false, "product-session-registry.json": false, "src/product-session-task-action-v6.js": false, "src/product-session-proof-v4.js": false, "src/canonical.js": false, "src/pq-public-bytes.js": false, "src/crypto.js": false, "src/product-session-registry.js": false, "node_modules/@ynx/batch-v01-candidate/package.json": false}
	previous := ""
	for _, p := range b.files {
		if !relativePath(p.Path) || p.Path <= previous || p.Bytes < 1 || p.Bytes > 67108864 || !hex64.MatchString(p.SHA256) {
			return nil, bad("TASK_V6_BUILD_MANIFEST_INVALID")
		}
		previous = p.Path
		if _, ok := required[p.Path]; ok {
			required[p.Path] = true
		}
		if p.Path == CLIPath && p.SHA256 != in.CLI_SHA256 {
			return nil, bad("TASK_V6_BUILD_CLI_PIN_MISMATCH")
		}
	}
	for _, ok := range required {
		if !ok {
			return nil, bad("TASK_V6_BUILD_MANIFEST_INCOMPLETE")
		}
	}
	if err := b.check(context.Background()); err != nil {
		return nil, err
	}
	return b, nil
}
func canonicalAbsolute(p string) bool {
	if !filepath.IsAbs(p) || filepath.Clean(p) != p || strings.ContainsAny(p, "\x00\r\n") {
		return false
	}
	actual, e := filepath.EvalSymlinks(p)
	return e == nil && actual == p
}
func relativePath(p string) bool {
	if p == "" || strings.ContainsAny(p, "\\\x00\r\n") || strings.HasPrefix(p, "/") || strings.HasSuffix(p, "/") {
		return false
	}
	for _, s := range strings.Split(p, "/") {
		if s == "" || s == "." || s == ".." {
			return false
		}
		for _, c := range s {
			if c < 0x20 || c > 0x7e {
				return false
			}
		}
	}
	return true
}
func verifyFile(ctx context.Context, path string, pin FilePin) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !canonicalAbsolute(path) {
		return bad("TASK_V6_BUILD_PATH_CHANGED")
	}
	before, e := os.Lstat(path)
	if e != nil || !before.Mode().IsRegular() || before.Size() != pin.Bytes {
		return bad("TASK_V6_BUILD_PIN_MISMATCH")
	}
	f, e := openPinned(path)
	if e != nil {
		return bad("TASK_V6_BUILD_OPEN_UNAVAILABLE")
	}
	defer f.Close()
	opened, e := f.Stat()
	if e != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) || opened.Size() != pin.Bytes {
		return bad("TASK_V6_BUILD_FILE_CHANGED")
	}
	hash := sha256.New()
	buf := make([]byte, 65536)
	var n int64
	for {
		if e := ctx.Err(); e != nil {
			return e
		}
		count, er := f.Read(buf)
		if count > 0 {
			n += int64(count)
			if n > pin.Bytes {
				return bad("TASK_V6_BUILD_FILE_CHANGED")
			}
			_, _ = hash.Write(buf[:count])
		}
		if er == io.EOF {
			break
		}
		if er != nil {
			return bad("TASK_V6_BUILD_READ_FAILED")
		}
	}
	after, e := os.Lstat(path)
	if e != nil || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || n != pin.Bytes || hex.EncodeToString(hash.Sum(nil)) != pin.SHA256 {
		return bad("TASK_V6_BUILD_PIN_MISMATCH")
	}
	return nil
}
func (b *Bridge) check(ctx context.Context) error {
	if b == nil {
		return bad("TASK_V6_BRIDGE_UNAVAILABLE")
	}
	if e := verifyFile(ctx, b.node, b.nodePin); e != nil {
		return e
	}
	for _, p := range b.files {
		if e := verifyFile(ctx, filepath.Join(b.root, filepath.FromSlash(p.Path)), p); e != nil {
			return e
		}
	}
	return nil
}

type cappedWriter struct {
	b        bytes.Buffer
	max      int
	overflow bool
	cancel   context.CancelFunc
}

func (w *cappedWriter) Write(p []byte) (int, error) {
	if len(p) > w.max-w.b.Len() {
		w.overflow = true
		w.cancel()
		return 0, errors.New("TASK_V6_PROCESS_OUTPUT_LIMIT")
	}
	return w.b.Write(p)
}

func (b *Bridge) Project(ctx context.Context, r Request) (Projection, error) {
	var empty Projection
	if ctx == nil {
		return empty, bad("TASK_V6_CONTEXT_REQUIRED")
	}
	if e := ctx.Err(); e != nil {
		return empty, e
	}
	if !hex64.MatchString(r.NetworkID) || len(r.ProofHeader) == 0 || len(r.ProofHeader) > maxHeader || !headerASCII.MatchString(r.ProofHeader) || len(r.BodyOriginal) > maxBody {
		return empty, bad("TASK_V6_REQUEST_INVALID")
	}
	body := append([]byte(nil), r.BodyOriginal...)
	in := map[string]string{"operation": "task-action-v6-request-digest-projection", "networkId": r.NetworkID, "proofHeader": r.ProofHeader, "bodyOriginal": base64.RawURLEncoding.EncodeToString(body)}
	wire, e := json.Marshal(in)
	if e != nil || len(wire) > maxInput {
		return empty, bad("TASK_V6_REQUEST_INVALID")
	}
	call, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if e = b.check(call); e != nil {
		return empty, e
	}
	stdout := &cappedWriter{max: maxOutput, cancel: cancel}
	stderr := &cappedWriter{max: maxStderr, cancel: cancel}
	cmd := exec.CommandContext(call, b.node, filepath.Join(b.root, filepath.FromSlash(CLIPath)))
	cmd.Dir = b.root
	cmd.Env = []string{}
	cmd.Stdin = bytes.NewReader(wire)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.WaitDelay = time.Second
	e = cmd.Run()
	if stdout.overflow || stderr.overflow {
		return empty, bad("TASK_V6_PROCESS_OUTPUT_LIMIT")
	}
	if ctx.Err() != nil {
		return empty, ctx.Err()
	}
	if call.Err() != nil {
		return empty, bad("TASK_V6_PROCESS_TIMEOUT")
	}
	if e != nil {
		code := ""
		if errorCode.Match(stderr.b.Bytes()) {
			code = strings.TrimSuffix(stderr.b.String(), "\n")
		}
		return empty, &Error{Code: "TASK_V6_NODE_CLI_REJECTED", CLI_Code: code}
	}
	if stderr.b.Len() != 0 {
		return empty, bad("TASK_V6_UNEXPECTED_STDERR")
	}
	p, e := decodeProjection(stdout.b.Bytes())
	if e != nil {
		return empty, e
	}
	sum := sha256.Sum256(body)
	if p.BodyDigest != hex.EncodeToString(sum[:]) || p.BodyBytes != decimalLength(len(body)) {
		return empty, bad("TASK_V6_ORIGINAL_BODY_MISMATCH")
	}
	if e = b.check(call); e != nil {
		return empty, e
	}
	return p, nil
}
func decimalLength(n int) string { b, _ := json.Marshal(n); return string(b) }
func decodeProjection(raw []byte) (Projection, error) {
	var out Projection
	if len(raw) < 2 || len(raw) > maxOutput || raw[len(raw)-1] != '\n' {
		return out, bad("TASK_V6_OUTPUT_INVALID")
	}
	wire := raw[:len(raw)-1]
	d := json.NewDecoder(bytes.NewReader(wire))
	first, e := d.Token()
	if e != nil || first != json.Delim('{') {
		return out, bad("TASK_V6_OUTPUT_INVALID")
	}
	values := map[string]json.RawMessage{}
	keys := []string{"version", "requestDigest", "bodyDigest", "bodyBytes", "dataOnly", "signatureVerified", "SourceAdmission", "NativeAdmission"}
	sort.Strings(keys)
	for d.More() {
		t, e := d.Token()
		if e != nil {
			return out, bad("TASK_V6_OUTPUT_INVALID")
		}
		k, ok := t.(string)
		if !ok || sort.SearchStrings(keys, k) >= len(keys) || keys[sort.SearchStrings(keys, k)] != k {
			return out, bad("TASK_V6_OUTPUT_UNKNOWN_FIELD")
		}
		if _, ok := values[k]; ok {
			return out, bad("TASK_V6_OUTPUT_DUPLICATE_FIELD")
		}
		var v json.RawMessage
		if d.Decode(&v) != nil {
			return out, bad("TASK_V6_OUTPUT_INVALID")
		}
		values[k] = v
	}
	if len(values) != 8 {
		return out, bad("TASK_V6_OUTPUT_INVALID")
	}
	if t, e := d.Token(); e != nil || t != json.Delim('}') {
		return out, bad("TASK_V6_OUTPUT_INVALID")
	}
	var trailing any
	if d.Decode(&trailing) != io.EOF {
		return out, bad("TASK_V6_OUTPUT_TRAILING")
	}
	if json.Unmarshal(wire, &out) != nil || out.Version != "6" || !hex64.MatchString(out.RequestDigest) || !hex64.MatchString(out.BodyDigest) || !regexp.MustCompile(`^(0|[1-9][0-9]{0,6})$`).MatchString(out.BodyBytes) || !out.DataOnly || out.SignatureVerified || out.SourceAdmission || out.NativeAdmission {
		return Projection{}, bad("TASK_V6_OUTPUT_INVALID")
	}
	count, er := strconv.ParseUint(out.BodyBytes, 10, 64)
	if er != nil || count > maxBody {
		return Projection{}, bad("TASK_V6_OUTPUT_INVALID")
	}
	canonical := map[string]any{"version": out.Version, "requestDigest": out.RequestDigest, "bodyDigest": out.BodyDigest, "bodyBytes": out.BodyBytes, "dataOnly": true, "signatureVerified": false, "SourceAdmission": false, "NativeAdmission": false}
	encoded, _ := json.Marshal(canonical)
	if !bytes.Equal(encoded, wire) {
		return Projection{}, bad("TASK_V6_OUTPUT_NONCANONICAL")
	}
	return out, nil
}
