package video

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"time"
)

// VideoLocalTransaction is supplied only by the original protected authority.
// Execute must synchronously hold its authority gate around the callback.
type VideoLocalTransaction interface {
	Execute(context.Context, func(context.Context) error) error
}

// VideoBusinessGrant is issued only by the trusted shared verifier. This product
// transaction boundary cannot authenticate headers or create a Wallet session.
type VideoBusinessGrant struct {
	Actor, Nonce, BodyDigest, SessionBinding string
	ProductID, Scope                         string
	SessionExpiresAt                         time.Time
	ExpiresAt                                time.Time
	Revalidate                               func(context.Context) error
	// Current checks the captured live actor/device/generation locally, without
	// network or Store recursion. Remote Revalidate runs before taking Store's lock.
	Current func(context.Context) error
	// Fresh capture per local commit, after remote preflight and before Store lock.
	// Membership-changing commands require an original writer transaction, not
	// a normal effect lease. No producer is installed by this optional seam.
	CaptureTransaction func(context.Context) (VideoLocalTransaction, error)
}
type VideoBusinessNonce struct {
	Nonce          string    `json:"nonce,omitempty"`
	Actor          string    `json:"actor"`
	BodyDigest     string    `json:"body_digest"`
	SessionBinding string    `json:"session_binding"`
	ExpiresAt      time.Time `json:"expires_at"`
	ConsumedAt     time.Time `json:"consumed_at"`
}
type videoBusinessLease struct {
	grant    VideoBusinessGrant
	ctx      context.Context
	now      func() time.Time
	readOnly bool
	consumed atomic.Bool
}

