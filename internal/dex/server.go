package dex

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type SessionAuthorizer interface {
	Authorize(ctx context.Context, sessionBinding, account string, scopes []string) error
}

type UnavailableAuthorizer struct{}

func (UnavailableAuthorizer) Authorize(context.Context, string, string, []string) error {
	return errors.New("central Wallet session introspection unavailable")
}

type RemoteAuthorizer struct {
	URL    string
	Client *http.Client
}

func (authorizer RemoteAuthorizer) Authorize(ctx context.Context, binding, account string, scopes []string) error {
	if authorizer.URL == "" {
		return errors.New("central Wallet session introspection unavailable")
	}
	body, _ := json.Marshal(map[string]any{"sessionBinding": binding, "account": account, "productClientId": "ynx-dex-web-v1", "bundleId": "com.ynxweb4.dex.web", "requiredScopes": scopes})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, authorizer.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	client := authorizer.Client
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("central Wallet session rejected")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<10))
	if err != nil {
		return err
	}
	var result struct {
		Authorized      bool      `json:"authorized"`
		SessionBinding  string    `json:"sessionBinding"`
		Account         string    `json:"account"`
		ProductClientID string    `json:"productClientId"`
		BundleID        string    `json:"bundleId"`
		Scopes          []string  `json:"scopes"`
		ExpiresAt       time.Time `json:"expiresAt"`
	}
	if err := decodeExact(data, &result); err != nil || !result.Authorized || result.SessionBinding != binding || result.Account != account || result.ProductClientID != "ynx-dex-web-v1" || result.BundleID != "com.ynxweb4.dex.web" || !equalStrings(result.Scopes, scopes) || !result.ExpiresAt.After(time.Now()) {
		return errors.New("central Wallet session binding mismatch")
	}
	return nil
}

type Server struct {
	store        *Store
	build        buildinfo.Info
	ingestionKey string
	authorizer   SessionAuthorizer
	tokens       []Token
}

func NewServer(store *Store, info buildinfo.Info, ingestionKey string, authorizer SessionAuthorizer, tokens ...Token) (*Server, error) {
	if store == nil || len(ingestionKey) < 32 {
		return nil, errors.New("store and 32-byte ingestion key are required")
	}
	if authorizer == nil {
		authorizer = UnavailableAuthorizer{}
	}
	seen := make(map[string]struct{}, len(tokens))
	validated := append([]Token(nil), tokens...)
	for _, token := range validated {
		if err := token.Validate(); err != nil {
			return nil, err
		}
		key := strings.ToLower(token.Address)
		if _, exists := seen[key]; exists {
			return nil, errors.New("duplicate token address")
		}
		seen[key] = struct{}{}
	}
	sort.Slice(validated, func(i, j int) bool {
		return strings.ToLower(validated[i].Address) < strings.ToLower(validated[j].Address)
	})
	return &Server{store: store, build: buildinfo.Normalize(info), ingestionKey: ingestionKey, authorizer: authorizer, tokens: validated}, nil
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("GET /version", server.version)
	mux.HandleFunc("GET /v1/pools", server.pools)
	mux.HandleFunc("GET /v1/tokens", server.tokensList)
	mux.HandleFunc("GET /v1/swaps", server.events("swap"))
	mux.HandleFunc("GET /v1/liquidity", server.events("liquidity-add", "liquidity-remove"))
	mux.HandleFunc("GET /v1/transactions", server.events())
	mux.HandleFunc("GET /v1/analytics", server.analytics)
	mux.HandleFunc("GET /v1/prices", server.prices)
	mux.HandleFunc("GET /v1/twap", server.twap)
	mux.HandleFunc("GET /v1/fees", server.fees)
	mux.HandleFunc("GET /v1/account/positions", server.positions)
	mux.HandleFunc("POST /internal/v1/events", server.ingest)
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(response, request)
	})
}

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"status": "ok", "productId": "ynx-dex", "chainId": ChainID, "source": "indexed YNX Testnet EVM events", "latestBlock": server.store.Analytics().LatestBlock})
}
func (server *Server) version(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, server.build)
}
func (server *Server) pools(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"items": server.store.Pools(), "source": "indexed YNX Testnet EVM events"})
}
func (server *Server) tokensList(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"items": server.tokens, "chainId": ChainID, "mainnet": false, "source": "owner-reviewed Testnet token list"})
}
func (server *Server) analytics(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, server.store.Analytics())
}
func (server *Server) prices(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"items": server.store.SpotPrices(), "source": "raw indexed reserve ratios; not fiat prices"})
}
func (server *Server) twap(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"items": server.store.TWAPs(), "minimumIntervalSeconds": MinimumTWAPInterval, "source": "confirmed cumulative-price deltas; Q112 raw token ratios"})
}
func (server *Server) fees(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"items": server.store.Fees(), "source": "indexed raw token fee amounts"})
}

func (server *Server) events(types ...string) http.HandlerFunc {
	allowed := map[string]bool{}
	for _, value := range types {
		allowed[value] = true
	}
	return func(response http.ResponseWriter, request *http.Request) {
		limit, ok := boundedLimit(request.URL)
		if !ok {
			writeError(response, http.StatusBadRequest, "invalid limit")
			return
		}
		all := server.store.Events()
		result := make([]Event, 0, limit)
		for i := len(all) - 1; i >= 0 && len(result) < limit; i-- {
			if len(allowed) == 0 || allowed[all[i].Type] {
				result = append(result, all[i])
			}
		}
		writeJSON(response, http.StatusOK, map[string]any{"items": result, "source": "indexed YNX Testnet EVM events"})
	}
}

func (server *Server) positions(response http.ResponseWriter, request *http.Request) {
	account := request.Header.Get("X-YNX-Account")
	binding := request.Header.Get("X-YNX-Session-Binding")
	if !nativePattern.MatchString(account) || !sessionBindingPattern.MatchString(binding) {
		writeError(response, http.StatusUnauthorized, "canonical Wallet session required")
		return
	}
	if err := server.authorizer.Authorize(request.Context(), binding, account, []string{"account:read", "dex:positions:read"}); err != nil {
		writeError(response, http.StatusForbidden, "Wallet session rejected or unavailable")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": server.store.Positions(account), "account": account})
}

func (server *Server) ingest(response http.ResponseWriter, request *http.Request) {
	key := request.Header.Get("X-YNX-DEX-Indexer-Key")
	if len(key) != len(server.ingestionKey) || subtle.ConstantTimeCompare([]byte(key), []byte(server.ingestionKey)) != 1 {
		writeError(response, http.StatusUnauthorized, "unauthorized")
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, 32<<10)
	data, err := io.ReadAll(request.Body)
	if err != nil {
		writeError(response, http.StatusRequestEntityTooLarge, "body too large")
		return
	}
	var event Event
	if err := decodeExact(data, &event); err != nil {
		writeError(response, http.StatusBadRequest, "invalid event schema")
		return
	}
	created, err := server.store.Append(event)
	if err != nil {
		writeError(response, http.StatusConflict, err.Error())
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(response, status, map[string]any{"accepted": true, "created": created, "eventId": event.ID})
}

func boundedLimit(input *url.URL) (int, bool) {
	values, ok := input.Query()["limit"]
	if !ok {
		return 100, true
	}
	if len(values) != 1 {
		return 0, false
	}
	switch values[0] {
	case "25":
		return 25, true
	case "50":
		return 50, true
	case "100":
		return 100, true
	default:
		return 0, false
	}
}
func writeError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, map[string]string{"error": strings.TrimSpace(message)})
}
func writeJSON(response http.ResponseWriter, status int, value any) {
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
