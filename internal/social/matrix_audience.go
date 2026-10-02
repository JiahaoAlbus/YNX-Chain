package social

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sort"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const MatrixAudienceProtocol = "ynx-social-matrix-moment/v1"

// The shared owner supplies a real HTTP action-proof verifier bound to the
// same live session/device, route, method, exact body and finite scope set.
// An introspection proof alone does not implement this interface's contract.
type MatrixAudienceActionVerifier interface {
	VerifyHTTPAction(context.Context, *http.Request, productsessionv2.Session, []byte, []string) (MatrixAudienceActionReceipt, error)
}

// Operator integration must observe the real encrypted room and current joined
// membership. A client-supplied boolean/room/member list is never this authority.
type MatrixAudienceAuthority interface {
	ConfirmAudience(context.Context, MatrixAudienceMetadata, string) (MatrixAudienceObservation, error)
	ObserveEvent(context.Context, string, string) (MatrixAudienceEvent, error)
}
type MatrixAudienceObservation struct {
	RoomID            string
	Members           []string
	Algorithm         string
	HistoryVisibility string
}
type MatrixAudienceEvent struct {
	RoomID        string
	EventID       string
	Sender        string
	Type          string
	TransactionID string
}
type MatrixAudienceSelection struct {
	Kind     string   `json:"kind"`
	Selected []string `json:"selected,omitempty"`
	GroupID  string   `json:"groupId,omitempty"`
}
type MatrixAudienceMetadata struct {
	Protocol string   `json:"protocol"`
	Kind     string   `json:"kind"`
	Revision string   `json:"revision"`
	Owner    string   `json:"owner"`
	RoomID   string   `json:"roomId"`
	Members  []string `json:"members"`
}
type matrixAudienceBinding struct {
	Actor     string                  `json:"actor"`
	Selection MatrixAudienceSelection `json:"selection"`
	Metadata  MatrixAudienceMetadata  `json:"metadata"`
}
type RestrictedMomentIndex struct {
	MatrixAudienceMetadata
	Actor         string `json:"actor"`
	EventID       string `json:"eventId"`
	TransactionID string `json:"transactionId"`
	ParentEventID string `json:"parentEventId,omitempty"`
}
type matrixAudienceAuthorize struct {
	Action        string                 `json:"action"`
	TransactionID string                 `json:"transactionId"`
	Expected      MatrixAudienceMetadata `json:"expected"`
	EventID       string                 `json:"eventId,omitempty"`
	ParentEventID string                 `json:"parentEventId,omitempty"`
}

var matrixAudienceTransaction = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
var matrixAudienceEventID = regexp.MustCompile(`^\$[^\s\x00-\x1f]{1,254}$`)
var matrixAudienceRoomID = regexp.MustCompile(`^![^\s\x00-\x1f]{1,254}$`)

func audiencePolicyDigest(state persistentState) string {
	return objectDigest(struct {
		Contacts   map[string]Contact
		Blocks     map[string]time.Time
		Groups     map[string]GroupConversation
		Identities map[string]string
	}{state.Contacts, state.Blocks, state.Groups, state.PublicIdentities})
}