func (s *Service) withBusinessGrant(ctx context.Context, grant VideoBusinessGrant, readOnly bool) (*Service, error) {
	if ctx == nil || grant.Revalidate == nil || grant.Actor == "" || strings.TrimSpace(grant.Actor) != grant.Actor || grant.SessionBinding == "" || len(grant.SessionBinding) > 256 || len(grant.Nonce) < 16 || len(grant.Nonce) > 256 || len(grant.BodyDigest) != 64 {
		return nil, ErrUnauthorized
	}
	if _, err := hex.DecodeString(grant.BodyDigest); err != nil || grant.BodyDigest != strings.ToLower(grant.BodyDigest) {
		return nil, ErrUnauthorized
	}
	lease := &videoBusinessLease{grant: grant, ctx: ctx, now: s.cfg.Now, readOnly: readOnly}
	if err := lease.check(); err != nil {
		return nil, err
	}
	return &Service{cfg: s.cfg, videoServiceControls: s.videoServiceControls, store: &Store{videoStateStore: s.store.videoStateStore, business: lease}}, nil
}
func (b *videoBusinessLease) check() error {
	if b.grant.Current != nil {
		if err := b.checkCurrent(); err != nil {
			return err
		}
	}
	if err := b.ctx.Err(); err != nil {
		return err
	}
	if !b.grant.ExpiresAt.After(b.now().UTC()) {
		return ErrUnauthorized
	}
	ctx, cancel := context.WithTimeout(b.ctx, 15*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- b.grant.Revalidate(ctx) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-result:
		if err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !b.grant.ExpiresAt.After(b.now().UTC()) {
		return ErrUnauthorized
	}
	if b.grant.Current != nil {
		return b.checkCurrent()
	}
	return nil
}
func (b *videoBusinessLease) checkCurrent() error { return b.checkCurrentContext(b.ctx) }
func (b *videoBusinessLease) checkCurrentContext(ctx context.Context) error {
	if ctx == nil {
		return ErrUnauthorized
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := b.ctx.Err(); err != nil {
		return err
	}
	if !b.grant.ExpiresAt.After(b.now().UTC()) {
		return ErrUnauthorized
	}
	// Preserve existing trusted-verifier compatibility. The concrete SDK
	// consumer always supplies Current and never performs remote reads here.
	if b.grant.Current == nil {
		if b.grant.CaptureTransaction != nil {
			return ErrVideoTransactionUnavailable
		}
		return b.check()
	}
	if err := b.grant.Current(ctx); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := b.ctx.Err(); err != nil {
		return err
	}
	if !b.grant.ExpiresAt.After(b.now().UTC()) {
		return ErrUnauthorized
	}
	return nil
}
func (b *videoBusinessLease) checkState(st State) error {
	if b.now().UTC().Before(st.BusinessClockFloor) {
		return ErrUnauthorized
	}
	if n, exists := st.BusinessNonces[videoBusinessNonceKey(b.grant.SessionBinding, b.grant.Nonce)]; exists {
		if !b.consumed.Load() || n.Nonce != b.grant.Nonce || n.Actor != b.grant.Actor || n.BodyDigest != b.grant.BodyDigest || n.SessionBinding != b.grant.SessionBinding || !n.ExpiresAt.Equal(b.grant.ExpiresAt) {
			return ErrUnauthorized
		}
	} else if b.consumed.Load() {
		return ErrUnauthorized
	}
	return nil
}
func (b *videoBusinessLease) admit(st *State) error { return b.admitContext(st, b.ctx) }
func (b *videoBusinessLease) admitContext(st *State, ctx context.Context) error {
	if err := b.checkCurrentContext(ctx); err != nil {
		return err
	}
	if err := b.checkState(*st); err != nil {
		return err
	}
	now := b.now().UTC()
	if st.BusinessNonces == nil {
		st.BusinessNonces = map[string]VideoBusinessNonce{}
	}
	for nonce, n := range st.BusinessNonces {
		if nonce != videoBusinessNonceKey(b.grant.SessionBinding, b.grant.Nonce) && !n.ExpiresAt.After(now) {
			delete(st.BusinessNonces, nonce)
		}
	}
	if _, exists := st.BusinessNonces[videoBusinessNonceKey(b.grant.SessionBinding, b.grant.Nonce)]; !exists {
		if len(st.BusinessNonces) >= 4096 {
			return errors.New("Video business replay protection is full")
		}
		st.BusinessNonces[videoBusinessNonceKey(b.grant.SessionBinding, b.grant.Nonce)] = VideoBusinessNonce{Nonce: b.grant.Nonce, Actor: b.grant.Actor, BodyDigest: b.grant.BodyDigest, SessionBinding: b.grant.SessionBinding, ExpiresAt: b.grant.ExpiresAt, ConsumedAt: now}
	}
	st.BusinessClockFloor = now
	return nil
}

func validateVideoBusinessState(st State) error {
	if len(st.BusinessNonces) > 4096 {
		return ErrUnauthorized
	}
	for nonce, n := range st.BusinessNonces {
		if st.SchemaVersion >= 5 && n.Nonce == "" || !validVideoBusinessNonceKey(nonce, n) || n.Actor == "" || n.Actor != strings.TrimSpace(n.Actor) || n.SessionBinding == "" || len(n.SessionBinding) > 256 || len(n.BodyDigest) != 64 || n.BodyDigest != strings.ToLower(n.BodyDigest) || n.ConsumedAt.IsZero() || !n.ExpiresAt.After(n.ConsumedAt) || st.BusinessClockFloor.Before(n.ConsumedAt) {
			return ErrUnauthorized
		}
		if _, err := hex.DecodeString(n.BodyDigest); err != nil {
			return ErrUnauthorized
		}
	}
	return nil
}

func videoBusinessNonceKey(binding, nonce string) string {
	raw, _ := json.Marshal([2]string{binding, nonce})
	digest := sha256.Sum256(append([]byte("YNX_VIDEO_BUSINESS_NONCE_V2\n"), raw...))
	return hex.EncodeToString(digest[:])
}
func validVideoBusinessNonceKey(key string, n VideoBusinessNonce) bool {
	// Before migration, historical schema4 records retain their original shape
	// for signature verification. Schema5 records carry the original nonce and
	// index its exact session pair. No new format field enters old HMAC bytes.
	if n.Nonce == "" {
		return len(key) >= 16 && len(key) <= 256
	}
	return len(n.Nonce) >= 16 && len(n.Nonce) <= 256 && key == videoBusinessNonceKey(n.SessionBinding, n.Nonce)
}
func migrateVideoBusinessNoncePairs(st *State) error {
	if st.BusinessNonces == nil {
		return nil
	}
	pairs := make(map[string]VideoBusinessNonce, len(st.BusinessNonces))
	for old, n := range st.BusinessNonces {
		if !validVideoBusinessNonceKey(old, n) {
			return ErrUnauthorized
		}
		if n.Nonce == "" {
			n.Nonce = old
		}
		key := videoBusinessNonceKey(n.SessionBinding, n.Nonce)
		if _, exists := pairs[key]; exists {
			return errors.New("duplicate Video session nonce pair")
		}
		pairs[key] = n
	}
	st.BusinessNonces = pairs
	return nil
}
