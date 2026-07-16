package social

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

type DiscoveryResolver interface {
	ResolveDiscovery(source, value string) (string, error)
}
type Server struct {
	service  *Service
	resolver DiscoveryResolver
}

func NewServer(service *Service, resolver DiscoveryResolver) *Server {
	return &Server{service: service, resolver: resolver}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/social/v1/wallet/challenge", s.walletChallenge)
	mux.HandleFunc("/social/v1/wallet/login", s.login)
	mux.HandleFunc("/social/v1/", s.social)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, "method not allowed")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "service": "ynx-social", "persistence": "integrity-checked-atomic-mode-0600", "walletAuth": "canonical-signed-envelope-v1", "walletGateway": "persistent-p256-challenge-v1", "recoveryKeysAccepted": false, "chatContract": "internal/chat-v2", "feedContract": "internal/square-v2", "attachmentPolicy": s.service.AttachmentPolicy()})
}
func (s *Server) walletChallenge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	if r.URL.RawQuery != "" {
		writeError(w, 400, "wallet authorization query fields are not accepted")
		return
	}
	if !s.service.Allow(r.RemoteAddr, "anonymous", "wallet-challenge") {
		writeError(w, 429, ErrRateLimited.Error())
		return
	}
	var in WalletChallengeRequest
	if !decodeRequest(w, r, &in, 32*1024) {
		return
	}
	record, err := s.service.CreateWalletChallenge(in)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"challenge": record})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	if r.URL.RawQuery != "" {
		writeError(w, 400, "wallet authorization query fields are not accepted")
		return
	}
	if !s.service.Allow(r.RemoteAddr, "anonymous", "wallet-login") {
		writeError(w, 429, ErrRateLimited.Error())
		return
	}
	var in WalletLogin
	if !decodeRequest(w, r, &in, 32*1024) {
		return
	}
	result, err := s.service.Login(in)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, result)
}

type discoveryInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Source         string `json:"source"`
	Value          string `json:"value"`
}
type transitionInput struct {
	Action string `json:"action"`
	Output string `json:"output,omitempty"`
}
type targetInput struct {
	Target string `json:"target"`
	Active bool   `json:"active,omitempty"`
}
type inviteInput struct {
	TTLSeconds int `json:"ttlSeconds"`
}
type postInput struct {
	IdempotencyKey string   `json:"idempotencyKey"`
	Text           string   `json:"text"`
	Visibility     string   `json:"visibility"`
	Media          []string `json:"media"`
}
type commentInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Text           string `json:"text"`
}
type reactionInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Kind           string `json:"kind"`
	Active         bool   `json:"active"`
}
type reportInput struct {
	IdempotencyKey string   `json:"idempotencyKey"`
	TargetType     string   `json:"targetType"`
	TargetID       string   `json:"targetId"`
	Category       string   `json:"category"`
	Detail         string   `json:"detail"`
	EvidenceHashes []string `json:"evidenceHashes"`
}
type appealInput struct {
	Correction string `json:"correction"`
}
type followInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Source         string `json:"source"`
	Value          string `json:"value"`
	Active         bool   `json:"active"`
}
type mediaInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Purpose        string `json:"purpose"`
	ConversationID string `json:"conversationId,omitempty"`
	MIMEType       string `json:"mimeType"`
	SHA256         string `json:"sha256"`
	Data           string `json:"data"`
}
type contactMatchesInput struct {
	Hashes []string `json:"hashes"`
}
type aiStreamInput struct {
	ContextText string `json:"contextText"`
}
type conversationInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Source         string `json:"source"`
	Value          string `json:"value"`
}
type groupConversationInput struct {
	IdempotencyKey string           `json:"idempotencyKey"`
	Title          string           `json:"title"`
	Members        []discoveryInput `json:"members"`
}
type profileInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Handle         string `json:"handle"`
	DisplayName    string `json:"displayName"`
	Bio            string `json:"bio"`
	AvatarURL      string `json:"avatarUrl,omitempty"`
}

