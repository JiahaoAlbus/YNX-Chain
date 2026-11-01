// Package contribution implements local fixed hash and WASM histogram tasks. It has
// no host commands, network, filesystem job payloads, rewards or production
// authority. Only the explicitly named controlled sandbox factory can execute
// today; a canonical publisher/consent authority adapter is still required.
package contribution

import (
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/localstore"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
	"golang.org/x/crypto/sha3"
)

const (
	SandboxClass             = "CONTROLLED_SANDBOX"
	PublicBlockHistogramKind = "public_block_histogram"
	HistogramMemoryBytes     = 129 * 65536
	HistogramMaxInputBytes   = 4 << 20
	HistogramOutputBytes     = 1024
	MaxInputBytes            = 8 << 20
	MaxMemoryBytes           = 24 << 20
	MaxDurationMillis        = 5000
	chunkBytes               = 4096
	fixedMemory              = 64 << 10
	maxRecords               = 256
)

var (
	ErrDenied      = errors.New("DENIED: production job authority not supplied")
	ErrInvalid     = errors.New("INVALID: manifest, consent or input binding")
	ErrLimit       = errors.New("LIMIT: local resource bound exceeded")
	ErrCapacity    = errors.New("NO_CAPACITY: one local operation already active")
	ErrStopped     = errors.New("REVOKED: contribution stopped; new scheduling sealed")
	ErrConflict    = errors.New("CONFLICT: job or consent nonce already bound")
	ErrUnsupported = errors.New("UNSUPPORTED: fixed verify_chunk only")
)

// Binding and all wire limits use strict decimal strings. No digest supplied by
// a worker or source label alone establishes publisher or consent authority.
type Binding struct {
	Bytes   string `json:"bytes"`
	SHA3512 string `json:"sha3_512"`
	SHA512  string `json:"sha512"`
}

func Bind(data []byte) Binding {
	a, b := sha3.Sum512(data), sha512.Sum512(data)
	return Binding{strconv.Itoa(len(data)), hex.EncodeToString(a[:]), hex.EncodeToString(b[:])}
}

type Limits struct {
	CPUMilli       string `json:"cpuMilli"`
	MemoryBytes    string `json:"memoryBytes"`
	StorageBytes   string `json:"storageBytes"`
	EgressBytes    string `json:"egressBytes"`
	DurationMillis string `json:"durationMillis"`
}

type Work struct {
	Job       string  `json:"job"`
	Kind      string  `json:"kind"`
	Issuer    string  `json:"issuer"`
	Input     Binding `json:"input"`
	Limits    Limits  `json:"limits"`
	ExpiresAt string  `json:"expiresAt"`
}

type Consent struct {
	Principal string  `json:"principal"`
	Job       string  `json:"job"`
	Manifest  Binding `json:"manifest"`
	Limits    Limits  `json:"limits"`
	ExpiresAt string  `json:"expiresAt"`
	Nonce     string  `json:"nonce"`
	Allow     bool    `json:"allow"`
}

// Authorizer is a trusted boundary, not a caller-provided JSON boolean. The
// sandbox factory accepts a fixture implementation with real temporary library
// signatures. This interface is deliberately not wired into the helper HTTP API.
// Implementations must respect ctx and must not launch background operations.
type Authorizer interface {
	VerifyManifest(ctx context.Context, issuer string, payload, signature []byte) error
	VerifyConsent(ctx context.Context, principal string, payload, signature []byte) error
}

func ManifestPayload(w Work) []byte {
	domain := "YNX_NETWORK_VERIFY_CHUNK_SANDBOX_V1"
	if w.Kind == PublicBlockHistogramKind {
		domain = "YNX_NETWORK_PUBLIC_BLOCK_HISTOGRAM_SANDBOX_V1"
	}
	b, _ := json.Marshal(struct {
		Domain string `json:"domain"`
		Work   Work   `json:"work"`
	}{domain, w})
	return b
}
func ConsentPayload(c Consent) []byte {
	b, _ := json.Marshal(struct {
		Domain  string  `json:"domain"`
		Consent Consent `json:"consent"`
	}{"YNX_NETWORK_CONSENT_SANDBOX_V1", c})
	return b
}

type Usage struct {
	BytesRead  uint64 `json:"bytesRead"`
	WallMicros uint64 `json:"wallMicros"`
	// Wall time and read bytes are measured locally, not verified CPU service.
	CPUServiceVerified bool          `json:"cpuServiceVerified"`
	Process            *ProcessUsage `json:"process,omitempty"`
}

