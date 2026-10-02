package social

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

var matrixAudienceFeedCursor = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Indexes carry no plaintext, file keys or new identity aliases. Sender is the
// existing directory mapping, not a user-supplied/derived MXID.
type matrixAudienceFeedIndex struct {
	RestrictedMomentIndex
	Sender string `json:"sender"`
}
type matrixAudienceFeed struct {
	Indexes []matrixAudienceFeedIndex `json:"indexes"`
	After   string                    `json:"after,omitempty"`
}

func (s *Service) readMatrixAudienceIndexes(ctx context.Context, actor, after string, fresh func() error) (matrixAudienceFeed, error) {
	result := matrixAudienceFeed{Indexes: []matrixAudienceFeedIndex{}}
	s.mu.Lock()
	keys := make([]string, 0, len(s.state.RestrictedMomentIndexes))
	for key := range s.state.RestrictedMomentIndexes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	s.mu.Unlock()
	selectedKeys := []string{}
	for _, key := range keys {
		if key <= after {
			continue
		}
		if err := ctx.Err(); err != nil {
			return result, err
		}
		s.mu.Lock()
		index, exists := s.state.RestrictedMomentIndexes[key]
		index.Members = append([]string(nil), index.Members...)
		binding, err := s.matrixAudienceBindingLocked(actor, matrixAudienceAuthorize{Action: "read", TransactionID: index.TransactionID, Expected: index.MatrixAudienceMetadata})
		if !exists || err != nil {
			s.mu.Unlock()
			continue
		}
		if index.ParentEventID == "" && index.Actor != binding.Actor {
			s.mu.Unlock()
			continue
		}
		sender, err := s.cfg.MatrixDirectory.Resolve(index.Actor)
		s.mu.Unlock()
		if err != nil {
			return result, err
		}
		if err := fresh(); err != nil {
			return result, err
		}
		observation, err := s.cfg.MatrixAudienceAuthority.ConfirmAudience(ctx, index.MatrixAudienceMetadata, index.RoomID)
		if err != nil {
			return result, err
		}
		confirmed, err := observedAudience(index.MatrixAudienceMetadata, observation)
		if err != nil || !sameAudience(confirmed, index.MatrixAudienceMetadata) {
			return result, ErrConflict
		}
		if err := fresh(); err != nil {
			return result, err
		}
		// A relationship may have changed during room observation. Check before
		// touching private event metadata, not only before returning the index.
		s.mu.Lock()
		_, err = s.matrixAudienceBindingLocked(actor, matrixAudienceAuthorize{Action: "read", TransactionID: index.TransactionID, Expected: index.MatrixAudienceMetadata})
		s.mu.Unlock()
		if err != nil {
			return result, err
		}
		event, err := s.cfg.MatrixAudienceAuthority.ObserveEvent(ctx, index.RoomID, index.EventID)
		if err != nil {
			return result, err
		}
		if event.RoomID != index.RoomID || event.EventID != index.EventID || event.TransactionID != index.TransactionID || event.Type != "m.room.encrypted" || event.Sender != sender.UserID {
			return result, ErrConflict
		}
		if err := fresh(); err != nil {
			return result, err
		}
		result.Indexes = append(result.Indexes, matrixAudienceFeedIndex{index, sender.UserID})
		selectedKeys = append(selectedKeys, key)
		if len(result.Indexes) == 40 {
			result.After = key
			break
		}
	}
	if err := fresh(); err != nil {
		return result, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if s.stateWriteError != nil {
		return result, s.stateWriteError
	}
	for i, key := range selectedKeys {
		index := result.Indexes[i].RestrictedMomentIndex
		if objectDigest(s.state.RestrictedMomentIndexes[key]) != objectDigest(index) {
			return result, ErrConflict
		}
		if _, err := s.matrixAudienceBindingLocked(actor, matrixAudienceAuthorize{Action: "read", TransactionID: index.TransactionID, Expected: index.MatrixAudienceMetadata}); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s *Server) matrixAudienceIndexes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, 405, "method not allowed")
		return
	}
	query := r.URL.Query()
	after := query.Get("after")
	if len(query) > 1 || len(query["after"]) > 1 || len(query) == 1 && (after == "" || !matrixAudienceFeedCursor.MatchString(after)) {
		writeServiceError(w, ErrInvalid)
		return
	}
	if !s.service.Allow(r.RemoteAddr, "anonymous", "matrix-audience-indexes") {
		writeServiceError(w, ErrRateLimited)
		return
	}
	scopes := []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}
	session, err := s.liveProductSession(r, scopes)
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	for _, scope := range scopes {
		if !contains(session.Scopes, scope) {
			writeServiceError(w, ErrUnauthorized)
			return
		}
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil || !expires.After(s.service.cfg.Now()) || !matrixAccount.MatchString(session.Account) {
		writeServiceError(w, ErrUnauthorized)
		return
	}
	_, generation, err := s.browserProductBinding(r, session, nil)
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	if s.service.cfg.MatrixAudienceAuthority == nil || s.service.cfg.MatrixAudienceSessionRevalidator == nil {
		writeError(w, 503, "Live private audience reader is not configured")
		return
	}
	originalJSON, err := json.Marshal(session)
	if err != nil {
		writeServiceError(w, ErrUnauthorized)
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), minAudienceDeadline(expires))
	defer cancel()
	fresh := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		_, currentGeneration, err := s.browserProductBinding(r.WithContext(ctx), session, nil)
		if err != nil {
			return err
		}
		if generation != currentGeneration {
			return ErrUnauthorized
		}
		var original, frozen productsessionv2.Session
		if json.Unmarshal(originalJSON, &original) != nil || json.Unmarshal(originalJSON, &frozen) != nil {
			return ErrUnauthorized
		}
		current, err := s.service.cfg.MatrixAudienceSessionRevalidator.Revalidate(ctx, original, append([]string(nil), scopes...))
		if err != nil {
			return err
		}
		if objectDigest(current) != objectDigest(frozen) {
			return &productsessionv2.Error{Status: 403, Code: "SESSION_BINDING_MISMATCH"}
		}
		_, afterReaderGeneration, err := s.browserProductBinding(r.WithContext(ctx), session, nil)
		if err != nil {
			return err
		}
		if generation != afterReaderGeneration {
			return ErrUnauthorized
		}
		if !expires.After(s.service.cfg.Now()) {
			return ErrUnauthorized
		}
		return nil
	}
	if err := fresh(); err != nil {
		writeBridgeError(w, err)
		return
	}
	feed, err := s.service.readMatrixAudienceIndexes(ctx, session.Account, after, fresh)
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, feed)
}
