package commerce

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"time"
)

// These fields must come from the shared v2 verifier's ActionAuthorization,
// never from client JSON. This transaction does not verify signatures or grant
// roles. The router must first authenticate the original session, actual wire
// bytes, route-fixed scopes and current actor/account/device generation.
type businessActionAuthorization struct {
	SessionBinding, Nonce string
	ExpiresAt             time.Time
}

var businessProofToken = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)

func businessNonceDigest(binding, nonce string) string {
	sum := sha256.Sum256([]byte("YNX_COMMERCE_BUSINESS_NONCE_V2\n" + binding + "\n" + nonce))
	return hex.EncodeToString(sum[:])
}

// withBusinessAction serializes a local business operation with nonce admission
// and a single durable snapshot commit. Work uses an isolated, in-memory Store;
// its existing methods retain their own permission, inventory and idempotency
// checks. Neither work nor fence may perform external I/O or call the original
// Store. External provider operations require their own durable intent path.
// fence checks the original actor generation again immediately before publish.
// No result may be sent to the caller until this method returns successfully.
func (s *Store) withBusinessAction(ctx context.Context, proof businessActionAuthorization, fence func() error, work func(*Store) error) error {
	if ctx == nil || fence == nil || work == nil || !businessProofToken.MatchString(proof.SessionBinding) || !businessProofToken.MatchString(proof.Nonce) {
		return fmt.Errorf("%w: invalid verified business transaction", ErrUnauthorized)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	valid := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !proof.ExpiresAt.After(s.now()) {
			return fmt.Errorf("%w: business proof expired before commit", ErrUnauthorized)
		}
		return fence()
	}
	if err := valid(); err != nil {
		return err
	}
	digest := businessNonceDigest(proof.SessionBinding, proof.Nonce)
	if _, exists := s.s.BusinessNonces[digest]; exists {
		return fmt.Errorf("%w: business proof already consumed", ErrConflict)
	}
	copy, err := cloneSnapshot(s.s)
	if err != nil {
		return err
	}
	staged := &Store{s: copy, now: s.now}
	if err := work(staged); err != nil {
		return err
	}
	if err := valid(); err != nil {
		return err
	}
	// Detach even from a callback that retained its temporary Store/results.
	next, err := cloneSnapshot(staged.s)
	if err != nil {
		return err
	}
	if err := valid(); err != nil {
		return err
	}
	if next.BusinessNonces == nil {
		next.BusinessNonces = map[string]struct{}{}
	}
	next.BusinessNonces[digest] = struct{}{}
	before := s.s
	s.s = next
	if err := s.persistLocked(); err != nil {
		s.s = before
		return err
	}
	return nil
}
