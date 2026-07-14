package chat

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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
	mux.HandleFunc("/chat/", s.chat)
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
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "ynx_chat_devices %d\nynx_chat_conversations %d\nynx_chat_messages %d\nynx_chat_plaintext_stored 0\nynx_chat_remote_deployed 0\n", health.DeviceCount, health.ConversationCount, health.MessageCount)
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	if !s.service.Authorized(r.Header.Get("X-YNX-Chat-Key")) {
		writeError(w, http.StatusUnauthorized, "service authentication required")
		return
	}
	body, err := readBody(r, s.service.cfg.MaxCiphertextBytes+4096)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) == 2 && parts[0] == "chat" && parts[1] == "devices" && r.Method == http.MethodPost {
		var request RegisterDeviceRequest
		if err := decodeBody(body, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		result, err := s.service.RegisterDevice(request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		status := http.StatusCreated
		if result.Replayed {
			status = http.StatusOK
		}
		writeJSON(w, status, result)
		return
	}
	actor, err := s.service.AuthenticateDevice(r.Header.Get("X-YNX-Device-ID"), r.Method, r.URL.RequestURI(), r.Header.Get("X-YNX-Timestamp"), r.Header.Get("X-YNX-Device-Signature"), body)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	switch {
	case len(parts) == 4 && parts[0] == "chat" && parts[1] == "devices" && parts[3] == "revoke" && r.Method == http.MethodPost:
		record, err := s.service.RevokeDevice(actor, parts[2])
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, record)
	case len(parts) == 2 && parts[0] == "chat" && parts[1] == "conversations" && r.Method == http.MethodPost:
		var request CreateConversationRequest
		if err := decodeBody(body, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		result, err := s.service.CreateConversation(actor, request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		status := http.StatusCreated
		if result.Replayed {
			status = http.StatusOK
		}
		writeJSON(w, status, result)
	case len(parts) == 3 && parts[0] == "chat" && parts[1] == "conversations" && r.Method == http.MethodGet:
		record, err := s.service.Conversation(actor, parts[2])
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, record)
	case len(parts) == 4 && parts[0] == "chat" && parts[1] == "conversations" && parts[3] == "messages" && r.Method == http.MethodPost:
		var request SendMessageRequest
		if err := decodeBody(body, &request); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		result, err := s.service.SendMessage(actor, parts[2], request)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		status := http.StatusCreated
		if result.Replayed {
			status = http.StatusOK
		}
		writeJSON(w, status, result)
	case len(parts) == 4 && parts[0] == "chat" && parts[1] == "conversations" && parts[3] == "messages" && r.Method == http.MethodGet:
		records, err := s.service.Messages(actor, parts[2])
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"messages": records})
	case len(parts) == 6 && parts[0] == "chat" && parts[1] == "conversations" && parts[3] == "messages" && r.Method == http.MethodPost:
		record, err := s.service.Acknowledge(actor, parts[2], parts[4], parts[5])
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, record)
	default:
		writeError(w, http.StatusNotFound, "chat route not found")
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
