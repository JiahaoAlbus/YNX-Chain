package commerce

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// Only the existing checksum-valid codec may establish representation aliases.
// Historical deletion digests cannot reveal which representation was used;
// check both without rewriting records or retaining additional identities.
func businessActorAliases(actor string) []string {
	canonical, err := accountaddress.Normalize(actor)
	if err != nil {
		return []string{actor}
	}
	native, err := accountaddress.Encode(canonical)
	if err != nil {
		return []string{actor}
	}
	return []string{canonical, native}
}

func sameBusinessAccount(a, b string) bool {
	if a == b {
		return true
	}
	left, err := accountaddress.Normalize(a)
	if err != nil {
		return false
	}
	right, err := accountaddress.Normalize(b)
	return err == nil && left == right
}

// Resolve only a cryptographically verified Wallet account using the existing
// checked address codec. Never rewrite signed proof/session fields. This runs
// on the transaction's staged Store, so the namespace decision and nonce commit
// together. A one-way account digest and representation flag survive deletion;
// changing namespaces must not bypass retired request keys.
func (s *Store) resolveBusinessActor(walletAccount string) (string, error) {
	canonical, err := accountaddress.Normalize(walletAccount)
	if err != nil {
		return "", ErrUnauthorized
	}
	native, err := accountaddress.Encode(canonical)
	if err != nil || native != walletAccount {
		return "", ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sum := sha256.Sum256([]byte("YNX_COMMERCE_ACCOUNT_NAMESPACE_V2\n" + canonical))
	digest := hex.EncodeToString(sum[:])
	if s.s.BusinessActorNamespaces == nil {
		s.s.BusinessActorNamespaces = map[string]string{}
	}

	has := func(actor string) bool {
		for _, v := range s.s.BusinessEffects {
			if v.Actor == actor {
				return true
			}
		}
		if _, ok := s.s.BuyerProfiles[actor]; ok {
			return true
		}
		if _, ok := s.s.Carts[actor]; ok {
			return true
		}
		for _, v := range s.s.Stores {
			if v.Owner == actor {
				return true
			}
		}
		for _, v := range s.s.Orders {
			if v.Buyer == actor {
				return true
			}
		}
		for _, v := range s.s.AIJobs {
			if v.Actor == actor {
				return true
			}
		}
		for _, v := range s.s.Idempotency {
			if v.Actor == actor {
				return true
			}
		}
		for _, roles := range s.s.SellerRoles {
			if _, ok := roles[actor]; ok {
				return true
			}
		}
		for _, v := range s.s.SellerInvitations {
			if v.Account == actor || v.CreatedBy == actor {
				return true
			}
		}
		for _, v := range s.s.SellerRevocations {
			if v.Account == actor {
				return true
			}
		}
		for _, v := range s.s.SellerEvents {
			if v.Account == actor || v.Actor == actor {
				return true
			}
		}
		for _, v := range s.s.Audits {
			if v.Actor == actor {
				return true
			}
		}
		return false
	}
	old, current := has(native), has(canonical)
	if old && current {
		return "", fmt.Errorf("%w: both account namespaces contain records; explicit reconciliation required", ErrConflict)
	}
	if namespace, ok := s.s.BusinessActorNamespaces[digest]; ok {
		if namespace == "native" {
			if current {
				return "", ErrConflict
			}
			return native, nil
		}
		if namespace == "canonical" {
			if old {
				return "", ErrConflict
			}
			return canonical, nil
		}
		return "", ErrConflict
	}
	if old {
		s.s.BusinessActorNamespaces[digest] = "native"
		return native, nil
	}
	s.s.BusinessActorNamespaces[digest] = "canonical"
	return canonical, nil
}
