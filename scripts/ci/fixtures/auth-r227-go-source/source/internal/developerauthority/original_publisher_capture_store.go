package developerauthority

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// A retained verifier observation, NOT decoded DTOs or signature booleans, is
// the only input. This journal cannot activate a publisher or change an ACL.
type originalPublisherCaptureStore struct {
	mu                      sync.Mutex
	db                      *sql.DB // original factory pool, borrowed and never closed here
	ready, closed           bool
	firstCause, closeResult error
}
type originalPublisherCaptureAttempt struct {
	completed                                            atomic.Bool
	once                                                 sync.Once
	store                                                *originalPublisherCaptureStore
	observation                                          *originalPublisherCurrent
	principal                                            Principal
	command                                              Command
	public, proof, principalRaw, commandRaw              []byte
	caller, execution                                    string
	source, instance, profile, head, nonce, registration string
	generation, sequence, floor                          uint64
	grantExpires, observationExpires                     int64
	entered                                              bool
	receipt                                              *originalPublisherCaptureReceipt
	firstCause, result                                   error
	panicCause                                           any
}
type originalPublisherCaptureReceipt struct {
	execution, registration, nonce, principalSHA, commandSHA, publicSHA, proofSHA, profile, head, state string
	revision, capturedAt, grantExpires, observationExpires                                              int64
}

func (*originalPublisherCaptureStore) String() string {
	return "originalPublisherCaptureStore{original journal custody redacted; not registration authority}"
}
func (s *originalPublisherCaptureStore) GoString() string { return s.String() }
func (*originalPublisherCaptureAttempt) String() string {
	return "originalPublisherCaptureAttempt{originals/partial/UNKNOWN retained privately}"
}
func (a *originalPublisherCaptureAttempt) GoString() string { return a.String() }
func (*originalPublisherCaptureReceipt) String() string {
	return "originalPublisherCaptureReceipt{observation DATA only; not publisher permission}"
}
func (r *originalPublisherCaptureReceipt) GoString() string { return r.String() }

func openOriginalPublisherCaptureStore(ctx context.Context, db *sql.DB) (*originalPublisherCaptureStore, error) {
	if ctx == nil || ctx.Err() != nil || db == nil {
		return nil, ErrDenied
	}
	s := &originalPublisherCaptureStore{db: db}
	var revision int
	for _, q := range []string{`SELECT revision FROM public.auth_ide_control_capture_schema WHERE singleton=1`, `SELECT revision FROM public.auth_ide_publisher_capture_schema WHERE singleton=1`} {
		if e := db.QueryRowContext(ctx, q).Scan(&revision); e != nil {
			s.firstCause = e
			return s, ErrUnknown
		}
		if revision != 1 {
			s.firstCause = ErrDenied
			return s, ErrUnknown
		}
	}
	if e := ctx.Err(); e != nil {
		s.firstCause = e
		return s, ErrUnknown
	}
	s.ready = true
	return s, nil
}

func (s *originalPublisherCaptureStore) retainOriginal(r *originalPublisherCurrent, p Principal, c Command, public, proof []byte, caller string) (*originalPublisherCaptureAttempt, error) {
	return s.retainOriginalWithEntropy(r, p, c, public, proof, caller, rand.Reader)
}

