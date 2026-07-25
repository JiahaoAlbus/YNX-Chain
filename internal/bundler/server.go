package bundler

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const maxResponseSize = 1 << 20

type Config struct {
	GatewayURL string
	APIKey     string
	PrivateKey *secp256k1.PrivateKey
	HTTPClient *http.Client
	Build      buildinfo.Info
}

type Server struct {
	gatewayURL string
	apiKey     string
	privateKey *secp256k1.PrivateKey
	address    string
	client     *http.Client
	build      buildinfo.Info
	mu         sync.Mutex
	mux        *http.ServeMux
}

type gatewayUserOperationResponse struct {
	Source        string                          `json:"source"`
	AsOf          time.Time                       `json:"asOf"`
	Version       string                          `json:"version"`
	Coverage      any                             `json:"coverage"`
	Failure       bool                            `json:"failure"`
	UserOperation consensus.BFTUserOperationEvent `json:"userOperation"`
}

func New(cfg Config) (*Server, error) {
	parsed, err := url.Parse(strings.TrimSpace(cfg.GatewayURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("Bundler Gateway URL must be an absolute HTTP(S) URL without credentials, query, or fragment")
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if len(apiKey) < 16 || cfg.PrivateKey == nil {
		return nil, errors.New("Bundler API key and private key are required")
	}
	address, err := consensus.NativeAddress(cfg.PrivateKey.PubKey().SerializeCompressed())
	if err != nil {
		return nil, err
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	server := &Server{gatewayURL: strings.TrimRight(parsed.String(), "/"), apiKey: apiKey, privateKey: cfg.PrivateKey, address: address, client: client, build: buildinfo.Normalize(cfg.Build), mux: http.NewServeMux()}
	server.mux.HandleFunc("GET /health", server.health)
	server.mux.HandleFunc("POST /user-operations", server.authorize(server.submit))
	server.mux.HandleFunc("GET /user-operations/{id}", server.authorize(server.receipt))
	return server, nil
}

func (s *Server) Handler() http.Handler { return s.mux }

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	upstreamOK := false
	request, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, s.gatewayURL+"/health", nil)
	if response, err := s.client.Do(request); err == nil {
		upstreamOK = response.StatusCode == http.StatusOK
		_ = response.Body.Close()
	}
	status := http.StatusOK
	if !upstreamOK {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"ok": upstreamOK, "service": "ynx-bundlerd", "source": "ynx-bft-gateway", "asOf": time.Now().UTC(), "version": 1, "bundlerAddress": s.address, "gatewayReachable": upstreamOK, "queueMode": "serialized-account-nonce", "publicDeployed": false, "build": s.build, "failure": !upstreamOK})
}

func (s *Server) submit(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, failure("Content-Type application/json is required"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedActionSize)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input consensus.UserOperationExecutePayload
	if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		writeJSON(w, http.StatusBadRequest, failure("request must contain one bounded UserOperation payload"))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	account, err := s.gatewayAccount(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, failure(err.Error()))
		return
	}
	if account.Nonce == ^uint64(0) {
		writeJSON(w, http.StatusConflict, failure("Bundler account nonce is exhausted"))
		return
	}
	tx, err := consensus.NewSignedApplicationAction(s.privateKey, 6423, consensus.ActionUserOperationExecute, input, account.Nonce+1)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, failure(err.Error()))
		return
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, failure("failed to encode Bundler action"))
		return
	}
	request, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, s.gatewayURL+"/aa/user-operations", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, failure("BFT Gateway user operation unavailable"))
		return
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize+1))
	if err != nil || len(payload) > maxResponseSize {
		writeJSON(w, http.StatusBadGateway, failure("BFT Gateway response is invalid or oversized"))
		return
	}
	if response.StatusCode != http.StatusCreated {
		var upstream map[string]any
		if json.Unmarshal(payload, &upstream) != nil {
			upstream = failure("BFT Gateway rejected UserOperation")
		}
		writeJSON(w, response.StatusCode, upstream)
		return
	}
	var committed gatewayUserOperationResponse
	if json.Unmarshal(payload, &committed) != nil || committed.Failure || committed.Source != "ynx-consensus-abci" || !matchesCommittedUserOperation(committed.UserOperation, input.Operation, s.address) {
		writeJSON(w, http.StatusBadGateway, failure("committed UserOperation evidence mismatch"))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"schemaVersion": 1, "source": committed.Source, "asOf": committed.AsOf, "version": committed.Version, "coverage": committed.Coverage, "failure": false, "bundlerAddress": s.address, "userOperation": committed.UserOperation})
}

