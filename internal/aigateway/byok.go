package aigateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

type BYOKProvider struct {
	URL    string   `json:"url"`
	Models []string `json:"models"`
}

// Transient server-to-server input. Never add this value to audit entries,
// model messages, health output, request logs or persisted Gateway state.
type ProviderSelection struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	APIKey   string `json:"apiKey"`
}

var byokID = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)

func (s *Server) handleBYOKProviders(w http.ResponseWriter, r *http.Request) {
	requestID, _, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if s.service.cfg.BYOKAccessAPIKey == "" || !equalHash(r.Header.Get("X-YNX-AI-BYOK-Key"), s.service.cfg.BYOKAccessAPIKey) {
		writeError(w, http.StatusUnauthorized, requestID, "byok_unauthorized", "BYOK product access is required")
		return
	}
	type entry struct {
		ID     string   `json:"id"`
		Models []string `json:"models"`
	}
	entries := []entry{}
	for id, provider := range s.service.cfg.BYOKProviders {
		entries = append(entries, entry{ID: id, Models: append([]string(nil), provider.Models...)})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"providers": entries, "generationVerified": false})
}

func validateBYOKConfig(cfg Config) error {
	if len(cfg.BYOKProviders) == 0 {
		return nil
	}
	if len(cfg.BYOKProviders) > 32 || len(cfg.BYOKAccessAPIKey) < 32 || cfg.BYOKAccessAPIKey == cfg.AccessAPIKey {
		return errors.New("BYOK requires a bounded catalog and a separate product access key of at least 32 bytes")
	}
	for id, provider := range cfg.BYOKProviders {
		parsed, err := url.Parse(provider.URL)
		if !byokID.MatchString(id) || err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.HasSuffix(provider.URL, "/") || validServiceURL(provider.URL, false) != nil || len(provider.Models) == 0 || len(provider.Models) > 128 {
			return errors.New("invalid BYOK provider catalog")
		}
		for _, model := range provider.Models {
			if strings.TrimSpace(model) != model || model == "" || len(model) > 160 {
				return errors.New("invalid BYOK model catalog")
			}
		}
	}
	return nil
}

func (s *Service) validateProviderSelection(selection *ProviderSelection) error {
	if selection == nil {
		return errors.New("BYOK provider selection is required")
	}
	provider, exists := s.cfg.BYOKProviders[selection.Provider]
	allowed := false
	for _, model := range provider.Models {
		if model == selection.Model {
			allowed = true
			break
		}
	}
	if !exists || !allowed || len(selection.APIKey) < 8 || len(selection.APIKey) > 4096 {
		return errors.New("BYOK provider, model or credential is invalid")
	}
	for _, character := range selection.APIKey {
		if character < 33 || character > 126 {
			return errors.New("BYOK credential encoding is invalid")
		}
	}
	return nil
}
