package square

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Server struct {
	service *Service
	build   buildinfo.Info
}

func NewServer(service *Service) *Server { return NewServerWithBuild(service, buildinfo.Info{}) }
func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	return &Server{service: service, build: buildinfo.Normalize(build)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/metrics", s.metrics)
	mux.HandleFunc("/square/", s.square)
	return securityHeaders(mux)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	health := s.service.Health()
	health.Build = s.build
	writeJSON(w, http.StatusOK, health)
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	health := s.service.Health()
	remote := 0
	if health.RemoteDeployed {
		remote = 1
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "ynx_square_posts %d\nynx_square_comments %d\nynx_square_active_reactions %d\nynx_square_active_follows %d\nynx_square_reports %d\nynx_square_profiles %d\nynx_square_notifications %d\nynx_square_remote_deployed %d\n", health.PostCount, health.CommentCount, health.ActiveReactions, health.ActiveFollows, health.ReportCount, health.ProfileCount, health.NotificationCount, remote)
}

func (s *Server) square(w http.ResponseWriter, r *http.Request) {
	if !s.service.Authorized(r.Header.Get("X-YNX-Square-Key")) {
		writeError(w, http.StatusUnauthorized, "service authentication required")
		return
	}
	if !s.service.Allow(r.RemoteAddr, r.Header.Get("X-YNX-Device-ID")) {
		writeError(w, http.StatusTooManyRequests, "square API rate limit exceeded")
		return
	}
	body, err := readBody(r, s.service.cfg.MaxBodyBytes)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) == 2 && parts[0] == "square" && parts[1] == "devices" && r.Method == http.MethodPost {
		var request RegisterDeviceRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.RegisterDevice(request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
		return
	}
	if s.handleRead(w, r, parts) {
		return
	}
	actor, err := s.service.AuthenticateDevice(r.Header.Get("X-YNX-Device-ID"), r.Method, r.URL.RequestURI(), r.Header.Get("X-YNX-Timestamp"), r.Header.Get("X-YNX-Device-Signature"), body)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	switch {
	case len(parts) == 4 && parts[0] == "square" && parts[1] == "devices" && parts[3] == "revoke" && r.Method == http.MethodPost:
		record, err := s.service.RevokeDevice(actor, parts[2])
		writeRecord(w, record, err)
	case len(parts) == 2 && parts[0] == "square" && parts[1] == "posts" && r.Method == http.MethodPost:
		var request CreatePostRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.CreatePost(actor, request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
	case len(parts) == 4 && parts[0] == "square" && parts[1] == "posts" && parts[3] == "comments" && r.Method == http.MethodPost:
		var request CreateCommentRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.CreateComment(actor, parts[2], request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
	case len(parts) == 4 && parts[0] == "square" && parts[1] == "posts" && parts[3] == "reactions" && r.Method == http.MethodPost:
		var request SetReactionRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.SetReaction(actor, parts[2], request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
	case len(parts) == 2 && parts[0] == "square" && parts[1] == "follows" && r.Method == http.MethodPost:
		var request SetFollowRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.SetFollow(actor, request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
	case len(parts) == 2 && parts[0] == "square" && parts[1] == "profiles" && r.Method == http.MethodPost:
		var request SetProfileRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.SetProfile(actor, request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
	case len(parts) == 2 && parts[0] == "square" && parts[1] == "notifications" && r.Method == http.MethodGet:
		limit, err := strconv.Atoi(defaultValue(r.URL.Query().Get("limit"), "20"))
		if err != nil {
			writeServiceError(w, ErrInvalid)
			return
		}
		record, err := s.service.Notifications(actor, limit, r.URL.Query().Get("cursor"))
		writeRecord(w, record, err)
	case len(parts) == 4 && parts[0] == "square" && parts[1] == "notifications" && parts[3] == "read" && r.Method == http.MethodPost:
		var request ReadNotificationRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.ReadNotification(actor, parts[2], request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
	case len(parts) == 2 && parts[0] == "square" && parts[1] == "reports" && r.Method == http.MethodPost:
		var request CreateReportRequest
		if !decodeOrError(w, body, &request) {
			return
		}
		result, err := s.service.CreateReport(actor, request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeResult(w, result.Replayed, result)
	case len(parts) == 3 && parts[0] == "square" && parts[1] == "reports" && r.Method == http.MethodGet:
		record, err := s.service.Report(actor, parts[2])
		writeRecord(w, record, err)
	default:
		writeError(w, http.StatusNotFound, "square route not found")
	}
}

func (s *Server) handleRead(w http.ResponseWriter, r *http.Request, parts []string) bool {
	switch {
	case len(parts) == 2 && parts[0] == "square" && parts[1] == "feed" && r.Method == http.MethodGet:
		limit, err := strconv.Atoi(defaultValue(r.URL.Query().Get("limit"), "20"))
		if err != nil {
			writeServiceError(w, ErrInvalid)
			return true
		}
		feed, err := s.service.Feed(limit, r.URL.Query().Get("cursor"))
		writeRecord(w, feed, err)
		return true
	case len(parts) == 3 && parts[0] == "square" && parts[1] == "posts" && r.Method == http.MethodGet:
		record, err := s.service.Post(parts[2])
		writeRecord(w, record, err)
		return true
	case len(parts) == 4 && parts[0] == "square" && parts[1] == "posts" && parts[3] == "comments" && r.Method == http.MethodGet:
		record, err := s.service.Comments(parts[2])
		writeRecord(w, map[string]any{"comments": record}, err)
		return true
	case len(parts) == 4 && parts[0] == "square" && parts[1] == "profiles" && parts[3] == "following" && r.Method == http.MethodGet:
		record, err := s.service.Following(parts[2])
		writeRecord(w, map[string]any{"following": record}, err)
		return true
	case len(parts) == 3 && parts[0] == "square" && parts[1] == "handles" && r.Method == http.MethodGet:
		record, err := s.service.ProfileByHandle(parts[2])
		writeRecord(w, record, err)
		return true
	case len(parts) == 3 && parts[0] == "square" && parts[1] == "profiles" && r.Method == http.MethodGet:
		record, err := s.service.Profile(parts[2])
		writeRecord(w, record, err)
		return true
	default:
		return false
	}
}

func readBody(r *http.Request, limit int) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, int64(limit)+1))
	if err != nil {
		return nil, errors.New("read request body")
	}
	if len(data) > limit {
		return nil, errors.New("request body exceeds policy")
	}
	return data, nil
}

func decodeBody(data []byte, out any) error {
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return errors.New("request body must be one bounded JSON object")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("request body must contain exactly one JSON object")
	}
	return nil
}

func decodeOrError(w http.ResponseWriter, body []byte, out any) bool {
	if err := decodeBody(body, out); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func writeResult(w http.ResponseWriter, replayed bool, value any) {
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, value)
}

func writeRecord(w http.ResponseWriter, value any, err error) {
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func writeServiceError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrInvalid):
		status = http.StatusBadRequest
	case errors.Is(err, ErrUnauthorized):
		status = http.StatusUnauthorized
	case errors.Is(err, ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrConflict):
		status = http.StatusConflict
	}
	writeError(w, status, err.Error())
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func defaultValue(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
