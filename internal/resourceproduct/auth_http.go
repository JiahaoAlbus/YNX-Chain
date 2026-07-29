package resourceproduct

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/canonicalwallet"
)

type verifiedProductSession struct {
	Actor     Actor
	Binding   string
	DeviceKey string
	Proof     string
}

type verifiedProductSessionKey struct{}

func (s *Service) productSessionProofs(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		encoded := strings.TrimSpace(r.Header.Get(canonicalwallet.ProductSessionProofHeader))
		if encoded == "" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-YNX-Product-Device-Key") != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical Product Session proof cannot be combined with legacy session headers"})
			return
		}
		proof, err := canonicalwallet.ParseProductSessionProofHeader(encoded)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var body []byte
		if r.Body != nil {
			body, err = io.ReadAll(io.LimitReader(r.Body, maxBody+1))
			if err != nil || len(body) > maxBody {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "bounded request body required for Product Session proof"})
				return
			}
			r.Body.Close()
			r.Body = io.NopCloser(strings.NewReader(string(body)))
		}
		s.mu.Lock()
		stored, ok := s.data.Sessions[proof.SessionBinding]
		s.mu.Unlock()
		if !ok || stored.Status != "active" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "canonical Wallet session is missing, revoked or unknown"})
			return
		}
		now := s.cfg.Now().UTC()
		if _, err := canonicalwallet.VerifyProductSessionProof(proof, stored.Session, r.Method, r.URL.Path, body, now); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		hash := sha256.Sum256([]byte(encoded))
		digest := hex.EncodeToString(hash[:])
		s.mu.Lock()
		for key, expiry := range s.data.SessionProofs {
			if !expiry.After(now) {
				delete(s.data.SessionProofs, key)
			}
		}
		if _, replayed := s.data.SessionProofs[digest]; replayed {
			s.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "canonical Product Session proof replay rejected"})
			return
		}
		if len(s.data.SessionProofs) >= 20000 {
			s.mu.Unlock()
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Product Session proof replay store reached its safety bound"})
			return
		}
		expires, _ := time.Parse("2006-01-02T15:04:05.000Z", proof.ExpiresAt)
		s.data.SessionProofs[digest] = expires
		if err := s.saveLocked(); err != nil {
			delete(s.data.SessionProofs, digest)
			s.mu.Unlock()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Product Session proof replay state persistence failed"})
			return
		}
		s.mu.Unlock()
		auth := verifiedProductSession{Actor: Actor{ID: stored.Account, Role: "user"}, Binding: proof.SessionBinding, DeviceKey: proof.ProductDeviceKey, Proof: encoded}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), verifiedProductSessionKey{}, auth)))
	})
}

func productSessionFrom(r *http.Request) (verifiedProductSession, bool) {
	v, ok := r.Context().Value(verifiedProductSessionKey{}).(verifiedProductSession)
	return v, ok
}

func requireProductSession(r *http.Request) (verifiedProductSession, error) {
	if auth, ok := productSessionFrom(r); ok {
		return auth, nil
	}
	return verifiedProductSession{}, apiError{401, "replay-resistant canonical Product Session proof required"}
}