// Called under the existing Social mutex; no second relationship store.
func (s *Service) matrixAudiencePlanLocked(actor string, in MatrixAudienceSelection) (MatrixAudienceMetadata, error) {
	empty := MatrixAudienceMetadata{}
	if !matrixAccount.MatchString(actor) || len(in.Selected) > 255 || len(in.GroupID) > 256 {
		return empty, ErrInvalid
	}
	accounts := []string{actor}
	switch in.Kind {
	case "private":
		if len(in.Selected) != 0 || in.GroupID != "" {
			return empty, ErrInvalid
		}
	case "contacts":
		if len(in.Selected) != 0 || in.GroupID != "" {
			return empty, ErrInvalid
		}
		for _, contact := range s.state.Contacts {
			peer := ""
			if contact.Left == actor {
				peer = contact.Right
			}
			if contact.Right == actor {
				peer = contact.Left
			}
			if peer != "" && !s.blockedLocked(actor, peer) {
				accounts = append(accounts, peer)
			}
		}
	case "selected":
		if len(in.Selected) == 0 || in.GroupID != "" {
			return empty, ErrInvalid
		}
		for _, id := range in.Selected {
			if !regexp.MustCompile(`^sp_[A-Za-z0-9_-]{32}$`).MatchString(id) {
				return empty, ErrInvalid
			}
			peer := ""
			for account, publicID := range s.state.PublicIdentities {
				if publicID == id {
					peer = account
					break
				}
			}
			if peer == "" || peer == actor || !s.contactLocked(actor, peer) || s.blockedLocked(actor, peer) {
				return empty, ErrUnauthorized
			}
			accounts = append(accounts, peer)
		}
	case "group":
		if len(in.Selected) != 0 || in.GroupID == "" {
			return empty, ErrInvalid
		}
		group, ok := s.state.Groups[in.GroupID]
		if !ok || group.CreatedBy != actor || !contains(group.Members, actor) {
			return empty, ErrUnauthorized
		}
		accounts = append([]string(nil), group.Members...)
	default:
		return empty, ErrInvalid
	}
	if len(accounts) > 256 {
		return empty, ErrInvalid
	}
	sort.Strings(accounts)
	users := make([]string, 0, len(accounts))
	owner := ""
	for i, account := range accounts {
		if i > 0 && accounts[i-1] == account {
			return empty, ErrInvalid
		}
		for _, other := range accounts[:i] {
			if s.blockedLocked(account, other) {
				return empty, ErrUnauthorized
			}
		}
		mapping, err := s.cfg.MatrixDirectory.Resolve(account)
		if err != nil {
			return empty, err
		}
		if account == actor {
			owner = mapping.UserID
		}
		users = append(users, mapping.UserID)
	}
	sort.Strings(users)
	revision := objectDigest(struct {
		Epoch     uint64
		Policy    string
		Selection MatrixAudienceSelection
		Members   []string
	}{s.state.AudiencePolicyRevision, audiencePolicyDigest(s.state), in, users})
	return MatrixAudienceMetadata{MatrixAudienceProtocol, in.Kind, revision, owner, "", users}, nil
}

func sameAudience(a, b MatrixAudienceMetadata) bool { return objectDigest(a) == objectDigest(b) }
func observedAudience(expected MatrixAudienceMetadata, observed MatrixAudienceObservation) (MatrixAudienceMetadata, error) {
	members := append([]string(nil), observed.Members...)
	sort.Strings(members)
	if !matrixAudienceRoomID.MatchString(observed.RoomID) || observed.Algorithm != "m.megolm.v1.aes-sha2" || observed.HistoryVisibility != "joined" || objectDigest(members) != objectDigest(expected.Members) {
		return MatrixAudienceMetadata{}, ErrConflict
	}
	expected.RoomID = observed.RoomID
	return expected, nil
}