type Result struct {
	Job      string  `json:"job"`
	Manifest Binding `json:"manifest"`
	Input    Binding `json:"input"`
	Output   Binding `json:"output"`
}
type Receipt struct {
	ID            string `json:"id"`
	Job           string `json:"job"`
	Class         string `json:"class"`
	Result        Result `json:"result"`
	VerifiedBytes uint64 `json:"verifiedBytes"`
	VerifiedAt    string `json:"verifiedAt"`
}
type Record struct {
	Work         Work     `json:"work"`
	Manifest     Binding  `json:"manifest"`
	ConsentNonce string   `json:"consentNonce"`
	State        string   `json:"state"`
	Usage        Usage    `json:"usage"`
	Result       Result   `json:"result"`
	Receipt      *Receipt `json:"receipt,omitempty"`
	Failure      string   `json:"failure,omitempty"`
}
type journal struct {
	Version int               `json:"version"`
	Jobs    map[string]Record `json:"jobs"`
	Nonces  map[string]string `json:"nonces"`
}
type operation struct {
	cancel   context.CancelFunc
	done     chan struct{}
	reserved uint64
}
type Runner struct {
	mu                      sync.Mutex
	path                    string
	lock                    *localstore.Lock
	authorizer              Authorizer
	executor                *PinnedWASMExecutor
	sandbox, sealed, closed bool
	active                  *operation
	data                    journal
	persistenceErr          error
	authorizedJobs          map[string]time.Time
}

// NewDisabled is the production default. It cannot execute any job, regardless
// of consent or signature bytes. Nothing is scheduled on construction/restart.
func NewDisabled(path string) (*Runner, error) { return open(path, nil, false) }

// NewControlledSandbox is only for isolated, operator-controlled local tests.
// Its receipts always retain CONTROLLED_SANDBOX and are never economic proofs.
func NewControlledSandbox(path string, authorizer Authorizer) (*Runner, error) {
	if authorizer == nil {
		return nil, ErrDenied
	}
	return open(path, authorizer, true)
}

