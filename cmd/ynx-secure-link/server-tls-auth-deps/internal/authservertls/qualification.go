//go:build darwin || linux

package authservertls

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sync"
	"time"
)

var ErrSourceNotSupplied = errors.New("AUTH_SERVER_TLS_QUALIFIED_SOURCE_NOT_SUPPLIED")
var ErrSourceDenied = errors.New("AUTH_SERVER_TLS_QUALIFIED_SOURCE_DENIED")

// This private row locates ONLY original Source public resources and the
// original protected full SDK verifier. It is not a Root key/approval model.
// Same original Source Root SHA + N1 credentials/current must independently
// verify. No ENV, DTO, callback, public provider or row setter exists.
type reviewedTLSAuthority struct {
	SourceID, InstanceID                          string
	ProcessUID                                    uint32
	Root, Enrollment, Profile, Head, Node, Runner reviewedFile
	Runtime                                       []reviewedFile // COMPLETE reviewed SDK/package closure, not3 hashes
	Policy                                        json.RawMessage
	NativeNode                                    struct {
		Origin        string `json:"origin"`
		SPKI          string `json:"spki"`
		NativeChainID string `json:"nativeChainId"`
	}
}

func reviewedTLSAuthorities() []reviewedTLSAuthority { return nil }

type tlsIdentityScope struct {
	Version           uint64 `json:"version"`
	NetworkID         string `json:"networkId"`
	SubjectOwner      string `json:"subjectOwner"`
	SourceID          string `json:"sourceId"`
	InstanceID        string `json:"instanceId"`
	ServerID          string `json:"serverId"`
	CredentialRef     string `json:"credentialRef"`
	CredentialEpoch   string `json:"credentialEpoch"`
	IssuerRef         string `json:"issuerRef"`
	TargetOrigin      string `json:"targetOrigin"`
	ServerName        string `json:"serverName"`
	PeerSAN           string `json:"peerSAN"`
	ListenAddress     string `json:"listenAddress"`
	CertificateSHA256 string `json:"certificateSHA256"`
	SPKISHA256        string `json:"spkiSHA256"`
	CASHA256          string `json:"caSHA256"`
	NotBeforeMS       int64  `json:"notBeforeMs"`
	ExpiresMS         int64  `json:"expiresAtMs"`
}
type sourcePrevious struct {
	Sequence        uint64 `json:"sequence"`
	Floor           uint64 `json:"floor"`
	Head            string `json:"head"`
	TimeFloor       int64  `json:"timeFloor"`
	ExecutionHeight string `json:"executionHeight"`
}
type sourceProjection struct {
	Selection         json.RawMessage `json:"selection"`
	PrincipalID       string          `json:"principalId"`
	SubjectOwner      string          `json:"subjectOwner"`
	SubjectKeyVersion string          `json:"subjectKeyVersion"`
	Generation        uint64          `json:"generation"`
	Sequence          uint64          `json:"sequence"`
	Floor             uint64          `json:"floor"`
	Head              string          `json:"head"`
	Status            string          `json:"status"`
	TimeFloor         int64           `json:"timeFloor"`
	ExpiresAtMS       int64           `json:"expiresAtMs"`
	ProfileDigest     string          `json:"profileDigest"`
	SourceID          string          `json:"sourceId"`
	InstanceID        string          `json:"instanceId"`
	ExecutionHeight   string          `json:"executionHeight"`
	DataOnly          bool            `json:"dataOnly"`
	NativeAdmission   bool            `json:"nativeAdmission"`
}
type sourceResult struct {
	Projection sourceProjection `json:"projection"`
	CurrentRaw string           `json:"currentRaw"`
}
type tlsSourceState struct {
	mu                    sync.Mutex
	row                   reviewedTLSAuthority
	files                 []*heldFile
	originals             [4]string
	previous              sourcePrevious
	scope                 tlsIdentityScope
	projection            sourceProjection
	currentOriginal       []byte
	first                 error
	busy, retired, closed bool
	epoch                 uint64
	expires               time.Time
	wallFloor             int64
	changed               chan struct{}
}
type QualifiedServerTLSSource struct{ state *tlsSourceState }

