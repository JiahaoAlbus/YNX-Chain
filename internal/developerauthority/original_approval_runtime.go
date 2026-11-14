package developerauthority

// Normal startup entry for the real durable approval query owner. This is not
// OriginalSource13: original principal/control/publisher verification remains
// independently required. No mutable provider/callback or default admission is
// installed by this constructor.
import (
	"context"
	"database/sql"
	"net/http"
	"sync"
)

const OriginalPublicationApprovalCurrentPath = originalApprovalQueryPath

type OriginalPublicationApprovalRuntimeConfig struct {
	SourceID, InstanceID, ProfileSHA256 string
	Verifier                            OriginalSourceVerifierConfig
}

func (OriginalPublicationApprovalRuntimeConfig) String() string {
	return "OriginalPublicationApprovalRuntimeConfig{release-owned references redacted}"
}
func (c OriginalPublicationApprovalRuntimeConfig) GoString() string { return c.String() }

type OriginalPublicationApprovalRuntime struct {
	mu            sync.Mutex
	store         *originalApprovalStore
	issuer        *originalApprovalIssuerOwner
	openCause     error
	closeSelected bool
	closeResult   error
}

func (*OriginalPublicationApprovalRuntime) String() string {
	return "OriginalPublicationApprovalRuntime{original custody redacted}"
}
func (o *OriginalPublicationApprovalRuntime) GoString() string { return o.String() }

// db is the existing actual Auth pool and remains the startup custodian's
// property. No schema creation, retry, alternate pool, key path, or Root role
// registration occurs. Caller must retain a nonnil owner even alongside error.
func OpenOriginalPublicationApprovalRuntime(ctx context.Context, db *sql.DB, c OriginalPublicationApprovalRuntimeConfig) (*OriginalPublicationApprovalRuntime, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || !text(c.SourceID) || !text(c.InstanceID) || !approvalHex.MatchString(c.ProfileSHA256) {
		return nil, ErrDenied
	}
	o := &OriginalPublicationApprovalRuntime{}
	config := originalApprovalStoreConfig{c.SourceID, c.InstanceID, c.ProfileSHA256}
	s, e := openOriginalApprovalStore(ctx, db, config)
	o.store = s
	if e != nil {
		o.openCause = e
		return o, e
	}
	i, e := openOriginalApprovalIssuer(ctx, config, s, c.Verifier)
	o.issuer = i
	if e != nil {
		o.openCause = e
		return o, e
	}
	return o, nil
}

// Mount only at OriginalPublicationApprovalCurrentPath in the original server
// after normal release admission. A successful open is custody acquisition,
// not a Source grant, proof, ready-for-public receipt or commissioning result.
func (o *OriginalPublicationApprovalRuntime) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if o == nil {
		http.Error(w, "ORIGINAL_APPROVAL_UNAVAILABLE", http.StatusServiceUnavailable)
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected || o.openCause != nil || o.issuer == nil {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "ORIGINAL_APPROVAL_UNAVAILABLE", http.StatusServiceUnavailable)
		return
	}
	o.issuer.ServeHTTP(w, r)
}

// Same owner, first result. Borrowed DB is never closed here. Both acquired
// children are attempted even after a first cleanup error. A failed open stays
// visibly failed after cleanup; repeat Close never reports a different result.
func (o *OriginalPublicationApprovalRuntime) Close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected {
		return o.closeResult
	}
	o.closeSelected = true
	for _, close := range []func() error{func() error {
		if o.issuer != nil {
			return o.issuer.Close()
		}
		return nil
	}, func() error {
		if o.store != nil {
			return o.store.Close()
		}
		return nil
	}} {
		if e := close(); e != nil && o.closeResult == nil {
			o.closeResult = e
		}
	}
	if o.closeResult == nil && o.openCause != nil {
		o.closeResult = ErrUnknown
	}
	return o.closeResult
}

var _ http.Handler = (*OriginalPublicationApprovalRuntime)(nil)