func (s *Service) ResolveMatrixAudience(ctx context.Context, actor string, in MatrixAudienceSelection) (MatrixAudienceMetadata, error) {
	return s.resolveMatrixAudience(ctx, actor, in, nil)
}
func (s *Service) resolveMatrixAudience(ctx context.Context, actor string, in MatrixAudienceSelection, receipt *MatrixAudienceActionReceipt) (MatrixAudienceMetadata, error) {
	if err := s.writeAvailability(); err != nil {
		return MatrixAudienceMetadata{}, err
	}
	if s.cfg.MatrixAudienceAuthority == nil {
		return MatrixAudienceMetadata{}, ErrConflict
	}
	in.Selected = append([]string(nil), in.Selected...)
	sort.Strings(in.Selected)
	s.mu.Lock()
	plan, err := s.matrixAudiencePlanLocked(actor, in)
	key := objectDigest(struct {
		Actor     string
		Selection MatrixAudienceSelection
	}{actor, in})
	prior := s.state.MatrixAudiences[key]
	if err == nil && receipt != nil {
		err = s.prepareMatrixAudienceActionLocked(actor, "resolve", key, plan, receipt, &in, "", "")
	}
	s.mu.Unlock()
	if err != nil {
		return MatrixAudienceMetadata{}, err
	}
	room := ""
	if prior.Metadata.Revision == plan.Revision {
		room = prior.Metadata.RoomID
	}
	observed, err := s.cfg.MatrixAudienceAuthority.ConfirmAudience(ctx, plan, room)
	if err != nil {
		return MatrixAudienceMetadata{}, err
	}
	if err := revalidateAudienceReceipt(ctx, receipt); err != nil {
		return MatrixAudienceMetadata{}, err
	}
	bound, err := observedAudience(plan, observed)
	if err != nil {
		return MatrixAudienceMetadata{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return MatrixAudienceMetadata{}, err
	}
	if s.stateWriteError != nil {
		return MatrixAudienceMetadata{}, s.stateWriteError
	}
	current, err := s.matrixAudiencePlanLocked(actor, in)
	if err != nil {
		return MatrixAudienceMetadata{}, err
	}
	if !sameAudience(plan, current) {
		return MatrixAudienceMetadata{}, ErrConflict
	}
	if live, exists := s.state.MatrixAudiences[key]; exists && live.Metadata.Revision == bound.Revision {
		if !sameAudience(live.Metadata, bound) {
			return MatrixAudienceMetadata{}, ErrConflict
		}
		if receipt != nil {
			before := cloneState(s.state)
			if err := s.completeMatrixAudienceActionLocked(bound, receipt); err != nil {
				return MatrixAudienceMetadata{}, err
			}
			if err := s.saveOrRollbackLocked(before); err != nil {
				return MatrixAudienceMetadata{}, err
			}
		}
		return live.Metadata, nil
	}
	before := cloneState(s.state)
	if receipt != nil {
		if err := s.completeMatrixAudienceActionLocked(bound, receipt); err != nil {
			return MatrixAudienceMetadata{}, err
		}
	}
	if s.state.MatrixAudiences == nil {
		s.state.MatrixAudiences = map[string]matrixAudienceBinding{}
	}
	s.state.MatrixAudiences[key] = matrixAudienceBinding{actor, in, bound}
	if err := s.saveOrRollbackLocked(before); err != nil {
		return MatrixAudienceMetadata{}, err
	}
	return bound, nil
}

func (s *Service) matrixAudienceBindingLocked(actor string, in matrixAudienceAuthorize) (matrixAudienceBinding, error) {
	if !matrixAudienceTransaction.MatchString(in.TransactionID) {
		return matrixAudienceBinding{}, ErrInvalid
	}
	if in.Action == "index" && !matrixAudienceEventID.MatchString(in.EventID) {
		return matrixAudienceBinding{}, ErrInvalid
	}
	switch in.Action {
	case "publish", "comment", "media-prepare", "index", "read":
	default:
		return matrixAudienceBinding{}, ErrInvalid
	}
	for _, binding := range s.state.MatrixAudiences {
		if !sameAudience(binding.Metadata, in.Expected) {
			continue
		}
		current, err := s.matrixAudiencePlanLocked(binding.Actor, binding.Selection)
		if err != nil {
			return matrixAudienceBinding{}, err
		}
		current.RoomID = binding.Metadata.RoomID
		if !sameAudience(current, binding.Metadata) {
			return matrixAudienceBinding{}, ErrConflict
		}
		identity, err := s.cfg.MatrixDirectory.Resolve(actor)
		if err != nil || !contains(current.Members, identity.UserID) {
			return matrixAudienceBinding{}, ErrUnauthorized
		}
		if (in.Action == "publish" || (in.Action == "index" && in.ParentEventID == "")) && actor != binding.Actor {
			return matrixAudienceBinding{}, ErrUnauthorized
		}
		if in.Action == "comment" || in.ParentEventID != "" {
			valid := false
			for _, index := range s.state.RestrictedMomentIndexes {
				if index.EventID == in.ParentEventID && index.ParentEventID == "" && sameAudience(index.MatrixAudienceMetadata, current) {
					valid = true
					break
				}
			}
			if !valid {
				return matrixAudienceBinding{}, ErrUnauthorized
			}
		}
		return binding, nil
	}
	return matrixAudienceBinding{}, ErrConflict
}

func (s *Service) AuthorizeMatrixAudience(ctx context.Context, actor string, in matrixAudienceAuthorize) (MatrixAudienceMetadata, error) {
	return s.authorizeMatrixAudience(ctx, actor, in, nil)
}
func (s *Service) authorizeMatrixAudience(ctx context.Context, actor string, in matrixAudienceAuthorize, receipt *MatrixAudienceActionReceipt) (MatrixAudienceMetadata, error) {
	if err := s.writeAvailability(); err != nil {
		return MatrixAudienceMetadata{}, err
	}
	if s.cfg.MatrixAudienceAuthority == nil {
		return MatrixAudienceMetadata{}, ErrConflict
	}
	s.mu.Lock()
	binding, err := s.matrixAudienceBindingLocked(actor, in)
	if err == nil && receipt != nil {
		err = s.prepareMatrixAudienceActionLocked(actor, in.Action, in.TransactionID, binding.Metadata, receipt, nil, in.EventID, in.ParentEventID)
	}
	s.mu.Unlock()
	if err != nil {
		return MatrixAudienceMetadata{}, err
	}
	observed, err := s.cfg.MatrixAudienceAuthority.ConfirmAudience(ctx, binding.Metadata, binding.Metadata.RoomID)
	if err != nil {
		return MatrixAudienceMetadata{}, err
	}
	confirmed, err := observedAudience(binding.Metadata, observed)
	if err != nil || !sameAudience(confirmed, binding.Metadata) {
		return MatrixAudienceMetadata{}, ErrConflict
	}
	if err := revalidateAudienceReceipt(ctx, receipt); err != nil {
		return MatrixAudienceMetadata{}, err
	}
	// ConfirmAudience may await remote work. Recheck the original relation and
	// actor role before any private event read, not only before persisting it.
	s.mu.Lock()
	latestBeforeRead, policyErr := s.matrixAudienceBindingLocked(actor, in)
	if policyErr == nil && !sameAudience(latestBeforeRead.Metadata, confirmed) {
		policyErr = ErrConflict
	}
	if s.stateWriteError != nil {
		policyErr = s.stateWriteError
	}
	s.mu.Unlock()
	if policyErr != nil {
		return MatrixAudienceMetadata{}, policyErr
	}
	if in.Action == "index" {
		if !matrixAudienceEventID.MatchString(in.EventID) {
			return MatrixAudienceMetadata{}, ErrInvalid
		}
		event, err := s.cfg.MatrixAudienceAuthority.ObserveEvent(ctx, confirmed.RoomID, in.EventID)
		if err != nil {
			return MatrixAudienceMetadata{}, err
		}
		identity, err := s.cfg.MatrixDirectory.Resolve(actor)
		if err != nil || event.RoomID != confirmed.RoomID || event.EventID != in.EventID || event.Sender != identity.UserID || event.Type != "m.room.encrypted" || event.TransactionID != in.TransactionID {
			return MatrixAudienceMetadata{}, ErrConflict
		}
		if err := revalidateAudienceReceipt(ctx, receipt); err != nil {
			return MatrixAudienceMetadata{}, err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return MatrixAudienceMetadata{}, err
	}
	if s.stateWriteError != nil {
		return MatrixAudienceMetadata{}, s.stateWriteError
	}
	latest, err := s.matrixAudienceBindingLocked(actor, in)
	if err != nil {
		return MatrixAudienceMetadata{}, err
	}
	if !sameAudience(latest.Metadata, confirmed) {
		return MatrixAudienceMetadata{}, ErrConflict
	}
	if in.Action == "index" {
		if actor != binding.Actor && in.ParentEventID == "" {
			return MatrixAudienceMetadata{}, ErrUnauthorized
		}
		index := RestrictedMomentIndex{confirmed, actor, in.EventID, in.TransactionID, in.ParentEventID}
		key := objectDigest([]string{actor, in.TransactionID})
		if old, ok := s.state.RestrictedMomentIndexes[key]; ok {
			if objectDigest(old) != objectDigest(index) {
				return MatrixAudienceMetadata{}, ErrConflict
			}
			if receipt != nil {
				before := cloneState(s.state)
				if err := s.completeMatrixAudienceActionLocked(confirmed, receipt); err != nil {
					return MatrixAudienceMetadata{}, err
				}
				if err := s.saveOrRollbackLocked(before); err != nil {
					return MatrixAudienceMetadata{}, err
				}
			}
			return confirmed, nil
		}
		before := cloneState(s.state)
		if receipt != nil {
			if err := s.completeMatrixAudienceActionLocked(confirmed, receipt); err != nil {
				return MatrixAudienceMetadata{}, err
			}
		}
		if s.state.RestrictedMomentIndexes == nil {
			s.state.RestrictedMomentIndexes = map[string]RestrictedMomentIndex{}
		}
		s.state.RestrictedMomentIndexes[key] = index
		if err := s.saveOrRollbackLocked(before); err != nil {
			return MatrixAudienceMetadata{}, err
		}
	}
	if in.Action != "index" && receipt != nil {
		before := cloneState(s.state)
		if err := s.completeMatrixAudienceActionLocked(confirmed, receipt); err != nil {
			return MatrixAudienceMetadata{}, err
		}
		if err := s.saveOrRollbackLocked(before); err != nil {
			return MatrixAudienceMetadata{}, err
		}
	}
	return confirmed, nil
}

// Decode once, reject duplicate/unknown fields, retain exact bytes for proof.
func strictAudienceJSON(decoder *json.Decoder, depth int) bool {
	if depth > 8 {
		return false
	}
	token, err := decoder.Token()
	if err != nil {
		return false
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return true
	}
	switch delimiter {
	case '{':
		seen := map[string]bool{}
		for decoder.More() {
			key, err := decoder.Token()
			name, ok := key.(string)
			if err != nil || !ok || seen[name] {
				return false
			}
			seen[name] = true
			if !strictAudienceJSON(decoder, depth+1) {
				return false
			}
		}
		end, err := decoder.Token()
		return err == nil && end == json.Delim('}')
	case '[':
		count := 0
		for decoder.More() {
			count++
			if count > 512 || !strictAudienceJSON(decoder, depth+1) {
				return false
			}
		}
		end, err := decoder.Token()
		return err == nil && end == json.Delim(']')
	default:
		return false
	}
}
func decodeAudienceBody(raw []byte, out any) bool {
	if !utf8.Valid(raw) || len(raw) > 16384 {
		return false
	}
	tokens := json.NewDecoder(bytes.NewReader(raw))
	if !strictAudienceJSON(tokens, 0) || tokens.Decode(new(any)) != io.EOF {
		return false
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	return strict.Decode(out) == nil && strict.Decode(new(any)) == io.EOF
}
func (s *Server) matrixAudience(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, 405, "method not allowed")
		return
	}
	if r.URL.RawQuery != "" {
		writeServiceError(w, ErrInvalid)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16384))
	if err != nil {
		writeServiceError(w, ErrInvalid)
		return
	}
	resolve := r.URL.Path == "/social/v3/matrix/audience/resolve"
	var selection MatrixAudienceSelection
	var authorization matrixAudienceAuthorize
	if resolve {
		if !decodeAudienceBody(raw, &selection) {
			writeServiceError(w, ErrInvalid)
			return
		}
	} else if !decodeAudienceBody(raw, &authorization) {
		writeServiceError(w, ErrInvalid)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	if !s.service.Allow(r.RemoteAddr, "anonymous", "matrix-audience") {
		writeServiceError(w, ErrRateLimited)
		return
	}
	scopes := []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}
	session, err := s.liveProductSession(r, scopes)
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil || !expires.After(s.service.cfg.Now()) || !matrixAccount.MatchString(session.Account) {
		writeServiceError(w, ErrUnauthorized)
		return
	}
	for _, scope := range scopes {
		if !contains(session.Scopes, scope) {
			writeServiceError(w, ErrUnauthorized)
			return
		}
	}
	_, browserGeneration, bindingErr := s.browserProductBinding(r, session, nil)
	if err := bindingErr; err != nil {
		writeBridgeError(w, err)
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), minAudienceDeadline(expires))
	defer cancel()
	if s.service.cfg.MatrixAudienceActionVerifier == nil {
		writeError(w, http.StatusServiceUnavailable, "Business HTTP action proof verification is not configured; introspection proof does not authorize this body")
		return
	}
	actionHeaders := r.Header.Values("X-YNX-Product-Session-Action-Proof-V2")
	if len(actionHeaders) != 1 || actionHeaders[0] == "" || len(actionHeaders[0]) > 16384 {
		writeServiceError(w, ErrUnauthorized)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	receipt, verifyErr := s.service.cfg.MatrixAudienceActionVerifier.VerifyHTTPAction(ctx, r, session, raw, scopes)
	if err := verifyErr; err != nil {
		writeBridgeError(w, err)
		return
	}
	if receipt.BodyDigest != bridgeDigest(string(raw)) || receipt.SessionBinding == "" || receipt.SessionBinding != session.SessionBinding || receipt.ExpiresAt.After(expires) {
		writeServiceError(w, ErrUnauthorized)
		return
	}
	receipt.BrowserBinding = browserGeneration
	// Recheck the real browser authority after each remote await. Do not replay
	// the consumed introspection proof as a substitute for session liveness.
	receipt.revalidate = func(checkCtx context.Context) error {
		if !expires.After(s.service.cfg.Now()) || !receipt.ExpiresAt.After(s.service.cfg.Now()) {
			return ErrUnauthorized
		}
		_, generation, err := s.browserProductBinding(r.WithContext(checkCtx), session, nil)
		if err != nil {
			return err
		}
		if generation != browserGeneration {
			return ErrUnauthorized
		}
		return nil
	}
	ctx, actionCancel := context.WithDeadline(ctx, receipt.ExpiresAt)
	defer actionCancel()
	if s.service.cfg.MatrixAudienceAuthority == nil {
		writeError(w, http.StatusServiceUnavailable, "Encrypted Matrix audience authority is not configured")
		return
	}
	var metadata MatrixAudienceMetadata
	if resolve {
		metadata, err = s.service.resolveMatrixAudience(ctx, session.Account, selection, &receipt)
	} else {
		metadata, err = s.service.authorizeMatrixAudience(ctx, session.Account, authorization, &receipt)
	}
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 200, metadata)
}