// Zero-configuration normal Source owner. Non-nil partial precedes error.
// No listener/private key/resource FD is touched before this qualifies.
func AcquireOriginalServerTLSQualification(ctx context.Context) (*QualifiedServerTLSSource, error) {
	return acquireTLSQualification(ctx, reviewedTLSAuthorities(), 0)
}
func acquireTLSQualification(ctx context.Context, rows []reviewedTLSAuthority, uid uint32) (*QualifiedServerTLSSource, error) {
	s := &tlsSourceState{epoch: 1, changed: make(chan struct{}), previous: sourcePrevious{ExecutionHeight: "0"}}
	q := &QualifiedServerTLSSource{s}
	fail := func(e error) (*QualifiedServerTLSSource, error) { s.first = e; s.retired = true; return q, e }
	if ctx == nil || ctx.Err() != nil {
		return fail(ErrSourceDenied)
	}
	if len(rows) != 1 {
		return fail(ErrSourceNotSupplied)
	}
	s.row = rows[0]
	r := s.row
	if r.ProcessUID != uint32(os.Geteuid()) || r.SourceID == "" || r.InstanceID == "" || len(r.Runtime) == 0 || len(r.Runtime) > 4096 || filepath.Base(r.Runner.Path) != "original-server-tls-source-qualification-runner.mjs" {
		return fail(ErrSourceDenied)
	}
	var policy struct {
		RootDigest        string `json:"rootDigest"`
		EnrollmentDigest  string `json:"enrollmentDigest"`
		SignatureContract struct {
			Purpose string `json:"purpose"`
		} `json:"signatureContract"`
	}
	if json.Unmarshal(r.Policy, &policy) != nil || policy.SignatureContract.Purpose != "server-tls-identity-source-v1" || policy.RootDigest != r.Root.SHA256 || policy.EnrollmentDigest != r.Enrollment.SHA256 {
		return fail(ErrSourceDenied)
	}
	pins := []reviewedFile{r.Root, r.Enrollment, r.Profile, r.Head, r.Node, r.Runner}
	pins = append(pins, r.Runtime...)
	var total uint64
	for i, p := range pins {
		cap := uint64(16777216)
		if i < 4 {
			cap = 393216
		}
		if i == 0 {
			cap = 16384
		}
		if i == 4 {
			cap = 134217728
		}
		if p.Private || p.Identity.Bytes > cap || total+p.Identity.Bytes > 402653184 {
			return fail(ErrSourceDenied)
		}
		total += p.Identity.Bytes
		h, e := holdReviewedFileBounded(p, uid, cap)
		if h != nil {
			s.files = append(s.files, h)
		}
		if e != nil {
			return fail(e)
		}
		if i < 4 {
			raw, e := io.ReadAll(io.NewSectionReader(h.file, 0, int64(cap)+1))
			if e != nil || uint64(len(raw)) != p.Identity.Bytes {
				return fail(ErrSourceDenied)
			}
			s.originals[i] = string(raw)
		}
	}
	// Every held runtime entry was independently selected by the same Root row.
	// Require the actual Source-v2 dispatch, verifier, original policy/registered
	// math and package closure, not merely a valid runner file hash.
	required := map[string]bool{"original-auth-identity-source-verifier.mjs": false, "original-auth-identity-source-v2-verifier.mjs": false, "original-auth-source-v2-dispatch.mjs": false, "original-server-tls-source-contract.mjs": false, "original-ide-auth-proof-dispatch.mjs": false, "pq-wallet-policy.js": false, "pq-registered-member.js": false, "package.json": false}
	for _, p := range r.Runtime {
		if _, yes := required[filepath.Base(p.Path)]; yes {
			required[filepath.Base(p.Path)] = true
		}
	}
	for _, yes := range required {
		if !yes {
			return fail(ErrSourceDenied)
		}
	}
	s.expires = time.Now().Add(30 * time.Second)
	if e := q.Current(ctx); e != nil {
		return q, e
	}
	return q, nil
}
func decodeSourceResult(raw []byte) (sourceResult, error) {
	var v sourceResult
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&v) != nil {
		return v, ErrSourceDenied
	}
	if d.Decode(new(any)) != io.EOF {
		return v, ErrSourceDenied
	}
	p := v.Projection
	if !p.DataOnly || p.NativeAdmission || p.Status != "active" || p.Sequence == 0 || p.Floor > p.Sequence || p.CurrentInvalid() || v.CurrentRaw == "" {
		return v, ErrSourceDenied
	}
	return v, nil
}
func (p sourceProjection) CurrentInvalid() bool {
	return p.ExpiresAtMS <= 0 || p.TimeFloor <= 0 || p.Generation == 0 || p.ProfileDigest == "" || p.ExecutionHeight == "" || p.SourceID == "" || p.InstanceID == ""
}