func (s *Server) social(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/social/v1/")
	scope := scopeForPath(path)
	actor, err := s.service.Authenticate(r.Header.Get("Authorization"), scope)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if !s.service.Allow(r.RemoteAddr, actor.Account, pathAction(path)) {
		writeServiceError(w, ErrRateLimited)
		return
	}
	switch {
	case path == "media" && r.Method == http.MethodPost:
		var in mediaInput
		if !decodeRequest(w, r, &in, 36*1024*1024) {
			return
		}
		var record MediaObject
		var replay bool
		record, replay, err = s.service.StoreMedia(actor, in.IdempotencyKey, in.Purpose, in.ConversationID, in.MIMEType, in.Data, in.SHA256)
		if err == nil {
			writeJSON(w, 201, map[string]any{"record": record, "replayed": replay})
		}
	case strings.HasPrefix(path, "media/") && r.Method == http.MethodGet:
		var record MediaObject
		var filePath string
		record, filePath, err = s.service.ReadMedia(actor, strings.TrimPrefix(path, "media/"))
		if err == nil {
			contentType := record.MIMEType
			if record.Encrypted {
				contentType = "application/octet-stream"
			}
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("X-YNX-Content-SHA256", record.SHA256)
			w.Header().Set("X-YNX-Encrypted", strconv.FormatBool(record.Encrypted))
			http.ServeFile(w, r, filePath)
			return
		}
	case path == "profile" && r.Method == http.MethodGet:
		var record ProfileView
		record, err = s.service.ContractProfile(actor)
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record})
		}
	case path == "profile" && r.Method == http.MethodPut:
		var in profileInput
		if !decodeRequest(w, r, &in, 32*1024) {
			return
		}
		var record ProfileView
		var replay bool
		record, replay, err = s.service.UpdateContractProfile(actor, in.IdempotencyKey, in.Handle, in.DisplayName, in.Bio, in.AvatarURL)
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record, "replayed": replay})
		}
	case path == "session/revoke" && r.Method == http.MethodPost:
		err = s.service.RevokeSession(actor)
		if err == nil {
			writeJSON(w, 200, map[string]bool{"revoked": true})
		}
	case path == "settings" && r.Method == http.MethodPut:
		var in ProfileSettingsInput
		if !decodeRequest(w, r, &in, 32*1024) {
			return
		}
		var record ProfileSettings
		var replay bool
		record, replay, err = s.service.SetSettings(actor, in)
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record, "replayed": replay})
		}
	case path == "settings" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]any{"record": s.service.currentSettings(actor.Account)})
		return
	case path == "invites" && r.Method == http.MethodPost:
		var in inviteInput
		if !decodeRequest(w, r, &in, 4096) {
			return
		}
		var record Invite
		var token string
		record, token, err = s.service.CreateInvite(actor, time.Duration(in.TTLSeconds)*time.Second)
		if err == nil {
			writeJSON(w, 201, map[string]any{"record": record, "token": token})
		}
	case path == "contacts" && r.Method == http.MethodGet:
		var record ContactsView
		record, err = s.service.ContractContacts(actor)
		if err != nil {
			break
		}
		writeJSON(w, 200, record)
		return
	case path == "contact-matches" && r.Method == http.MethodPost:
		var in contactMatchesInput
		if !decodeRequest(w, r, &in, 64*1024) {
			return
		}
		var records []ContactMatchView
		records, err = s.service.ContractContactMatches(actor, s.resolver, in.Hashes)
		if err == nil {
			writeJSON(w, 200, map[string]any{"matches": records})
		}
	case path == "conversations" && r.Method == http.MethodGet:
		var records []ConversationView
		records, err = s.service.ContractConversations(actor, r.URL.Query().Get("q"))
		if err == nil {
			writeJSON(w, 200, map[string]any{"conversations": records})
		}
	case path == "conversations" && r.Method == http.MethodPost:
		var in conversationInput
		if !decodeRequest(w, r, &in, 16*1024) {
			return
		}
		if s.resolver == nil {
			writeError(w, 503, "discovery resolver unavailable")
			return
		}
		var target string
		target, err = s.resolver.ResolveDiscovery(in.Source, in.Value)
		if err == nil {
			var result chat.Result[chat.Conversation]
			result, err = s.service.CreateDirectConversation(actor, target, in.IdempotencyKey)
			if err == nil {
				writeJSON(w, 201, result)
			}
		}
	case path == "conversations/groups" && r.Method == http.MethodPost:
		var in groupConversationInput
		if !decodeRequest(w, r, &in, 64*1024) {
			return
		}
		if s.resolver == nil {
			writeError(w, 503, "discovery resolver unavailable")
			return
		}
		targets := make([]string, 0, len(in.Members))
		for _, member := range in.Members {
			var target string
			target, err = s.resolver.ResolveDiscovery(member.Source, member.Value)
			if err != nil {
				break
			}
			targets = append(targets, target)
		}
		if err == nil {
			var record GroupConversation
			var replay bool
			record, replay, err = s.service.CreateGroupConversation(actor, in.Title, in.IdempotencyKey, targets)
			if err == nil {
				writeJSON(w, 201, map[string]any{"record": record, "replayed": replay})
			}
		}
	case strings.HasPrefix(path, "devices/") && strings.HasSuffix(path, "/rotate") && r.Method == http.MethodPost:
		replaced := strings.TrimSuffix(strings.TrimPrefix(path, "devices/"), "/rotate")
		var in chat.RotateDeviceRequest
		if !decodeRequest(w, r, &in, 32*1024) {
			return
		}
		var result chat.Result[chat.DeviceRotation]
		var session Session
		result, session, err = s.service.RotateConversationDevice(actor, replaced, in)
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": result.Record, "replayed": result.Replayed, "session": session})
		}
	case strings.HasPrefix(path, "conversations/"):
		s.handleConversation(w, r, actor, path, &err)
		if err == nil {
			return
		}
	case path == "feed" && r.Method == http.MethodGet:
		var records []FeedPostView
		records, err = s.service.ContractFeed(actor)
		if err == nil {
			writeJSON(w, 200, map[string]any{"posts": records})
		}
	case path == "feed" && r.Method == http.MethodPost:
		var in postInput
		if !decodeRequest(w, r, &in, 128*1024) {
			return
		}
		var record Moment
		var replay bool
		record, replay, err = s.service.CreateMoment(actor, in.IdempotencyKey, in.Text, in.Visibility, in.Media)
		if err == nil {
			writeJSON(w, 201, map[string]any{"record": record, "replayed": replay})
		}
	case strings.HasPrefix(path, "feed/") && strings.HasSuffix(path, "/comments") && r.Method == http.MethodGet:
		id := strings.TrimSuffix(strings.TrimPrefix(path, "feed/"), "/comments")
		var records []MomentCommentView
		records, err = s.service.ContractMomentComments(actor, id)
		if err == nil {
			writeJSON(w, 200, map[string]any{"comments": records})
		}
	case strings.HasPrefix(path, "feed/") && strings.HasSuffix(path, "/comments") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(path, "feed/"), "/comments")
		var in commentInput
		if !decodeRequest(w, r, &in, 16*1024) {
			return
		}
		var record MomentComment
		var replay bool
		record, replay, err = s.service.CreateMomentComment(actor, id, in.IdempotencyKey, in.Text)
		if err == nil {
			writeJSON(w, 201, map[string]any{"record": record, "replayed": replay})
		}
	case strings.HasPrefix(path, "feed/") && strings.HasSuffix(path, "/reaction") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(path, "feed/"), "/reaction")
		var in reactionInput
		if !decodeRequest(w, r, &in, 4096) {
			return
		}
		var record MomentReaction
		var replay bool
		record, replay, err = s.service.SetMomentReaction(actor, id, in.IdempotencyKey, in.Kind, in.Active)
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record, "replayed": replay})
		}
	case strings.HasPrefix(path, "feed/") && r.Method == http.MethodDelete:
		id := strings.TrimPrefix(path, "feed/")
		if r.Header.Get("X-YNX-Confirm-Delete") != "DELETE MOMENT" {
			writeError(w, 400, "exact moment deletion confirmation required")
			return
		}
		err = s.service.DeleteMoment(actor, id)
		if err == nil {
			writeJSON(w, 200, map[string]bool{"deleted": true})
		}
	case path == "follows" && r.Method == http.MethodPost:
		var in followInput
		if !decodeRequest(w, r, &in, 16*1024) {
			return
		}
		if s.resolver == nil {
			writeError(w, 503, "discovery resolver unavailable")
			return
		}
		var target string
		target, err = s.resolver.ResolveDiscovery(in.Source, in.Value)
		if err == nil {
			var result square.Result[square.Follow]
			result, err = s.service.FollowTarget(actor, target, in.IdempotencyKey, in.Active)
			if err == nil {
				writeJSON(w, 200, result)
			}
		}
	case path == "reports" && r.Method == http.MethodPost:
		var in reportInput
		if !decodeRequest(w, r, &in, 32*1024) {
			return
		}
		var record SocialReport
		var replay bool
		record, replay, err = s.service.CreateSocialReport(actor, in.IdempotencyKey, in.TargetType, in.TargetID, in.Category, in.Detail, in.EvidenceHashes)
		if err == nil {
			writeJSON(w, 201, map[string]any{"record": record, "replayed": replay})
		}
	case strings.HasPrefix(path, "reports/") && strings.HasSuffix(path, "/appeal") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(path, "reports/"), "/appeal")
		var in appealInput
		if !decodeRequest(w, r, &in, 16*1024) {
			return
		}
		var record SocialReport
		record, err = s.service.AppealSocialReport(actor, id, in.Correction)
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record})
		}
	case strings.HasPrefix(path, "reports/") && r.Method == http.MethodGet:
		var record SocialReport
		record, err = s.service.SocialReport(actor, strings.TrimPrefix(path, "reports/"))
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record})
		}
	case path == "contact-requests" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]any{"requests": s.service.Requests(actor)})
		return
	case path == "contact-requests" && r.Method == http.MethodPost:
		var in discoveryInput
		if !decodeRequest(w, r, &in, 16*1024) {
			return
		}
		if s.resolver == nil {
			writeError(w, 503, "discovery resolver unavailable")
			return
		}
		var target string
		target, err = s.resolver.ResolveDiscovery(in.Source, in.Value)
		if err == nil {
			var record ContactRequest
			var replay bool
			record, replay, err = s.service.RequestContact(actor, ContactRequestInput{IdempotencyKey: in.IdempotencyKey, TargetAccount: target, Source: in.Source})
			if err == nil {
				writeJSON(w, 201, map[string]any{"record": record, "replayed": replay})
			}
		}
	case strings.HasPrefix(path, "contact-requests/") && r.Method == http.MethodPost:
		var in transitionInput
		if !decodeRequest(w, r, &in, 4096) {
			return
		}
		id := strings.TrimPrefix(path, "contact-requests/")
		var record ContactRequest
		record, err = s.service.TransitionRequest(actor, id, in.Action)
		if err == nil {
			writeJSON(w, 200, record)
		}
	case path == "contacts/delete" && r.Method == http.MethodPost:
		var in targetInput
		if !decodeRequest(w, r, &in, 4096) {
			return
		}
		err = s.service.DeleteContact(actor, in.Target)
		if err == nil {
			writeJSON(w, 200, map[string]bool{"deleted": true})
		}
	case path == "privacy/block" && r.Method == http.MethodPost:
		var in targetInput
		if !decodeRequest(w, r, &in, 4096) {
			return
		}
		err = s.service.Block(actor, in.Target)
		if err == nil {
			writeJSON(w, 200, map[string]bool{"blocked": true})
		}
	case path == "privacy/mute" && r.Method == http.MethodPost:
		var in targetInput
		if !decodeRequest(w, r, &in, 4096) {
			return
		}
		err = s.service.Mute(actor, in.Target, in.Active)
		if err == nil {
			writeJSON(w, 200, map[string]bool{"active": in.Active})
		}
	case path == "notifications" && r.Method == http.MethodGet:
		var records []AlertView
		var unread int
		records, unread, err = s.service.ContractAlerts(actor)
		if err != nil {
			break
		}
		writeJSON(w, 200, map[string]any{"notifications": records, "unread": unread})
		return
	case strings.HasPrefix(path, "notifications/") && strings.HasSuffix(path, "/read") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(path, "notifications/"), "/read")
		var record any
		record, err = s.service.MarkContractNotificationRead(actor, id)
		if err == nil {
			writeJSON(w, 200, record)
		}
	case path == "ai/jobs" && r.Method == http.MethodPost:
		var in AIRequest
		if !decodeRequest(w, r, &in, 64*1024) {
			return
		}
		var record AIJob
		var replay bool
		record, replay, err = s.service.BeginAI(actor, in)
		if err == nil {
			writeJSON(w, 201, map[string]any{"record": record, "replayed": replay})
		}
	case strings.HasPrefix(path, "ai/jobs/") && strings.HasSuffix(path, "/stream") && r.Method == http.MethodPost:
		id := strings.TrimSuffix(strings.TrimPrefix(path, "ai/jobs/"), "/stream")
		var in aiStreamInput
		if !decodeRequest(w, r, &in, 8192) {
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		_, _ = io.WriteString(w, "event: metadata\ndata: {\"status\":\"streaming\"}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		var record AIJob
		record, err = s.service.StreamAI(r.Context(), actor, id, in.ContextText, func(chunk string) error {
			payload, marshalErr := json.Marshal(map[string]string{"text": chunk})
			if marshalErr != nil {
				return marshalErr
			}
			if _, writeErr := fmt.Fprintf(w, "event: token\ndata: %s\n\n", payload); writeErr != nil {
				return writeErr
			}
			if flusher != nil {
				flusher.Flush()
			}
			return nil
		})
		if err != nil {
			payload, _ := json.Marshal(map[string]string{"error": err.Error()})
			_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", payload)
		} else {
			payload, _ := json.Marshal(map[string]any{"record": record})
			_, _ = fmt.Fprintf(w, "event: done\ndata: %s\n\n", payload)
		}
		if flusher != nil {
			flusher.Flush()
		}
		return
	case strings.HasPrefix(path, "ai/jobs/") && r.Method == http.MethodPost:
		var in transitionInput
		if !decodeRequest(w, r, &in, 32*1024) {
			return
		}
		id := strings.TrimPrefix(path, "ai/jobs/")
		var record AIJob
		record, err = s.service.TransitionAI(actor, id, in.Action, in.Output)
		if err == nil {
			writeJSON(w, 200, record)
		}
	case path == "privacy/export" && r.Method == http.MethodGet:
		writeJSON(w, 200, s.service.Export(actor))
		return
	case path == "privacy/delete" && r.Method == http.MethodDelete:
		confirm := r.Header.Get("X-YNX-Confirm-Delete")
		if confirm != "DELETE MY SOCIAL DATA" {
			writeError(w, 400, "exact deletion confirmation required")
			return
		}
		err = s.service.DeleteAccount(actor)
		if err == nil {
			writeJSON(w, 200, map[string]bool{"deleted": true})
		}
	default:
		writeError(w, 404, "social route not found")
		return
	}
	if err != nil {
		writeServiceError(w, err)
	}
}