// NewControlledWASMSandbox adds one pinned, fixed no-import WASM worker. It
// retains the original sandbox authorization and non-economic receipt class.
// No production authority is inferred from the runtime's containment.
func NewControlledWASMSandbox(path string, authority Authorizer, executor *PinnedWASMExecutor) (*Runner, error) {
	if authority == nil || executor == nil {
		return nil, ErrDenied
	}
	r, err := open(path, authority, true)
	if err != nil {
		return nil, err
	}
	r.executor = executor
	return r, nil
}
func isFixedKind(kind string) bool        { return kind == "verify_chunk" || kind == PublicBlockHistogramKind }
func histogramMemory(input uint64) uint64 { return HistogramMemoryBytes + 2*input + fixedMemory }
func validResultForWork(w Work, result Result) bool {
	if w.Kind == "verify_chunk" {
		return result == resultFor(w, w.Input)
	}
	return w.Kind == PublicBlockHistogramKind && result.Job == w.Job && result.Manifest == Bind(ManifestPayload(w)) && result.Input == w.Input && validBinding(result.Output) && result.Output.Bytes == "1024"
}
func open(path string, authority Authorizer, sandbox bool) (*Runner, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, ErrInvalid
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	// Never take over a legacy directory owner. New journals use a persistent
	// private marker with a kernel lock, released on crash without deleting data.
	owner := path + ".owner"
	if _, err := os.Lstat(owner); err == nil {
		return nil, ErrConflict
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	lock, err := localstore.Acquire(path + ".owner.lock")
	if err != nil {
		return nil, fmt.Errorf("exclusive local journal owner: %w", err)
	}
	r := &Runner{path: path, lock: lock, authorizer: authority, sandbox: sandbox,
		data: journal{Version: 1, Jobs: map[string]Record{}, Nonces: map[string]string{}}, authorizedJobs: map[string]time.Time{}}
	ok := false
	defer func() {
		if !ok {
			_ = lock.Close()
		}
	}()
	if fi, err := os.Lstat(path); err == nil {
		if !fi.Mode().IsRegular() || fi.Mode().Perm()&0077 != 0 || fi.Size() > 4<<20 {
			return nil, ErrInvalid
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	legacy, err := productstore.Load(path, &r.data)
	if err != nil {
		return nil, err
	}
	if legacy || r.data.Version != 1 || r.data.Jobs == nil || r.data.Nonces == nil || len(r.data.Jobs) > maxRecords || len(r.data.Nonces) > maxRecords {
		return nil, ErrInvalid
	}
	var measuredBytes, measuredMicros uint64
	var measuredUser, measuredSystem uint64
	for id, rec := range r.data.Jobs {
		if err := validateStoredRecord(id, rec, r.data.Nonces); err != nil {
			return nil, ErrInvalid
		}
		if rec.Usage.BytesRead > ^uint64(0)-measuredBytes || rec.Usage.WallMicros > ^uint64(0)-measuredMicros {
			return nil, ErrInvalid
		}
		measuredBytes += rec.Usage.BytesRead
		measuredMicros += rec.Usage.WallMicros
		if u := rec.Usage.Process; u != nil {
			if u.UserMicros > ^uint64(0)-measuredUser || u.SystemMicros > ^uint64(0)-measuredSystem {
				return nil, ErrInvalid
			}
			measuredUser += u.UserMicros
			measuredSystem += u.SystemMicros
			if v := u.Monitor; v != nil {
				if v.UserMicros > ^uint64(0)-measuredUser || v.SystemMicros > ^uint64(0)-measuredSystem {
					return nil, ErrInvalid
				}
				measuredUser += v.UserMicros
				measuredSystem += v.SystemMicros
			}
		}
		if rec.State == "preparing" || rec.State == "running" || rec.State == "verifying" {
			rec.State, rec.Failure = "interrupted", "prior process stopped; usage is a lower bound, no automatic replay"
			r.data.Jobs[id] = rec
		}
		// An unkeyed local snapshot is not evidence that bytes were rechecked in
		// this process. Preserve the old receipt, but recount only after re-read.
		if rec.State == "verified" {
			rec.State = "historical"
			r.data.Jobs[id] = rec
		}
	}
	if len(r.data.Nonces) != len(r.data.Jobs) {
		return nil, ErrInvalid
	}
	if err := r.persist(); err != nil {
		return nil, err
	}
	ok = true
	return r, nil
}

func (r *Runner) persist() error {
	if err := r.lock.Check(); err != nil {
		return err
	}
	return productstore.Save(r.path, r.data)
}

func validateStoredRecord(id string, rec Record, nonces map[string]string) error {
	if !boundedMetadata(rec.Work) || !validID(id) || id != rec.Work.Job || !validID(rec.Work.Issuer) || !isFixedKind(rec.Work.Kind) || !validBinding(rec.Work.Input) || rec.Manifest != Bind(ManifestPayload(rec.Work)) || nonces[rec.ConsentNonce] != id {
		return ErrInvalid
	}
	var key []string
	if json.Unmarshal([]byte(rec.ConsentNonce), &key) != nil || len(key) != 2 || !validID(key[0]) || !validID(key[1]) || nonceKey(key[0], key[1]) != rec.ConsentNonce {
		return ErrInvalid
	}
	if _, err := time.Parse(time.RFC3339Nano, rec.Work.ExpiresAt); err != nil {
		return ErrInvalid
	}
	n, e := strictUint(rec.Work.Input.Bytes)
	if e != nil || n == 0 || n > MaxInputBytes {
		return ErrInvalid
	}
	cpu, e1 := strictUint(rec.Work.Limits.CPUMilli)
	mem, e2 := strictUint(rec.Work.Limits.MemoryBytes)
	ms, e3 := strictUint(rec.Work.Limits.DurationMillis)
	if e1 != nil || e2 != nil || e3 != nil || cpu == 0 || cpu > 1000 || mem < n+fixedMemory || mem > MaxMemoryBytes || ms == 0 || ms > MaxDurationMillis || !validScratch(rec.Work.Kind, rec.Work.Limits.StorageBytes) || rec.Work.Limits.EgressBytes != "0" || rec.Usage.CPUServiceVerified {
		return ErrInvalid
	}
	if !validProcessUsage(rec.Usage.Process) {
		return ErrInvalid
	}
	if rec.Work.Kind == PublicBlockHistogramKind && (n > HistogramMaxInputBytes || mem < histogramMemory(n)) {
		return ErrInvalid
	}
	switch rec.State {
	case "preparing", "running", "failed", "stopped", "interrupted", "unknown":
		if rec.Receipt != nil {
			return ErrInvalid
		}
	case "submitted":
		if !validResultForWork(rec.Work, rec.Result) || rec.Receipt != nil {
			return ErrInvalid
		}
	case "verified", "historical":
		p := rec.Receipt
		if p == nil || p.ID != "sandbox:"+id || p.Job != id || p.Class != SandboxClass || p.Result != rec.Result || !validResultForWork(rec.Work, rec.Result) || p.VerifiedBytes != n {
			return ErrInvalid
		}
		if _, err := time.Parse(time.RFC3339Nano, p.VerifiedAt); err != nil {
			return ErrInvalid
		}
	default:
		return ErrInvalid
	}
	return nil
}

func strictUint(v string) (uint64, error) {
	if v == "" || len(v) > 20 || (len(v) > 1 && v[0] == '0') {
		return 0, ErrInvalid
	}
	for _, c := range v {
		if c < '0' || c > '9' {
			return 0, ErrInvalid
		}
	}
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return 0, ErrInvalid
	}
	return n, nil
}
func validID(s string) bool {
	if len(s) == 0 || len(s) > 128 {
		return false
	}
	for _, c := range s {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == ':') {
			return false
		}
	}
	return true
}
func validBinding(b Binding) bool {
	if _, e := strictUint(b.Bytes); e != nil {
		return false
	}
	for _, s := range []string{b.SHA3512, b.SHA512} {
		if len(s) != 128 || strings.ToLower(s) != s {
			return false
		}
		if _, e := hex.DecodeString(s); e != nil {
			return false
		}
	}
	return true
}
func liveExpiry(v string, now time.Time) (time.Time, error) {
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil || !now.Before(t) || t.After(now.Add(24*time.Hour)) {
		return time.Time{}, ErrInvalid
	}
	return t, nil
}

type bounds struct {
	cpu, memory uint64
	deadline    time.Time
}

func boundedMetadata(w Work) bool {
	if len(w.ExpiresAt) > 64 {
		return false
	}
	for _, s := range []string{w.Limits.CPUMilli, w.Limits.MemoryBytes, w.Limits.StorageBytes, w.Limits.EgressBytes, w.Limits.DurationMillis} {
		if len(s) > 20 {
			return false
		}
	}
	return true
}

func checkWork(w Work, c Consent, inputLen int, now time.Time) (bounds, error) {
	if !isFixedKind(w.Kind) {
		return bounds{}, ErrUnsupported
	}
	if !boundedMetadata(w) || len(c.ExpiresAt) > 64 {
		return bounds{}, ErrInvalid
	}
	if !validID(w.Job) || !validID(w.Issuer) || !validID(c.Principal) || !validID(c.Nonce) || !validBinding(w.Input) || !c.Allow || c.Job != w.Job || c.Manifest != Bind(ManifestPayload(w)) || c.Limits != w.Limits {
		return bounds{}, ErrInvalid
	}
	we, e := liveExpiry(w.ExpiresAt, now)
	if e != nil {
		return bounds{}, e
	}
	ce, e := liveExpiry(c.ExpiresAt, now)
	if e != nil || ce.After(we) {
		return bounds{}, ErrInvalid
	}
	n, e := strictUint(w.Input.Bytes)
	if e != nil || n != uint64(inputLen) || n == 0 || n > MaxInputBytes {
		return bounds{}, ErrLimit
	}
	cpu, e1 := strictUint(w.Limits.CPUMilli)
	mem, e2 := strictUint(w.Limits.MemoryBytes)
	_, e3 := strictUint(w.Limits.StorageBytes)
	egress, e4 := strictUint(w.Limits.EgressBytes)
	ms, e5 := strictUint(w.Limits.DurationMillis)
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil {
		return bounds{}, ErrInvalid
	}
	if cpu == 0 || cpu > 1000 || mem < n+fixedMemory || mem > MaxMemoryBytes || !validScratch(w.Kind, w.Limits.StorageBytes) || egress != 0 || ms == 0 || ms > MaxDurationMillis {
		return bounds{}, ErrLimit
	}
	if w.Kind == PublicBlockHistogramKind && (n > HistogramMaxInputBytes || mem < histogramMemory(n)) {
		return bounds{}, ErrLimit
	}
	deadline := now.Add(time.Duration(ms) * time.Millisecond)
	if ce.Before(deadline) {
		deadline = ce
	}
	return bounds{cpu, mem, deadline}, nil
}
func nonceKey(principal, nonce string) string {
	b, _ := json.Marshal([]string{principal, nonce})
	return string(b)
}

// StartContribution validates both signatures, exact input/limits and capacity
// before starting the sole fixed worker. cpuMilli is a cooperative duty-cycle
// cap with a bounded 4KiB burst, not an OS-enforced host quota. That distinction
// is one reason this runner is not exposed as production resource contribution.
func (r *Runner) StartContribution(ctx context.Context, w Work, c Consent, manifestSig, consentSig, input []byte) (Record, error) {
	if !r.sandbox || r.authorizer == nil {
		return Record{}, ErrDenied
	}
	b, err := checkWork(w, c, len(input), time.Now())
	if err != nil {
		return Record{}, err
	}
	if w.Kind == PublicBlockHistogramKind {
		if r.executor == nil || w.Limits.StorageBytes != "0" && r.executor.linux == nil {
			return Record{}, ErrUnsupported
		}
		// This task counts bounded JSON bytes; it does not establish consensus,
		// transaction inclusion, authenticity of an RPC report or public service.
		if !json.Valid(input) || len(bytes.TrimSpace(input)) == 0 || bytes.TrimSpace(input)[0] != '{' {
			return Record{}, ErrInvalid
		}
	}
	if len(manifestSig) == 0 || len(manifestSig) > 65536 || len(consentSig) == 0 || len(consentSig) > 65536 {
		return Record{}, ErrInvalid
	}
	authCtx, cancel := context.WithDeadline(ctx, b.deadline)
	defer cancel()
	if err := r.authorizer.VerifyManifest(authCtx, w.Issuer, ManifestPayload(w), manifestSig); err != nil {
		if authCtx.Err() != nil {
			return Record{}, authCtx.Err()
		}
		return Record{}, ErrDenied
	}
	if err := r.authorizer.VerifyConsent(authCtx, c.Principal, ConsentPayload(c), consentSig); err != nil {
		if authCtx.Err() != nil {
			return Record{}, authCtx.Err()
		}
		return Record{}, ErrDenied
	}
	if err := authCtx.Err(); err != nil {
		return Record{}, err
	}
	approvedUntil, _ := time.Parse(time.RFC3339Nano, c.ExpiresAt)
	r.mu.Lock()
	if r.closed || r.sealed {
		r.mu.Unlock()
		return Record{}, ErrStopped
	}
	if old, ok := r.data.Jobs[w.Job]; ok {
		if old.Manifest != c.Manifest {
			r.mu.Unlock()
			return Record{}, ErrConflict
		}
		// Restored local metadata never restores authority. Freshly checked
		// signatures permit re-auditing this exact old job without rerunning it.
		r.authorizedJobs[w.Job] = approvedUntil
		r.mu.Unlock()
		return cloneRecord(old), nil
	}
	if _, ok := r.data.Nonces[nonceKey(c.Principal, c.Nonce)]; ok {
		r.mu.Unlock()
		return Record{}, ErrConflict
	}
	if r.active != nil {
		r.mu.Unlock()
		return Record{}, ErrCapacity
	}
	if len(r.data.Jobs) >= maxRecords {
		r.mu.Unlock()
		return Record{}, ErrLimit
	}
	jobCtx, jobCancel := context.WithDeadline(ctx, b.deadline)
	op := &operation{cancel: jobCancel, done: make(chan struct{}), reserved: b.memory}
	r.active = op
	rec := Record{Work: w, Manifest: c.Manifest, ConsentNonce: nonceKey(c.Principal, c.Nonce), State: "preparing"}
	r.data.Jobs[w.Job] = rec
	r.data.Nonces[rec.ConsentNonce] = w.Job
	r.authorizedJobs[w.Job] = approvedUntil
	if err := r.persist(); err != nil {
		// An ambiguous durable claim is never retried in this process.
		rec.State, rec.Failure = "unknown", err.Error()
		r.data.Jobs[w.Job] = rec
		r.sealed = true
		r.persistenceErr = err
		jobCancel()
		r.active = nil
		close(op.done)
		r.mu.Unlock()
		return Record{}, err
	}
	r.mu.Unlock()
	// Ownership is copied only after reserving capacity. The caller must not
	// mutate input during this synchronous call; no caller slice reaches worker.
	owned := append([]byte(nil), input...)
	bound, preflightUsage, bindErr := hashChunked(jobCtx, owned, b.cpu)
	r.mu.Lock()
	rec.Usage = preflightUsage
	if bindErr != nil || bound != w.Input || r.sealed || r.closed {
		if bindErr == nil {
			if r.sealed || r.closed {
				bindErr = ErrStopped
			} else {
				bindErr = ErrInvalid
			}
		}
		rec.State, rec.Failure = "failed", bindErr.Error()
		if r.sealed || r.closed || jobCtx.Err() != nil {
			rec.State = "stopped"
		}
		r.data.Jobs[w.Job] = rec
		if err := r.persist(); err != nil {
			r.sealed = true
			r.persistenceErr = err
			bindErr = err
		}
		jobCancel()
		r.active = nil
		close(op.done)
		r.mu.Unlock()
		return Record{}, bindErr
	}
	rec.State = "running"
	r.data.Jobs[w.Job] = rec
	if err := r.persist(); err != nil {
		rec.State, rec.Failure = "unknown", err.Error()
		r.data.Jobs[w.Job] = rec
		r.sealed = true
		r.persistenceErr = err
		jobCancel()
		r.active = nil
		close(op.done)
		r.mu.Unlock()
		return Record{}, err
	}
	r.mu.Unlock()
	go r.run(jobCtx, op, w, owned, b.cpu)
	return rec, nil
}

func hashChunked(ctx context.Context, input []byte, cpu uint64) (Binding, Usage, error) {
	a, b := sha3.New512(), sha512.New()
	start := time.Now()
	var usage Usage
	var active time.Duration
	for pos := 0; pos < len(input); {
		if err := ctx.Err(); err != nil {
			usage.WallMicros = uint64(time.Since(start).Microseconds())
			return Binding{}, usage, err
		}
		end := pos + chunkBytes
		if end > len(input) {
			end = len(input)
		}
		chunkStart := time.Now()
		_, _ = a.Write(input[pos:end])
		_, _ = b.Write(input[pos:end])
		active += time.Since(chunkStart)
		usage.BytesRead += uint64(end - pos)
		pos = end
		// Sleeping is cancellable and never counted as verified CPU service.
		target := time.Duration(int64(active) * 1000 / int64(cpu))
		delay := target - time.Since(start)
		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				usage.WallMicros = uint64(time.Since(start).Microseconds())
				return Binding{}, usage, ctx.Err()
			case <-timer.C:
			}
		}
	}
	usage.WallMicros = uint64(time.Since(start).Microseconds())
	if err := ctx.Err(); err != nil {
		return Binding{}, usage, err
	}
	if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
		return Binding{}, usage, context.DeadlineExceeded
	}
	return Binding{strconv.Itoa(len(input)), hex.EncodeToString(a.Sum(nil)), hex.EncodeToString(b.Sum(nil))}, usage, nil
}
func resultFor(w Work, input Binding) Result {
	manifest := Bind(ManifestPayload(w))
	payload, _ := json.Marshal(struct {
		Kind  string  `json:"kind"`
		Job   string  `json:"job"`
		Input Binding `json:"input"`
	}{"verify_chunk", w.Job, input})
	return Result{w.Job, manifest, input, Bind(payload)}
}
func (r *Runner) run(ctx context.Context, op *operation, w Work, input []byte, cpu uint64) {
	var bound Binding
	var usage Usage
	var err error
	var candidate Result
	if w.Kind == PublicBlockHistogramKind {
		var output []byte
		output, usage, err = r.executor.Execute(ctx, input, w.Limits)
		bound = w.Input
		if err == nil {
			if len(output) != HistogramOutputBytes {
				err = ErrInvalid
			} else {
				candidate = Result{Job: w.Job, Manifest: Bind(ManifestPayload(w)), Input: w.Input, Output: Bind(output)}
			}
		}
	} else {
		bound, usage, err = hashChunked(ctx, input, cpu)
		candidate = resultFor(w, bound)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	defer close(op.done)
	defer op.cancel()
	defer func() { r.active = nil }()
	rec := r.data.Jobs[w.Job]
	rec.Usage.BytesRead += usage.BytesRead
	rec.Usage.WallMicros += usage.WallMicros
	rec.Usage.Process = cloneProcessUsage(usage.Process)
	if err == nil {
		err = ctx.Err()
	}
	if err != nil || r.sealed {
		rec.State = "stopped"
		if err != nil && ctx.Err() == nil && !r.sealed {
			rec.State = "failed"
		}
		if err != nil {
			rec.Failure = err.Error()
		} else {
			rec.Failure = ErrStopped.Error()
		}
	} else if bound != w.Input {
		rec.State = "failed"
		rec.Failure = ErrInvalid.Error()
	} else {
		rec.State = "submitted"
		rec.Result = candidate
	}
	r.data.Jobs[w.Job] = rec
	if err := r.persist(); err != nil {
		rec.State = "unknown"
		rec.Failure = "local journal write failed: " + err.Error()
		r.data.Jobs[w.Job] = rec
		r.sealed = true
		r.persistenceErr = err
	}
}

func cloneRecord(v Record) Record {
	v.Usage.Process = cloneProcessUsage(v.Usage.Process)
	if v.Receipt != nil {
		copy := *v.Receipt
		v.Receipt = &copy
	}
	return v
}
func (r *Runner) Record(job string) (Record, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.data.Jobs[job]
	return cloneRecord(v), ok
}
func (r *Runner) Wait(ctx context.Context) error {
	r.mu.Lock()
	op := r.active
	r.mu.Unlock()
	if op == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.persistenceErr
	}
	select {
	case <-op.done:
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.persistenceErr
	case <-ctx.Done():
		return ctx.Err()
	}
}