// Private deterministic test seam, never accepted by normal factory/HTTP input.
func (s *originalPublisherCaptureStore) retainOriginalWithEntropy(r *originalPublisherCurrent, p Principal, c Command, public, proof []byte, caller string, entropy io.Reader) (*originalPublisherCaptureAttempt, error) {
	if s == nil || r == nil {
		return nil, ErrDenied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || s.firstCause != nil {
		return nil, ErrUnknown
	}
	a := &originalPublisherCaptureAttempt{store: s, observation: r, principal: p, command: c, public: append([]byte(nil), public...), proof: append([]byte(nil), proof...), caller: caller}
	r.mu.Lock()
	a.source = r.sourceID
	a.instance = r.instanceID
	a.profile = r.profile
	a.head = r.head
	a.nonce = r.nonce
	a.registration = r.projection.RegistrationRef
	a.generation = r.generation
	a.sequence = r.sequence
	a.floor = r.floor
	a.grantExpires = r.reviewExpiresMS
	a.observationExpires = r.projection.ExpiresMS
	r.mu.Unlock()
	if e := r.recheckOriginalCompletion(context.Background(), p, c, a.public, a.proof, caller); e != nil {
		a.firstCause = e
		a.result = ErrUnknown
		return a, ErrUnknown
	}
	a.principalRaw, _ = json.Marshal(p)
	a.commandRaw, _ = json.Marshal(c)
	var id [32]byte
	if entropy == nil {
		a.firstCause = ErrDenied
		a.result = ErrUnknown
		return a, ErrUnknown
	}
	if _, e := io.ReadFull(entropy, id[:]); e != nil {
		a.firstCause = e
		a.result = ErrUnknown
		return a, ErrUnknown
	}
	a.execution = hex.EncodeToString(id[:])
	return a, nil
}

// Both monotonic Source observation and capture insert happen in one SQL
// statement. A lost result is UNKNOWN; no code retries this statement.
const originalPublisherCaptureInsertSQL = `WITH observed AS (
 INSERT INTO public.auth_ide_control_source_heads
 (source_id,instance_id,profile_sha256,generation,sequence,floor,capture_head)
 VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(source_id,instance_id) DO UPDATE SET
 profile_sha256=EXCLUDED.profile_sha256,generation=EXCLUDED.generation,
 sequence=EXCLUDED.sequence,floor=EXCLUDED.floor,capture_head=EXCLUDED.capture_head
 WHERE auth_ide_control_source_heads.generation<=EXCLUDED.generation
 AND auth_ide_control_source_heads.sequence<=EXCLUDED.sequence
 AND auth_ide_control_source_heads.floor<=EXCLUDED.floor
 AND (auth_ide_control_source_heads.generation<EXCLUDED.generation OR auth_ide_control_source_heads.profile_sha256=EXCLUDED.profile_sha256)
 AND (auth_ide_control_source_heads.sequence<EXCLUDED.sequence OR auth_ide_control_source_heads.capture_head=EXCLUDED.capture_head)
 RETURNING capture_head
 ) INSERT INTO public.auth_ide_publisher_captures
 (source_id,instance_id,profile_sha256,capture_head,registration_ref,execution_id,registration_nonce,principal_sha256,command_sha256,public_sha256,proof_sha256,grant_expires_ms,observation_expires_ms,captured_ms,principal_original,command_original,public_original,proof_original,verified_original,source_before,source_after)
 SELECT $1,$2,$3,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24 FROM observed WHERE capture_head=$7
 ON CONFLICT DO NOTHING
 RETURNING execution_id,registration_ref,registration_nonce,principal_sha256,command_sha256,public_sha256,proof_sha256,profile_sha256,capture_head,capture_state,capture_revision,captured_ms,grant_expires_ms,observation_expires_ms`

func scanOriginalPublisherCapture(row *sql.Row, r *originalPublisherCaptureReceipt) error {
	return row.Scan(&r.execution, &r.registration, &r.nonce, &r.principalSHA, &r.commandSHA, &r.publicSHA, &r.proofSHA, &r.profile, &r.head, &r.state, &r.revision, &r.capturedAt, &r.grantExpires, &r.observationExpires)
}
func (r *originalPublisherCaptureReceipt) matches(a *originalPublisherCaptureAttempt) bool {
	return r.matchesBinding(a) && r.execution == a.execution
}
func (r *originalPublisherCaptureReceipt) matchesBinding(a *originalPublisherCaptureAttempt) bool {
	return r != nil && readNonceHex.MatchString(r.execution) && r.registration == a.registration && r.nonce == a.nonce && r.principalSHA == objectHash(a.principal) && r.commandSHA == objectHash(a.command) && r.publicSHA == hash(a.public) && r.proofSHA == hash(a.proof) && r.profile == a.profile && r.head == a.head && r.revision >= 1 && r.capturedAt > 0 && r.grantExpires == a.grantExpires && r.observationExpires == a.observationExpires
}
func (s *originalPublisherCaptureStore) capture(ctx context.Context, a *originalPublisherCaptureAttempt) error {
	if a == nil {
		return ErrDenied
	}
	a.once.Do(func() {
		defer a.completed.Store(true)
		defer func() {
			if cause := recover(); cause != nil {
				a.panicCause = cause
				if e, ok := cause.(error); ok {
					a.firstCause = e
				} else {
					a.firstCause = ErrUnknown
				}
				a.result = ErrUnknown
			}
		}()
		if a.result != nil {
			return
		}
		if s == nil || a.store != s || ctx == nil {
			a.firstCause = ErrDenied
			a.result = ErrDenied
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if !s.ready || s.closed || s.firstCause != nil {
			a.firstCause = ErrUnknown
			a.result = ErrUnknown
			return
		}
		if e := a.observation.recheckOriginalCompletion(ctx, a.principal, a.command, a.public, a.proof, a.caller); e != nil {
			a.firstCause = e
			a.result = ErrUnknown
			return
		}
		before := time.Now().UnixMilli()
		r := &originalPublisherCaptureReceipt{}
		a.observation.mu.Lock()
		verified := append([]byte(nil), a.observation.original...)
		first := append([]byte(nil), a.observation.before...)
		last := append([]byte(nil), a.observation.after...)
		a.observation.mu.Unlock()
		a.entered = true
		a.receipt = r // Scan may fill an actual partial before error/panic.
		e := scanOriginalPublisherCapture(s.db.QueryRowContext(ctx, originalPublisherCaptureInsertSQL, a.source, a.instance, a.profile, a.generation, a.sequence, a.floor, a.head, a.registration, a.execution, a.nonce, objectHash(a.principal), objectHash(a.command), hash(a.public), hash(a.proof), a.grantExpires, a.observationExpires, before, a.principalRaw, a.commandRaw, a.public, a.proof, verified, first, last), r)
		if e != nil {
			a.firstCause = e
			if errors.Is(e, sql.ErrNoRows) {
				a.result = ErrConflict
			} else {
				a.result = ErrUnknown
			}
			return
		}
		if !r.matches(a) || r.state != "captured" || r.revision != 1 || r.capturedAt != before {
			a.firstCause = ErrDenied
			a.result = ErrUnknown
			return
		}
		if e = a.observation.recheckOriginalCompletion(ctx, a.principal, a.command, a.public, a.proof, a.caller); e != nil {
			a.firstCause = e
			a.result = ErrUnknown
			return
		}
	})
	if a.result == nil && (!a.entered || a.receipt == nil) {
		return ErrUnknown
	}
	return a.result
}

const originalPublisherCaptureObserveSQL = `SELECT execution_id,registration_ref,registration_nonce,principal_sha256,command_sha256,public_sha256,proof_sha256,profile_sha256,capture_head,capture_state,capture_revision,captured_ms,grant_expires_ms,observation_expires_ms FROM public.auth_ide_publisher_captures WHERE source_id=$1 AND instance_id=$2 AND registration_ref=$3 AND execution_id=$4`

// Reconcile only this actual execution. Expired originals may still be read as
// DATA; observing a committed row never clears the attempt's UNKNOWN/result.
func (s *originalPublisherCaptureStore) observeOriginal(ctx context.Context, a *originalPublisherCaptureAttempt) (*originalPublisherCaptureReceipt, error) {
	if s == nil || a == nil || a.store != s || ctx == nil || ctx.Err() != nil || !readNonceHex.MatchString(a.execution) {
		return nil, ErrDenied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || s.firstCause != nil {
		return nil, ErrUnknown
	}
	r := &originalPublisherCaptureReceipt{}
	e := scanOriginalPublisherCapture(s.db.QueryRowContext(ctx, originalPublisherCaptureObserveSQL, a.source, a.instance, a.registration, a.execution), r)
	if e != nil {
		return r, ErrUnknown
	}
	if !r.matches(a) || (r.state != "captured" && r.state != "revoked") {
		return r, ErrUnknown
	}
	if e = ctx.Err(); e != nil {
		return r, ErrUnknown
	}
	return r, nil
}

const originalPublisherCaptureObserveBindingSQL = `SELECT execution_id,registration_ref,registration_nonce,principal_sha256,command_sha256,public_sha256,proof_sha256,profile_sha256,capture_head,capture_state,capture_revision,captured_ms,grant_expires_ms,observation_expires_ms FROM public.auth_ide_publisher_captures WHERE source_id=$1 AND instance_id=$2 AND registration_ref=$3 AND registration_nonce=$4 AND principal_sha256=$5 AND command_sha256=$6 AND public_sha256=$7 AND proof_sha256=$8`

// A fresh store/process can recover the ORIGINAL execution id using the same
// verifier-owned request binding. This is observation only: no capture SQL,
// nonce/signature renewal or clearing either attempt's UNKNOWN. A normal HTTP
// owner must not expose this private callee as an unauthenticated record oracle.
func (s *originalPublisherCaptureStore) observeOriginalBinding(ctx context.Context, a *originalPublisherCaptureAttempt) (*originalPublisherCaptureReceipt, error) {
	if s == nil || a == nil || a.store != s || ctx == nil || ctx.Err() != nil || !text(a.source) || !text(a.instance) || !text(a.registration) || !readNonceToken.MatchString(a.nonce) {
		return nil, ErrDenied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || s.firstCause != nil {
		return nil, ErrUnknown
	}
	r := &originalPublisherCaptureReceipt{}
	e := scanOriginalPublisherCapture(s.db.QueryRowContext(ctx, originalPublisherCaptureObserveBindingSQL, a.source, a.instance, a.registration, a.nonce, objectHash(a.principal), objectHash(a.command), hash(a.public), hash(a.proof)), r)
	if e != nil {
		return r, ErrUnknown
	}
	if !r.matchesBinding(a) || (r.state != "captured" && r.state != "revoked") {
		return r, ErrUnknown
	}
	if e = ctx.Err(); e != nil {
		return r, ErrUnknown
	}
	return r, nil
}
func (s *originalPublisherCaptureStore) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return s.closeResult
	}
	s.closed = true
	s.ready = false
	if s.firstCause != nil {
		s.closeResult = ErrUnknown
	}
	return s.closeResult
}