func (s *Server) handleConversation(w http.ResponseWriter, r *http.Request, actor Session, path string, returned *error) {
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[0] != "conversations" || parts[1] == "" {
		writeError(w, 404, "social route not found")
		return
	}
	conversationID := parts[1]
	switch {
	case len(parts) == 2 && r.Method == http.MethodGet:
		record, err := s.service.ContractConversation(actor, conversationID)
		*returned = err
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record})
		}
	case len(parts) == 3 && parts[2] == "devices" && r.Method == http.MethodGet:
		records, err := s.service.ConversationDevices(actor, conversationID)
		*returned = err
		if err == nil {
			writeJSON(w, 200, map[string]any{"devices": records})
		}
	case len(parts) == 3 && parts[2] == "messages" && r.Method == http.MethodGet:
		records, err := s.service.ConversationMessages(actor, conversationID)
		*returned = err
		if err == nil {
			writeJSON(w, 200, map[string]any{"messages": records})
		}
	case len(parts) == 3 && parts[2] == "messages" && r.Method == http.MethodPost:
		var in chat.SendMessageRequest
		if !decodeRequest(w, r, &in, 1024*1024) {
			return
		}
		result, err := s.service.SendConversationMessage(actor, conversationID, in)
		*returned = err
		if err == nil {
			writeJSON(w, 201, result)
		}
	case len(parts) == 5 && parts[2] == "messages" && (parts[4] == "delivered" || parts[4] == "read") && r.Method == http.MethodPost:
		var empty struct{}
		if !decodeRequest(w, r, &empty, 1024) {
			return
		}
		record, err := s.service.AcknowledgeConversationMessage(actor, conversationID, parts[3], parts[4])
		*returned = err
		if err == nil {
			writeJSON(w, 200, map[string]any{"record": record})
		}
	default:
		writeError(w, 404, "social route not found")
	}
}