// VerifyWorkReceipt independently re-reads and recomputes the original bytes,
// then compares the exact fixed output. No worker usage report can
// increment the verified counter. A duplicate returns its one existing receipt.
func (r *Runner) VerifyWorkReceipt(ctx context.Context, job string, candidate Result, input []byte) (Receipt, error) {
	if !r.sandbox || r.authorizer == nil {
		return Receipt{}, ErrDenied
	}
	r.mu.Lock()
	rec, ok := r.data.Jobs[job]
	if !ok || candidate != rec.Result || (rec.State != "submitted" && rec.State != "verified" && rec.State != "historical") {
		r.mu.Unlock()
		return Receipt{}, ErrInvalid
	}
	if rec.State == "verified" && rec.Receipt != nil {
		out := *rec.Receipt
		r.mu.Unlock()
		return out, nil
	}
	approvedUntil, authorized := r.authorizedJobs[job]
	if !authorized || !time.Now().Before(approvedUntil) {
		r.mu.Unlock()
		return Receipt{}, ErrDenied
	}
	if r.closed || r.sealed {
		r.mu.Unlock()
		return Receipt{}, ErrStopped
	}
	if r.active != nil {
		r.mu.Unlock()
		return Receipt{}, ErrCapacity
	}
	n, err := strictUint(rec.Work.Input.Bytes)
	if err != nil || n != uint64(len(input)) || n > MaxInputBytes {
		r.mu.Unlock()
		return Receipt{}, ErrLimit
	}
	ms, e1 := strictUint(rec.Work.Limits.DurationMillis)
	cpu, e2 := strictUint(rec.Work.Limits.CPUMilli)
	if e1 != nil || e2 != nil || ms == 0 || ms > MaxDurationMillis || cpu == 0 || cpu > 1000 {
		r.mu.Unlock()
		return Receipt{}, ErrLimit
	}
	deadline := time.Now().Add(time.Duration(ms) * time.Millisecond)
	if approvedUntil.Before(deadline) {
		deadline = approvedUntil
	}
	opCtx, cancel := context.WithDeadline(ctx, deadline)
	op := &operation{cancel: cancel, done: make(chan struct{}), reserved: n + fixedMemory}
	r.active = op
	r.mu.Unlock()
	bound, usage, recomputeErr := hashChunked(opCtx, input, cpu)
	expected := resultFor(rec.Work, bound)
	if recomputeErr == nil && rec.Work.Kind == PublicBlockHistogramKind {
		var output []byte
		var histogramUsage Usage
		output, histogramUsage, recomputeErr = independentHistogram(opCtx, input, cpu)
		usage.BytesRead += histogramUsage.BytesRead
		usage.WallMicros += histogramUsage.WallMicros
		if recomputeErr == nil {
			expected = Result{Job: rec.Work.Job, Manifest: Bind(ManifestPayload(rec.Work)), Input: bound, Output: Bind(output)}
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	defer close(op.done)
	defer cancel()
	defer func() { r.active = nil }()
	rec.Usage.BytesRead += usage.BytesRead
	rec.Usage.WallMicros += usage.WallMicros
	r.data.Jobs[job] = rec
	fail := func(cause error) (Receipt, error) {
		if err := r.persist(); err != nil {
			r.sealed = true
			r.persistenceErr = err
			return Receipt{}, err
		}
		return Receipt{}, cause
	}
	if recomputeErr != nil {
		return fail(recomputeErr)
	}
	if r.sealed || r.closed {
		return fail(ErrStopped)
	}
	if bound != rec.Work.Input || candidate != expected {
		return fail(ErrInvalid)
	}
	receipt := Receipt{ID: "sandbox:" + job, Job: job, Class: SandboxClass, Result: candidate, VerifiedBytes: n, VerifiedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	priorState, priorReceipt := rec.State, rec.Receipt
	rec.State = "verified"
	rec.Receipt = &receipt
	r.data.Jobs[job] = rec
	if err := r.persist(); err != nil {
		rec.State = priorState
		rec.Receipt = priorReceipt
		r.data.Jobs[job] = rec
		r.sealed = true
		r.persistenceErr = err
		return Receipt{}, err
	}
	return receipt, nil
}

// StopContribution seals scheduling first, cancels only this runner's fixed
// operation, then waits for its final accounting and quota release. Success
// guarantees there is no remaining worker. Existing usage/receipts are retained.
func (r *Runner) StopContribution(ctx context.Context) error {
	r.mu.Lock()
	r.sealed = true
	op := r.active
	if op != nil {
		op.cancel()
	}
	r.mu.Unlock()
	if op != nil {
		select {
		case <-op.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.persistenceErr
}

type Meter struct {
	Class                     string `json:"class"`
	State                     string `json:"state"`
	ActiveWorkers             uint64 `json:"activeWorkers"`
	ReservedMemoryBytes       uint64 `json:"reservedMemoryBytes"`
	MeasuredBytesRead         uint64 `json:"measuredBytesRead"`
	MeasuredWallMicros        uint64 `json:"measuredWallMicros"`
	VerifiedJobs              uint64 `json:"verifiedJobs"`
	VerifiedBytes             uint64 `json:"verifiedBytes"`
	CPUServiceVerified        bool   `json:"cpuServiceVerified"`
	Rewards                   string `json:"rewards"`
	Accounting                string `json:"accounting"`
	OSUserMicros              uint64 `json:"osUserMicros"`
	OSSystemMicros            uint64 `json:"osSystemMicros"`
	OSPeakRSSBytes            uint64 `json:"osPeakRSSBytes"`
	OSMeasuredChildren        uint64 `json:"osMeasuredChildren"`
	OSAccounting              string `json:"osAccounting"`
	LinuxMeasuredGroups       uint64 `json:"linuxMeasuredGroups"`
	LinuxGroupUserMicros      uint64 `json:"linuxGroupUserMicros"`
	LinuxGroupSystemMicros    uint64 `json:"linuxGroupSystemMicros"`
	LinuxGroupMemoryPeakBytes uint64 `json:"linuxGroupMemoryPeakBytes"`
	LinuxGroupOOMKills        uint64 `json:"linuxGroupOOMKills"`
	LinuxGroupThrottledMicros uint64 `json:"linuxGroupThrottledMicros"`
	LinuxGroupAccounting      string `json:"linuxGroupAccounting"`
}

// VerifyResourceMeter derives unique locally reverified jobs from stored
// receipts; callers cannot import counters or self-reported CPU quantities.
func (r *Runner) VerifyResourceMeter() Meter {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := Meter{Class: SandboxClass, State: "disabled", Rewards: "NOT_AUTHORIZED", Accounting: "LOCAL_MEASUREMENTS_NOT_CPU_SERVICE", OSAccounting: "LOCAL_WORKER_AND_MONITOR_WAIT4_CPU_SUM_MAX_SINGLE_PID_RSS_INCLUDES_HISTORY_NOT_SERVICE", LinuxGroupAccounting: "INDEPENDENT_CGROUP_TOTALS_NOT_ADDED_TO_WRAPPER_WAIT4_NOT_SERVICE"}
	if r.persistenceErr != nil {
		m.Accounting = "UNKNOWN_LOCAL_PERSISTENCE"
	}
	if r.sealed {
		m.State = "stopped"
	}
	if r.active != nil {
		m.State = "running"
		m.ActiveWorkers = 1
		m.ReservedMemoryBytes = r.active.reserved
	}
	for _, rec := range r.data.Jobs {
		m.MeasuredBytesRead += rec.Usage.BytesRead
		m.MeasuredWallMicros += rec.Usage.WallMicros
		if u := rec.Usage.Process; u != nil {
			m.OSUserMicros += u.UserMicros
			m.OSSystemMicros += u.SystemMicros
			if u.PeakRSSBytes > m.OSPeakRSSBytes {
				m.OSPeakRSSBytes = u.PeakRSSBytes
			}
			m.OSMeasuredChildren++
			if g := u.Group; g != nil {
				m.LinuxMeasuredGroups++
				m.LinuxGroupUserMicros += g.UserMicros
				m.LinuxGroupSystemMicros += g.SystemMicros
				m.LinuxGroupOOMKills += g.OOMKills
				m.LinuxGroupThrottledMicros += g.ThrottledMicros
				if g.MemoryPeakBytes > m.LinuxGroupMemoryPeakBytes {
					m.LinuxGroupMemoryPeakBytes = g.MemoryPeakBytes
				}
			}
			if v := u.Monitor; v != nil {
				m.OSUserMicros += v.UserMicros
				m.OSSystemMicros += v.SystemMicros
				if v.PeakRSSBytes > m.OSPeakRSSBytes {
					m.OSPeakRSSBytes = v.PeakRSSBytes
				}
				m.OSMeasuredChildren++
			}
		}
		if rec.Receipt != nil && rec.State == "verified" {
			m.VerifiedJobs++
			m.VerifiedBytes += rec.Receipt.VerifiedBytes
		}
	}
	return m
}
func (r *Runner) Close() error {
	if err := r.StopContribution(context.Background()); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	if r.executor != nil {
		if err := r.executor.Close(); err != nil {
			return err
		}
	}
	r.closed = true
	return r.lock.Close()
}
