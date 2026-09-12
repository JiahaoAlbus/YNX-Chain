package aiproduct

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Provider IDs resolve through the Gateway's operator-managed catalog, never a
// user-supplied URL. The credential endpoint itself does not contact a provider.
var providerIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)
var providerModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$`)

type ProviderCredentialMetadata struct {
	Provider  string    `json:"provider"`
	Model     string    `json:"model"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type storedProviderCredential struct {
	ProviderCredentialMetadata
	Nonce  string `json:"nonce"`
	Cipher string `json:"cipher"`
}

func (s *Store) ListProviderCredentials(account string) []ProviderCredentialMetadata {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := []ProviderCredentialMetadata{}
	for _, record := range s.state.ProviderCredentials[account] {
		result = append(result, record.ProviderCredentialMetadata)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Provider < result[j].Provider })
	return result
}

func (s *Store) SaveProviderCredential(account, provider, model, apiKey string) (ProviderCredentialMetadata, error) {
	if account == "" || !providerIDPattern.MatchString(provider) || !providerModelPattern.MatchString(model) || len(apiKey) < 8 || len(apiKey) > 4096 {
		return ProviderCredentialMetadata{}, errors.New("invalid provider credential fields")
	}
	for _, character := range apiKey {
		if character < 33 || character > 126 {
			return ProviderCredentialMetadata{}, errors.New("invalid provider credential encoding")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	nonce, ciphertext, err := s.encrypt(account, "provider-credential:"+provider, model, apiKey)
	if err != nil {
		return ProviderCredentialMetadata{}, errors.New("could not protect provider credential")
	}
	if s.state.ProviderCredentials == nil {
		s.state.ProviderCredentials = map[string]map[string]storedProviderCredential{}
	}
	records := s.state.ProviderCredentials[account]
	if records == nil {
		records = map[string]storedProviderCredential{}
		s.state.ProviderCredentials[account] = records
	}
	previous, exists := records[provider]
	if !exists && len(records) >= 16 {
		return ProviderCredentialMetadata{}, errors.New("provider credential limit reached")
	}
	metadata := ProviderCredentialMetadata{Provider: provider, Model: model, UpdatedAt: s.now().UTC()}
	records[provider] = storedProviderCredential{ProviderCredentialMetadata: metadata, Nonce: nonce, Cipher: ciphertext}
	if err := s.saveLocked(); err != nil {
		if exists {
			records[provider] = previous
		} else {
			delete(records, provider)
		}
		return ProviderCredentialMetadata{}, errors.New("could not persist provider credential")
	}
	return metadata, nil
}

// Only the server-side generation path may resolve plaintext credentials.
func (s *Store) providerCredential(account, provider string) (ProviderCredentialMetadata, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, exists := s.state.ProviderCredentials[account][provider]
	if !exists {
		return ProviderCredentialMetadata{}, "", errors.New("provider credential not found")
	}
	key, err := s.decrypt(account, storedMessage{Message: Message{ID: record.Model, ConversationID: "provider-credential:" + provider}, Nonce: record.Nonce, Cipher: record.Cipher})
	if err != nil {
		return ProviderCredentialMetadata{}, "", errors.New("provider credential authentication failed")
	}
	return record.ProviderCredentialMetadata, key, nil
}

func (s *Store) DeleteProviderCredential(account, provider string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	records := s.state.ProviderCredentials[account]
	previous, exists := records[provider]
	if !exists {
		return nil
	}
	delete(records, provider)
	if err := s.saveLocked(); err != nil {
		records[provider] = previous
		return errors.New("could not delete provider credential")
	}
	return nil
}

func (s *Server) handleProviderCredentials(w http.ResponseWriter, r *http.Request, session ProductSession) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"credentials": s.store.ListProviderCredentials(session.Account), "keyMaterialReturned": false})
}

func (s *Server) handleProviderCatalog(w http.ResponseWriter, r *http.Request, session ProductSession) {
	w.Header().Set("Cache-Control", "no-store")
	response, err := s.gatewayRequest(r.Context(), http.MethodGet, "/ai/byok/providers", nil)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "BYOK catalog is unavailable")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		writeError(w, http.StatusServiceUnavailable, "BYOK catalog is unavailable")
		return
	}
	var catalog struct {
		Providers []struct {
			ID     string   `json:"id"`
			Models []string `json:"models"`
		} `json:"providers"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 128<<10)).Decode(&catalog) != nil || len(catalog.Providers) > 32 {
		writeError(w, http.StatusBadGateway, "invalid BYOK catalog")
		return
	}
	for _, provider := range catalog.Providers {
		if !providerIDPattern.MatchString(provider.ID) || len(provider.Models) > 128 {
			writeError(w, http.StatusBadGateway, "invalid BYOK catalog")
			return
		}
		for _, model := range provider.Models {
			if !providerModelPattern.MatchString(model) {
				writeError(w, http.StatusBadGateway, "invalid BYOK catalog")
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": catalog.Providers, "generationVerified": false})
}

func (s *Server) handleSaveProviderCredential(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		Model        string `json:"model"`
		APIKey       string `json:"apiKey"`
		Confirmation string `json:"confirmation"`
	}
	w.Header().Set("Cache-Control", "no-store")
	if !decodeJSON(w, r, &input, 8<<10) {
		return
	}
	if input.Confirmation != "store-provider-key" {
		writeError(w, http.StatusBadRequest, "explicit provider-key storage confirmation is required")
		return
	}
	metadata, err := s.store.SaveProviderCredential(session.Account, r.PathValue("provider"), strings.TrimSpace(input.Model), input.APIKey)
	input.APIKey = ""
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, metadata)
}

func (s *Server) handleDeleteProviderCredential(w http.ResponseWriter, r *http.Request, session ProductSession) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Query().Get("confirm") != "delete-provider-key" {
		writeError(w, http.StatusBadRequest, "explicit provider-key deletion confirmation is required")
		return
	}
	if err := s.store.DeleteProviderCredential(session.Account, r.PathValue("provider")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