func minAudienceDeadline(expires time.Time) time.Time {
	deadline := time.Now().Add(15 * time.Second)
	if expires.Before(deadline) {
		return expires
	}
	return deadline
}

// Receipt metadata only: no new signing domain or crypto implementation.
type MatrixAudienceActionReceipt struct {
	Nonce          string
	BodyDigest     string
	SessionBinding string
	ExpiresAt      time.Time
	BrowserBinding string
	// Request-local authority check; never serialized into the durable ledger.
	revalidate func(context.Context) error
}

func revalidateAudienceReceipt(ctx context.Context, receipt *MatrixAudienceActionReceipt) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if receipt != nil && receipt.revalidate != nil {
		return receipt.revalidate(ctx)
	}
	return nil
}

type matrixAudienceNonce struct {
	Selection      *MatrixAudienceSelection `json:"selection,omitempty"`
	EventID        string                   `json:"eventId,omitempty"`
	ParentEventID  string                   `json:"parentEventId,omitempty"`
	Status         string
	Actor          string
	SessionBinding string
	BrowserBinding string
	Nonce          string
	BodyDigest     string
	TransactionID  string
	Action         string
	Audience       MatrixAudienceMetadata
	ExpiresAt      time.Time
}

func (s *Service) consumeMatrixAudienceNonceLocked(actor, action, transaction string, metadata MatrixAudienceMetadata, receipt *MatrixAudienceActionReceipt) error {
	now := s.cfg.Now()
	if !matrixAudienceTransaction.MatchString(receipt.Nonce) || !receipt.ExpiresAt.After(now) || receipt.BodyDigest == "" || receipt.SessionBinding == "" {
		return ErrUnauthorized
	}
	if s.state.AudienceProofTime != nil && now.Before(*s.state.AudienceProofTime) {
		return ErrUnauthorized
	}
	key := objectDigest([]string{receipt.SessionBinding, receipt.Nonce})
	if _, used := s.state.MatrixAudienceNonces[key]; used {
		return ErrConflict
	}
	count := 0
	for _, old := range s.state.MatrixAudienceNonces {
		if old.Status != "completed" || old.ExpiresAt.After(now) {
			count++
		}
	}
	if count >= 4096 {
		return ErrRateLimited
	}
	// An unknown external result belongs to the original intent, not its nonce.
	// Expiry, restart, a fresh session or different body must not dispatch that
	// same actor/action/transaction a second time before explicit settlement.
	for _, old := range s.state.MatrixAudienceNonces {
		if old.Status != "completed" && old.Actor == actor && old.Action == action && old.TransactionID == transaction {
			return ErrConflict
		}
	}
	if s.state.MatrixAudienceNonces == nil {
		s.state.MatrixAudienceNonces = map[string]matrixAudienceNonce{}
	}
	for key, old := range s.state.MatrixAudienceNonces {
		if old.Status == "completed" && !old.ExpiresAt.After(now) {
			delete(s.state.MatrixAudienceNonces, key)
		}
	}
	s.state.MatrixAudienceNonces[key] = matrixAudienceNonce{Status: "prepared", Actor: actor, SessionBinding: receipt.SessionBinding, BrowserBinding: receipt.BrowserBinding, Nonce: receipt.Nonce, BodyDigest: receipt.BodyDigest, TransactionID: transaction, Action: action, Audience: metadata, ExpiresAt: receipt.ExpiresAt}
	s.state.AudienceProofTime = &now
	return nil
}

