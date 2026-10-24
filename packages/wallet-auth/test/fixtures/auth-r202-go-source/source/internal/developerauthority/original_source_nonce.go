package developerauthority

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"regexp"
	"sync"
	"time"
)

// Private ordinary HTTP READ replay custody only. Not a Source/Principal or
// publication/control/resource approval. OriginalSource must obtain its claim
// from genuine original proof/current/revoke verification, NEVER decoded DATA.
type originalReadNonceClaim struct {
	sourceID, instanceID, nonce, proofSHA256, requestSHA256, principalSHA256 string
	issuedMS, expiresMS                                                      int64
}
type originalReadNonceReceipt struct {
	execution, proofSHA256, requestSHA256, principalSHA256 string
	issuedMS, expiresMS, consumedMS                        int64
}
type originalReadNonceAttempt struct {
	once       sync.Once
	claim      originalReadNonceClaim
	execution  string
	receipt    *originalReadNonceReceipt
	cause      error // actual private first cause, never logged or wrapped publicly
	panicCause any
	result     error
	entered    bool
}
type originalReadNonceStore struct {
	db           *sql.DB
	now          func() time.Time
	ready        bool
	startupCause error
}

func (*originalReadNonceAttempt) String() string {
	return "OriginalReadNonceAttempt{protected diagnostics redacted}"
}
func (a *originalReadNonceAttempt) GoString() string { return a.String() }
func (*originalReadNonceStore) String() string {
	return "OriginalReadNonceStore{protected diagnostics redacted}"
}
func (s *originalReadNonceStore) GoString() string { return s.String() }

var readNonceHex = regexp.MustCompile(`^[0-9a-f]{64}$`)
var readNonceToken = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)

func (c originalReadNonceClaim) valid() bool {
	return text(c.sourceID) && text(c.instanceID) && readNonceToken.MatchString(c.nonce) && readNonceHex.MatchString(c.proofSHA256) && readNonceHex.MatchString(c.requestSHA256) && readNonceHex.MatchString(c.principalSHA256) && c.issuedMS > 0 && c.expiresMS > c.issuedMS && c.expiresMS <= 9007199254740991 && c.expiresMS-c.issuedMS <= 30000
}
func newOriginalReadNonceAttempt(c originalReadNonceClaim) (*originalReadNonceAttempt, error) {
	return originalReadNonceAttemptWithEntropy(c, rand.Reader)
}

// Test seam private to package; normal supplier always calls fixed rand.Reader.
// A caller/HTTP execution ID is never accepted by the production constructor.
func originalReadNonceAttemptWithEntropy(c originalReadNonceClaim, entropy io.Reader) (*originalReadNonceAttempt, error) {
	if !c.valid() {
		return nil, ErrDenied
	}
	a := &originalReadNonceAttempt{claim: c}
	var id [32]byte
	if entropy == nil {
		a.cause = ErrUnknown
		a.result = ErrUnknown
		return a, ErrUnknown
	}
	if _, e := io.ReadFull(entropy, id[:]); e != nil {
		a.cause = e
		a.result = ErrUnknown
		return a, ErrUnknown
	}
	a.execution = hex.EncodeToString(id[:])
	return a, nil
}

// No startup DDL, migration, nonce deletion or expiry renewal here. The normal
// original Source pool owner alone supplies db after protected config/current
// verification. This store borrows it and never closes that owner's pool.
func openOriginalReadNonceStore(ctx context.Context, db *sql.DB) (*originalReadNonceStore, error) {
	if ctx == nil || ctx.Err() != nil || db == nil {
		return nil, ErrDenied
	}
	store := &originalReadNonceStore{db: db, now: time.Now}
	var version int
	if e := db.QueryRowContext(ctx, "SELECT revision FROM public.auth_ide_http_read_nonce_schema WHERE singleton=1").Scan(&version); e != nil {
		store.startupCause = e
		return store, ErrUnknown
	}
	if version != 1 {
		store.startupCause = ErrDenied
		return store, ErrUnknown
	}
	if e := ctx.Err(); e != nil {
		store.startupCause = e
		return store, ErrUnknown
	}
	store.ready = true
	return store, nil
}

const originalReadNonceConsumeSQL = `INSERT INTO public.auth_ide_http_read_nonces
(source_id,instance_id,nonce,execution_id,proof_sha256,request_sha256,principal_sha256,issued_ms,expires_ms,consumed_ms)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT(source_id,instance_id,nonce) DO UPDATE
SET execution_id=auth_ide_http_read_nonces.execution_id
WHERE auth_ide_http_read_nonces.execution_id=EXCLUDED.execution_id
AND auth_ide_http_read_nonces.proof_sha256=EXCLUDED.proof_sha256
AND auth_ide_http_read_nonces.request_sha256=EXCLUDED.request_sha256
AND auth_ide_http_read_nonces.principal_sha256=EXCLUDED.principal_sha256
AND auth_ide_http_read_nonces.issued_ms=EXCLUDED.issued_ms
AND auth_ide_http_read_nonces.expires_ms=EXCLUDED.expires_ms
RETURNING execution_id,proof_sha256,request_sha256,principal_sha256,issued_ms,expires_ms,consumed_ms`

func (s *originalReadNonceStore) consume(ctx context.Context, a *originalReadNonceAttempt) error {
	if a == nil {
		return ErrDenied
	}
	// Same actual execution cannot issue another SQL write after UNKNOWN,
	// cancellation, timeout, malformed receipt or post-completion expiry.
	a.once.Do(func() {
		defer func() {
			if p := recover(); p != nil {
				a.panicCause = p
				a.result = ErrUnknown
			}
		}()
		if a.result != nil {
			return
		}
		if s == nil || s.db == nil || s.now == nil || !s.ready || ctx == nil || !a.claim.valid() || !readNonceHex.MatchString(a.execution) {
			a.result = ErrDenied
			return
		}
		if e := ctx.Err(); e != nil {
			a.cause = e
			a.result = ErrDenied
			return
		}
		before := s.now().UnixMilli()
		c := a.claim
		if before < c.issuedMS || before >= c.expiresMS {
			a.result = ErrDenied
			return
		}
		a.entered = true
		r := &originalReadNonceReceipt{}
		e := s.db.QueryRowContext(ctx, originalReadNonceConsumeSQL, c.sourceID, c.instanceID, c.nonce, a.execution, c.proofSHA256, c.requestSHA256, c.principalSHA256, c.issuedMS, c.expiresMS, before).Scan(&r.execution, &r.proofSHA256, &r.requestSHA256, &r.principalSHA256, &r.issuedMS, &r.expiresMS, &r.consumedMS)
		a.receipt = r // retain a real partial BEFORE status/time/cancellation checks
		if e != nil {
			a.cause = e
			if errors.Is(e, sql.ErrNoRows) {
				a.result = ErrDenied
			} else {
				a.result = ErrUnknown
			}
			return
		}
		after := s.now().UnixMilli()
		if e = ctx.Err(); e != nil {
			a.cause = e
			a.result = ErrUnknown
			return
		}
		if after < before || after >= c.expiresMS || r.execution != a.execution || r.proofSHA256 != c.proofSHA256 || r.requestSHA256 != c.requestSHA256 || r.principalSHA256 != c.principalSHA256 || r.issuedMS != c.issuedMS || r.expiresMS != c.expiresMS || r.consumedMS < c.issuedMS || r.consumedMS > before || r.consumedMS >= r.expiresMS {
			a.result = ErrUnknown
			return
		}
	})
	if a.result == nil && (!a.entered || a.receipt == nil) {
		return ErrUnknown
	}
	return a.result
}
