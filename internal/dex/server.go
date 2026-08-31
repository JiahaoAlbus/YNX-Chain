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
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

type SessionAuthorizer interface {
	Authorize(ctx context.Context, productSessionProof string, scopes []string) (string, error)
}

type UnavailableAuthorizer struct{}

func (UnavailableAuthorizer) Authorize(context.Context, string, []string) (string, error) {
	return "", errors.New("central Wallet session introspection unavailable")
}

type RemoteAuthorizer struct {
	URL    string
	Client *http.Client
}

func (authorizer RemoteAuthorizer) Authorize(ctx context.Context, proof string, scopes []string) (string, error) {
	if authorizer.URL == "" {
		return "", errors.New("central Wallet session introspection unavailable")
	}
	body, _ := json.Marshal(map[string]any{"requiredScopes": scopes})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, authorizer.URL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-YNX-Product-Session-Proof", proof)
	client := authorizer.Client
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", errors.New("central Wallet session rejected")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<10))
	if err != nil {
		return "", err
	}
	var result struct {
		OK            bool   `json:"ok"`
		SchemaVersion int    `json:"schemaVersion"`
		StateDigest   string `json:"stateDigest"`
		Result        struct {
			Active  bool `json:"active"`
			Session struct {
				VerifierVersion        string    `json:"verifierVersion"`
				SessionBinding         string    `json:"sessionBinding"`
				ChainID                string    `json:"chainId"`
				RequestingProduct      string    `json:"requestingProduct"`
				Account                string    `json:"account"`
				ProductClientID        string    `json:"productClientId"`
				BundleID               string    `json:"bundleId"`
				Callback               string    `json:"callback"`
				ProductDeviceAlgorithm string    `json:"productDeviceAlgorithm"`
				ProductDeviceKey       string    `json:"productDeviceKey"`
				DeviceBinding          string    `json:"deviceBinding"`
				Scopes                 []string  `json:"scopes"`
				Nonce                  string    `json:"nonce"`
				AccountPublicKey       string    `json:"accountPublicKey"`
				Purpose                string    `json:"purpose"`
				RequestDigest          string    `json:"requestDigest"`
				ApprovalDigest         string    `json:"approvalDigest"`
				IssuedAt               time.Time `json:"issuedAt"`
				ExpiresAt              time.Time `json:"expiresAt"`
			} `json:"session"`
		} `json:"result"`
	}
	if err := decodeExact(data, &result); err != nil || !result.OK || result.SchemaVersion != 1 || !nativeBlockHashPattern.MatchString(result.StateDigest) || !result.Result.Active || result.Result.Session.VerifierVersion != "wallet-auth-v1" || result.Result.Session.ChainID != "ynx_6423-1" || result.Result.Session.RequestingProduct != "dex" || !nativePattern.MatchString(result.Result.Session.Account) || result.Result.Session.ProductClientID != "ynx-dex-web-v1" || result.Result.Session.BundleID != "com.ynxweb4.dex.web" || result.Result.Session.Callback != "https://dex.ynxweb4.com/wallet-auth/callback" || result.Result.Session.ProductDeviceAlgorithm != "p256-sha256" || !containsStrings(result.Result.Session.Scopes, scopes) || !result.Result.Session.ExpiresAt.After(time.Now()) {
		return "", errors.New("central Wallet session binding mismatch")
	}
	return result.Result.Session.Account, nil
}

type Server struct {
	store          *Store
	build          buildinfo.Info
	ingestionKey   string
	authorizer     SessionAuthorizer
	tokens         []Token
	source         string
	tokenProvider  TokenProvider
	nativeProvider NativeSnapshotProvider
	sourceReady    bool
	actionReady    bool
	financeRead    *readintegration.Verifier
	financeSlots   chan struct{}
}

type TokenProvider interface{ Tokens() []Token }
type NativeSnapshotProvider interface{ NativeSnapshot() NativeSnapshot }

func NewServer(store *Store, info buildinfo.Info, ingestionKey string, authorizer SessionAuthorizer, tokens ...Token) (*Server, error) {
	return NewServerWithSource(store, info, ingestionKey, authorizer, "indexed YNX Testnet EVM events", tokens...)
}

func (server *Server) SetTokenProvider(provider TokenProvider) {
	server.tokenProvider = provider
	if native, ok := provider.(NativeSnapshotProvider); ok {
		server.nativeProvider = native
	}
}

// SetRuntimeBoundary records whether the process has an authoritative market
// source and whether that source also exposes canonical chain action routes.
// A configured source is not by itself an executable market: health derives
// availability from both this boundary and the presence of an indexed pool.
func (server *Server) SetRuntimeBoundary(sourceReady, actionReady bool) {
	server.sourceReady = sourceReady
	server.actionReady = sourceReady && actionReady
}

