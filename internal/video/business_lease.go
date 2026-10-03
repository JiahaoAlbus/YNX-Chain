package video

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"sync/atomic"
	"time"
)

// VideoBusinessGrant is issued only by the trusted shared verifier. This product
// transaction boundary cannot authenticate headers or create a Wallet session.
type VideoBusinessGrant struct {
	Actor, Nonce, BodyDigest, SessionBinding string
	ProductID, Scope                         string
	ExpiresAt                                time.Time
	Revalidate                               func(context.Context) error
}
type VideoBusinessNonce struct {
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
	return nil
}
func (b *videoBusinessLease) checkState(st State) error {
	if b.now().UTC().Before(st.BusinessClockFloor) {
		return ErrUnauthorized
	}
	if n, exists := st.BusinessNonces[b.grant.Nonce]; exists {
		if !b.consumed.Load() || n.Actor != b.grant.Actor || n.BodyDigest != b.grant.BodyDigest || n.SessionBinding != b.grant.SessionBinding || !n.ExpiresAt.Equal(b.grant.ExpiresAt) {
			return ErrUnauthorized
		}
	} else if b.consumed.Load() {
		return ErrUnauthorized
	}
	return nil
}
func (b *videoBusinessLease) admit(st *State) error {
	if err := b.check(); err != nil {
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
		if nonce != b.grant.Nonce && !n.ExpiresAt.After(now) {
			delete(st.BusinessNonces, nonce)
		}
	}
	if _, exists := st.BusinessNonces[b.grant.Nonce]; !exists {
		if len(st.BusinessNonces) >= 4096 {
			return errors.New("Video business replay protection is full")
		}
		st.BusinessNonces[b.grant.Nonce] = VideoBusinessNonce{Actor: b.grant.Actor, BodyDigest: b.grant.BodyDigest, SessionBinding: b.grant.SessionBinding, ExpiresAt: b.grant.ExpiresAt, ConsumedAt: now}
	}
	st.BusinessClockFloor = now
	return nil
}

func validateVideoBusinessState(st State) error {
	if len(st.BusinessNonces) > 4096 {
		return ErrUnauthorized
	}
	for nonce, n := range st.BusinessNonces {
		if len(nonce) < 16 || len(nonce) > 256 || n.Actor == "" || n.Actor != strings.TrimSpace(n.Actor) || n.SessionBinding == "" || len(n.SessionBinding) > 256 || len(n.BodyDigest) != 64 || n.BodyDigest != strings.ToLower(n.BodyDigest) || n.ConsumedAt.IsZero() || !n.ExpiresAt.After(n.ConsumedAt) || st.BusinessClockFloor.Before(n.ConsumedAt) {
			return ErrUnauthorized
		}
		if _, err := hex.DecodeString(n.BodyDigest); err != nil {
			return ErrUnauthorized
		}
	}
	return nil
}