type boundedOutput struct {
	bytes.Buffer
	cap      int
	overflow bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.cap {
		remain := b.cap - b.Len()
		if remain > 0 {
			b.Buffer.Write(p[:remain])
		}
		b.overflow = true
		return 0, ErrSourceDenied
	}
	return b.Buffer.Write(p)
}
func (s *tlsSourceState) run(ctx context.Context, previous sourcePrevious) (sourceResult, []byte, error) {
	var v sourceResult
	input := map[string]any{"operation": "auth-source-v2-native-node/v1", "node": s.row.NativeNode, "rootRaw": s.originals[0], "enrollmentRaw": s.originals[1], "profileRaw": s.originals[2], "headRaw": s.originals[3], "policy": s.row.Policy, "previous": previous}
	var raw bytes.Buffer
	enc := json.NewEncoder(&raw)
	enc.SetEscapeHTML(false)
	if enc.Encode(input) != nil {
		return v, nil, ErrSourceDenied
	}
	// Struct field order is not JS canonical object order. Detach as generic
	// JSON numbers/maps, then encode sorted map keys without HTML rewriting.
	var detached any
	detach := json.NewDecoder(bytes.NewReader(raw.Bytes()))
	detach.UseNumber()
	if detach.Decode(&detached) != nil {
		return v, nil, ErrSourceDenied
	}
	raw.Reset()
	enc = json.NewEncoder(&raw)
	enc.SetEscapeHTML(false)
	if enc.Encode(detached) != nil {
		return v, nil, ErrSourceDenied
	}
	body := bytes.TrimSuffix(raw.Bytes(), []byte("\n"))
	if len(body) > 2097152 {
		return v, nil, ErrSourceDenied
	}
	bounded, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, s.row.Node.Path, s.row.Runner.Path)
	cmd.Env = []string{}
	cmd.Stdin = bytes.NewReader(body)
	stdout := &boundedOutput{cap: 1048576}
	stderr := &boundedOutput{cap: 16384}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	e := cmd.Run()
	partial := append([]byte(nil), stdout.Bytes()...)
	if e != nil || stdout.overflow || stderr.overflow {
		if ctx.Err() != nil {
			return v, partial, ctx.Err()
		}
		return v, partial, ErrSourceDenied
	}
	v, e = decodeSourceResult(partial)
	return v, partial, e
}
func (s *tlsSourceState) physicalCurrentLocked() error {
	if s.row.ProcessUID != uint32(os.Geteuid()) {
		return ErrSourceDenied
	}
	for _, h := range s.files {
		if e := h.current(); e != nil {
			return e
		}
	}
	return nil
}
func (s *tlsSourceState) wake() { close(s.changed); s.changed = make(chan struct{}) }
func (s *tlsSourceState) remember(e error) {
	if e != nil && s.first == nil {
		s.first = e
	}
}
func (q *QualifiedServerTLSSource) Current(ctx context.Context) error {
	if q == nil || q.state == nil || ctx == nil {
		return ErrSourceDenied
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	s := q.state
	s.mu.Lock()
	if s.busy {
		s.mu.Unlock()
		return ErrPending
	}
	if s.retired || s.closed || time.Now().UnixMilli() < s.wallFloor || !time.Now().Before(s.expires) {
		s.mu.Unlock()
		return ErrSourceDenied
	}
	if e := s.physicalCurrentLocked(); e != nil {
		s.remember(e)
		s.retired = true
		s.mu.Unlock()
		return e
	}
	s.busy = true
	epoch := s.epoch
	previous := s.previous
	s.mu.Unlock()
	// Actual pinned Source math/network/current occurs OUTSIDE owner/lease lock.
	v, raw, e := s.run(ctx, previous)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.busy = false
	s.wake()
	if len(raw) > 0 {
		s.currentOriginal = append([]byte(nil), raw...)
	} // partial before error
	if e != nil {
		if ctx.Err() == nil {
			s.remember(e)
			s.retired = true
		}
		return e
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if s.epoch != epoch || s.retired || s.closed || !time.Now().Before(s.expires) || time.Now().UnixMilli() < s.wallFloor {
		return ErrSourceDenied
	}
	if e = s.physicalCurrentLocked(); e != nil {
		s.remember(e)
		s.retired = true
		return e
	}
	var selection struct {
		Association                   json.RawMessage  `json:"association"`
		ExpectedRequest               json.RawMessage  `json:"expectedRequest"`
		OriginalHostStatePath         string           `json:"originalHostStatePath"`
		OriginalHostTerminalDirectory string           `json:"originalHostTerminalDirectory"`
		Identity                      tlsIdentityScope `json:"serverTLSIdentityV1"`
	}
	d := json.NewDecoder(bytes.NewReader(v.Projection.Selection))
	d.DisallowUnknownFields()
	if d.Decode(&selection) != nil {
		return ErrSourceDenied
	}
	scope := selection.Identity
	if scope.Version != 1 || scope.SourceID != s.row.SourceID || scope.InstanceID != s.row.InstanceID || v.Projection.SourceID != s.row.SourceID || v.Projection.InstanceID != s.row.InstanceID || v.Projection.SubjectOwner != scope.SubjectOwner || v.Projection.ExpiresAtMS <= time.Now().UnixMilli() || v.Projection.ExpiresAtMS > scope.ExpiresMS || s.projection.SourceID != "" && (!reflect.DeepEqual(scope, s.scope) || s.projection.ProfileDigest != v.Projection.ProfileDigest || s.projection.Generation != v.Projection.Generation) {
		s.remember(ErrSourceDenied)
		s.retired = true
		return ErrSourceDenied
	}
	s.scope = scope
	s.projection = v.Projection
	s.previous = sourcePrevious{v.Projection.Sequence, v.Projection.Floor, v.Projection.Head, v.Projection.TimeFloor, v.Projection.ExecutionHeight}
	s.wallFloor = time.Now().UnixMilli()
	deadline := time.Now().Add(time.Duration(v.Projection.ExpiresAtMS-s.wallFloor) * time.Millisecond)
	if deadline.Before(s.expires) {
		s.expires = deadline
	}
	return nil
}

// Match only resource DATA; cannot create Source or qualify another resource.
func (q *QualifiedServerTLSSource) matchResource(r reviewedServerRelease) error {
	if q == nil || q.state == nil {
		return ErrSourceDenied
	}
	s := q.state
	s.mu.Lock()
	defer s.mu.Unlock()
	x := s.scope
	if x.ServerID == "" || x.ServerID != r.ServerID {
		return ErrSourceDenied
	}
	if s.retired || s.closed || s.busy || x.SourceID == "" || x.SourceID != r.SourceID || x.InstanceID != r.InstanceID || x.CredentialRef != r.CredentialRef || x.CredentialEpoch != r.CredentialEpoch || x.IssuerRef != r.IssuerRef || x.ServerName != r.ServerName || x.PeerSAN != r.PeerSAN || x.ListenAddress != r.ListenAddress || x.TargetOrigin != r.TargetOrigin || x.CertificateSHA256 != r.CertificateSHA256 || x.SPKISHA256 != r.SPKISHA256 || x.CASHA256 != r.CA.SHA256 || x.NotBeforeMS != r.NotBeforeMS || x.ExpiresMS != r.ExpiresMS {
		return ErrSourceDenied
	}
	if !time.Now().Before(s.expires) || time.Now().UnixMilli() < s.wallFloor {
		return ErrSourceDenied
	}
	// Existing three resource names mean the pinned enrollment/profile/baseline
	// originals, NOT a replacement Root or independently live current proof.
	// The latter was fetched+verified by the Source runner above.
	if !reflect.DeepEqual(s.row.Enrollment, r.IssuerOriginal) || !reflect.DeepEqual(s.row.Profile, r.SourceOriginal) || !reflect.DeepEqual(s.row.Head, r.CurrentOriginal) {
		return ErrSourceDenied
	}
	return nil
}

// Readonly original outcome only; never starts another runner/current request.
// Includes a retained prefix after late failure, not a Source permission.
func (q *QualifiedServerTLSSource) CopyOriginalQualificationOutcome() ([]byte, error) {
	if q == nil || q.state == nil {
		return nil, ErrSourceDenied
	}
	s := q.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.currentOriginal...), s.first
}
func (q *QualifiedServerTLSSource) Retire() {
	if q == nil || q.state == nil {
		return
	}
	s := q.state
	s.mu.Lock()
	s.retired = true
	s.epoch++
	s.wake()
	s.mu.Unlock()
}
func (q *QualifiedServerTLSSource) Join(ctx context.Context) error {
	if q == nil || q.state == nil {
		return nil
	}
	if ctx == nil {
		return ErrSourceDenied
	}
	s := q.state
	for {
		s.mu.Lock()
		if !s.retired {
			s.mu.Unlock()
			return ErrSourceDenied
		}
		if !s.busy {
			s.mu.Unlock()
			return nil
		}
		changed := s.changed
		s.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}
func (q *QualifiedServerTLSSource) Close() (bool, error) {
	if q == nil || q.state == nil {
		return true, nil
	}
	s := q.state
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retired = true
	if s.closed {
		return true, s.first
	}
	if s.busy {
		return false, ErrPending
	}
	for i := len(s.files) - 1; i >= 0; i-- {
		if e := s.files[i].closeOriginal(); e != nil {
			s.remember(e)
			return false, s.first
		}
	}
	s.closed = true
	s.wake()
	return true, s.first
}