func matchesCommittedUserOperation(event consensus.BFTUserOperationEvent, operation assetauth.UserOperation, bundlerAddress string) bool {
	var total uint64
	for _, call := range operation.Calls {
		if ^uint64(0)-total < call.ValueYNXT {
			return false
		}
		total += call.ValueYNXT
	}
	if !isCanonicalBundlerHash(event.TransactionHash, true) || !isCanonicalBundlerHash(event.AuditHash, false) || event.ID != consensus.ApplicationActionRecordID("user-operation", event.TransactionHash) || event.OperationHash != consensus.UserOperationHash(operation) || event.Account != operation.Account || event.Bundler != bundlerAddress || event.PaymasterID != operation.PaymasterPolicy || event.CallCount != len(operation.Calls) || event.ValueYNXT != total || event.FeeYNXT != consensus.UserOperationFeeYNXT || event.BlockHeight <= 0 || event.ExecutedAt.IsZero() {
		return false
	}
	if !consensus.IsNativeAddress(event.FeePayer) {
		return false
	}
	return operation.PaymasterPolicy != "" || event.FeePayer == operation.Account
}

func isCanonicalBundlerHash(value string, prefixed bool) bool {
	if prefixed {
		if len(value) != 66 || !strings.HasPrefix(value, "0x") {
			return false
		}
		value = value[2:]
	} else if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func (s *Server) receipt(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if len(id) != 24 {
		writeJSON(w, http.StatusBadRequest, failure("canonical UserOperation receipt ID is required"))
		return
	}
	for _, value := range id {
		if !strings.ContainsRune("0123456789abcdef", value) {
			writeJSON(w, http.StatusBadRequest, failure("canonical UserOperation receipt ID is required"))
			return
		}
	}
	request, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, s.gatewayURL+"/aa/user-operations/"+id, nil)
	response, err := s.client.Do(request)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, failure("BFT Gateway receipt unavailable"))
		return
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize+1))
	if err != nil || len(payload) > maxResponseSize {
		writeJSON(w, http.StatusBadGateway, failure("BFT Gateway receipt response is invalid"))
		return
	}
	if response.StatusCode != http.StatusOK {
		var upstream map[string]any
		if json.Unmarshal(payload, &upstream) != nil {
			upstream = failure("BFT Gateway receipt query failed")
		}
		writeJSON(w, response.StatusCode, upstream)
		return
	}
	var committed gatewayUserOperationResponse
	if json.Unmarshal(payload, &committed) != nil || committed.Failure || committed.Source != "ynx-consensus-abci" || committed.UserOperation.ID != id {
		writeJSON(w, http.StatusBadGateway, failure("committed UserOperation receipt evidence mismatch"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": 1, "source": committed.Source, "asOf": committed.AsOf, "version": committed.Version, "coverage": committed.Coverage, "failure": false, "userOperation": committed.UserOperation})
}

func (s *Server) gatewayAccount(ctx context.Context) (chain.ConsensusAccount, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.gatewayURL+"/accounts/"+s.address, nil)
	response, err := s.client.Do(request)
	if err != nil {
		return chain.ConsensusAccount{}, errors.New("BFT Gateway account query unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return chain.ConsensusAccount{}, fmt.Errorf("Bundler account query returned HTTP %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize+1))
	if err != nil || len(payload) > maxResponseSize {
		return chain.ConsensusAccount{}, errors.New("BFT Gateway Bundler account response is invalid or oversized")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var account chain.ConsensusAccount
	if decoder.Decode(&account) != nil || decoder.Decode(&struct{}{}) != io.EOF || account.Address != s.address {
		return chain.ConsensusAccount{}, errors.New("BFT Gateway Bundler account evidence mismatch")
	}
	return account, nil
}

func (s *Server) authorize(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimSpace(r.Header.Get("X-YNX-Bundler-Key"))
		if len(provided) != len(s.apiKey) || subtle.ConstantTimeCompare([]byte(provided), []byte(s.apiKey)) != 1 {
			writeJSON(w, http.StatusUnauthorized, failure("valid Bundler access key is required"))
			return
		}
		next(w, r)
	}
}

func failure(message string) map[string]any {
	return map[string]any{"error": message, "source": "ynx-bundlerd", "version": 1, "coverage": "none", "failure": true}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