func scopeForPath(path string) string {
	switch {
	case strings.HasPrefix(path, "ai/"):
		return "social.ai"
	case strings.HasPrefix(path, "conversation"):
		return "social.messaging"
	case strings.HasPrefix(path, "devices/"):
		return "social.messaging"
	case strings.HasPrefix(path, "feed") || strings.HasPrefix(path, "report") || strings.HasPrefix(path, "follow") || strings.HasPrefix(path, "media"):
		return "social.feed"
	case strings.HasPrefix(path, "contact") || strings.HasPrefix(path, "privacy/") || strings.HasPrefix(path, "invite") || strings.HasPrefix(path, "notification"):
		return "social.contacts"
	default:
		return "social.profile"
	}
}
func pathAction(path string) string {
	parts := strings.Split(path, "/")
	if len(parts) > 2 {
		return strings.Join(parts[:2], "/")
	}
	return path
}
func decodeRequest(w http.ResponseWriter, r *http.Request, out any, limit int) bool {
	if r.Body == nil {
		writeError(w, 400, "JSON body required")
		return false
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, int64(limit)+1))
	if err != nil || len(data) > limit {
		writeError(w, 400, "request body exceeds policy")
		return false
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		writeError(w, 400, "request body must be one strict JSON object")
		return false
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, "request body must contain exactly one JSON object")
		return false
	}
	return true
}
func writeServiceError(w http.ResponseWriter, err error) {
	status := 500
	switch {
	case errors.Is(err, ErrInvalid):
		status = 400
	case errors.Is(err, ErrUnauthorized):
		status = 401
	case errors.Is(err, ErrNotFound):
		status = 404
	case errors.Is(err, ErrConflict):
		status = 409
	case errors.Is(err, ErrRateLimited):
		status = 429
	}
	writeError(w, status, err.Error())
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

var _ = strconv.Itoa