func (s *Service) prepareMatrixAudienceActionLocked(actor, action, transaction string, metadata MatrixAudienceMetadata, receipt *MatrixAudienceActionReceipt, selection *MatrixAudienceSelection, eventID, parentEventID string) error {
	if s.stateWriteError != nil {
		return s.stateWriteError
	}
	before := cloneState(s.state)
	if err := s.consumeMatrixAudienceNonceLocked(actor, action, transaction, metadata, receipt); err != nil {
		return err
	}
	key := objectDigest([]string{receipt.SessionBinding, receipt.Nonce})
	record := s.state.MatrixAudienceNonces[key]
	record.Selection = selection
	record.EventID = eventID
	record.ParentEventID = parentEventID
	s.state.MatrixAudienceNonces[key] = record
	return s.saveOrRollbackLocked(before)
}
func (s *Service) completeMatrixAudienceActionLocked(metadata MatrixAudienceMetadata, receipt *MatrixAudienceActionReceipt) error {
	key := objectDigest([]string{receipt.SessionBinding, receipt.Nonce})
	record, ok := s.state.MatrixAudienceNonces[key]
	if !ok || record.Status != "prepared" || record.BodyDigest != receipt.BodyDigest || record.BrowserBinding != receipt.BrowserBinding {
		return ErrConflict
	}
	expected := record.Audience
	if record.Action == "resolve" {
		expected.RoomID = metadata.RoomID
	}
	if !sameAudience(expected, metadata) {
		return ErrConflict
	}
	record.Status = "completed"
	record.Audience = metadata
	s.state.MatrixAudienceNonces[key] = record
	return nil
}