func NewServerWithSource(store *Store, info buildinfo.Info, ingestionKey string, authorizer SessionAuthorizer, source string, tokens ...Token) (*Server, error) {
	if store == nil || len(ingestionKey) < 32 {
		return nil, errors.New("store and 32-byte ingestion key are required")
	}
	if strings.TrimSpace(source) == "" {
		return nil, errors.New("DEX data source is required")
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
	return &Server{store: store, build: buildinfo.Normalize(info), ingestionKey: ingestionKey, authorizer: authorizer, tokens: validated, source: source, financeSlots: make(chan struct{}, 64)}, nil
}

func (server *Server) ConfigureFinanceRead(secret string) error {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		server.financeRead = nil
		return nil
	}
	verifier, err := readintegration.NewVerifier(secret, "finance", "dex", time.Now)
	if err != nil {
		return err
	}
	server.financeRead = verifier
	return nil
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("GET /version", server.version)
	mux.HandleFunc("GET /v1/pools", server.pools)
	mux.HandleFunc("GET /v1/tokens", server.tokensList)
	mux.HandleFunc("GET /v1/native-snapshot", server.nativeSnapshot)
	mux.HandleFunc("GET /v1/swaps", server.events("swap"))
	mux.HandleFunc("GET /v1/liquidity", server.events("liquidity-add", "liquidity-remove"))
	mux.HandleFunc("GET /v1/transactions", server.events())
	mux.HandleFunc("GET /v1/analytics", server.analytics)
	mux.HandleFunc("GET /v1/prices", server.prices)
	mux.HandleFunc("GET /v1/twap", server.twap)
	mux.HandleFunc("GET /v1/fees", server.fees)
	mux.HandleFunc("GET /v1/candles", server.candles)
	mux.HandleFunc("GET /v1/account/positions", server.positions)
	mux.HandleFunc("GET "+FinanceReadRoute, server.financeAccount)
	mux.HandleFunc("POST /internal/v1/events", server.ingest)
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(response, request)
	})
}

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	analytics := server.store.Analytics()
	marketAvailable := server.sourceReady && analytics.Pools > 0
	writeJSON(response, http.StatusOK, map[string]any{
		"status":                 "ok",
		"productId":              "ynx-dex",
		"chainId":                ChainID,
		"source":                 server.source,
		"latestBlock":            analytics.LatestBlock,
		"indexedPools":           analytics.Pools,
		"marketSourceConfigured": server.sourceReady,
		"marketAvailable":        marketAvailable,
		// v1.35 custody execution remains compiled closed.  Market availability,
		// Wallet reachability, and deployment configuration cannot stand in for
		// the owner/mandate and closed-vault YNXT evidence required by Chain Core.
		"executionAvailable":     false,
		"executionGate":          "chain_core_strategy_vault_v1_35_product_evidence",
		"executionGateSatisfied": false,
	})
}
func (server *Server) version(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, server.build)
}
func (server *Server) pools(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{"items": server.store.Pools(), "source": server.source})
}
func (server *Server) tokensList(response http.ResponseWriter, _ *http.Request) {
	items := make([]Token, 0, len(server.tokens))
	items = append(items, server.tokens...)
	source := "owner-reviewed Testnet token list"
	if server.tokenProvider != nil {
		items = server.tokenProvider.Tokens()
		source = "authoritative chain-native YNX Testnet asset registry"
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": items, "chainId": ChainID, "mainnet": false, "source": source})
}
func (server *Server) nativeSnapshot(response http.ResponseWriter, _ *http.Request) {
	if server.nativeProvider == nil {
		writeError(response, http.StatusServiceUnavailable, "authoritative native DEX snapshot is unavailable")
		return
	}
	snapshot := server.nativeProvider.NativeSnapshot()
	age := time.Since(snapshot.UpdatedAt)
	if snapshot.Source != "authoritative chain-native YNX Testnet state" || snapshot.UpdatedAt.IsZero() || age > 15*time.Minute {
		writeError(response, http.StatusServiceUnavailable, "authoritative native DEX snapshot is stale")
		return
	}
	snapshot.Fresh = age <= 30*time.Second
	snapshot.SnapshotAgeSeconds = int64(age / time.Second)
	response.Header().Set("Cache-Control", "public, max-age=1, stale-while-revalidate=15")
	writeJSON(response, http.StatusOK, snapshot)
}
func (server *Server) analytics(response http.ResponseWriter, _ *http.Request) {
	analytics := server.store.Analytics()
	analytics.Source = server.source
	writeJSON(response, http.StatusOK, analytics)
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
func (server *Server) candles(response http.ResponseWriter, request *http.Request) {
	pool := strings.TrimSpace(request.URL.Query().Get("pool"))
	if !addressPattern.MatchString(pool) && !nativePoolPattern.MatchString(pool) {
		writeError(response, http.StatusBadRequest, "valid pool is required")
		return
	}
	interval, err := strconv.ParseUint(request.URL.Query().Get("interval"), 10, 64)
	if err != nil || !allowedCandleInterval(interval) {
		writeError(response, http.StatusBadRequest, "interval must be 60, 300, 900, 3600, 14400, or 86400 seconds")
		return
	}
	limit := 200
	if raw := request.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 500 {
			writeError(response, http.StatusBadRequest, "limit must be 1..500")
			return
		}
		limit = parsed
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": server.store.Candles(pool, interval, limit), "pool": pool, "intervalSeconds": interval, "source": "OHLC and raw volumes aggregated only from confirmed swap events"})
}

func allowedCandleInterval(value uint64) bool {
	switch value {
	case 60, 300, 900, 3600, 14400, 86400:
		return true
	default:
		return false
	}
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
		writeJSON(response, http.StatusOK, map[string]any{"items": result, "source": server.source})
	}
}

func (server *Server) positions(response http.ResponseWriter, request *http.Request) {
	proof := strings.TrimSpace(request.Header.Get("X-YNX-Product-Session-Proof"))
	if len(proof) < 90 || len(proof) > 16<<10 {
		writeError(response, http.StatusUnauthorized, "canonical Wallet session required")
		return
	}
	account, err := server.authorizer.Authorize(request.Context(), proof, []string{"account:read", "dex:positions:read"})
	if err != nil {
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
func containsStrings(granted, required []string) bool {
	set := make(map[string]struct{}, len(granted))
	for _, scope := range granted {
		set[scope] = struct{}{}
	}
	for _, scope := range required {
		if _, ok := set[scope]; !ok {
			return false
		}
	}
	return true
}
