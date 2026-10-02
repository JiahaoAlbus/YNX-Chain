package social

import (
	"encoding/base64"
	"net/url"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const socialLocatorPrefix = "https://social.ynxweb4.com/people/"

// This is a public discovery identifier, not encryption-key or migration proof.
// The native account remains only the private binding and original relation key.
func (s *Service) publicIdentity(account string) (string, error) {
	normalized, err := nativewallet.NormalizeNativeAddress(account)
	if err != nil || normalized != account {
		return "", ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if id := s.state.PublicIdentities[account]; id != "" {
		return id, nil
	}
	id := "sp_" + base64.RawURLEncoding.EncodeToString(randomBytes(24))
	for _, existing := range s.state.PublicIdentities {
		if existing == id {
			return "", ErrConflict
		}
	}
	before := cloneState(s.state)
	s.state.PublicIdentities[account] = id
	if err := s.saveOrRollbackLocked(before); err != nil {
		return "", err
	}
	return id, nil
}

func (s *Service) expectedIdentityMatches(account, expected string) bool {
	// Explicit legacy confirmation remains account-bound; never remap old keys.
	if expected == account {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return expected != "" && s.state.PublicIdentities[account] == expected
}

func (s *Service) resolveProfileLocator(value string) (string, error) {
	if strings.HasPrefix(value, "ynxsocial://profile/") {
		return "", ErrConflict
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Host != "social.ynxweb4.com" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.EscapedPath() != u.Path || !strings.HasPrefix(u.Path, "/people/") {
		return "", ErrInvalid
	}
	id := strings.TrimPrefix(u.Path, "/people/")
	if !strings.HasPrefix(id, "sp_") {
		return "", ErrInvalid
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(id, "sp_"))
	if err != nil || len(decoded) != 24 || "sp_"+base64.RawURLEncoding.EncodeToString(decoded) != id {
		return "", ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for account, candidate := range s.state.PublicIdentities {
		if candidate == id {
			return account, nil
		}
	}
	return "", ErrNotFound
}
