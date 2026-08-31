package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct"
)

func main() {
	addr := env("YNX_EXCHANGE_HTTP_ADDR", "127.0.0.1:6442")
	state := env("YNX_EXCHANGE_STATE_PATH", ".ynx/exchange/state.json")
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_DATABASE_URL"))
	apiKey := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_ADMIN_API_KEY"))
	if len(apiKey) < 16 {
		log.Fatal("YNX_EXCHANGE_ADMIN_API_KEY of at least 16 characters is required")
	}
	callback := env("YNX_EXCHANGE_WALLET_CALLBACK", "ynxexchange://wallet/callback")
	var chain exchangeproduct.ChainReader
	if u := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_INDEXER_URL")); u != "" {
		chain = exchangeproduct.IndexerChainReader{BaseURL: u, Client: &http.Client{Timeout: 5 * time.Second}}
	}
	gatewayURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_GATEWAY_URL"))
	var gateway exchangeproduct.GatewayAuthorizer
	if gatewayURL != "" {
		gateway = exchangeproduct.HTTPGatewayAuthorizer{BaseURL: gatewayURL, Client: &http.Client{Timeout: 5 * time.Second}}
	}
	service, err := exchangeproduct.New(exchangeproduct.Config{StatePath: state, DatabaseURL: databaseURL, APIKey: apiKey, WalletCallback: callback, CustodyAddress: strings.TrimSpace(os.Getenv("YNX_EXCHANGE_CUSTODY_ADDRESS")), GatewayURL: gatewayURL, GatewayClientID: strings.TrimSpace(os.Getenv("YNX_EXCHANGE_GATEWAY_CLIENT_ID")), Gateway: gateway, IndexerURL: strings.TrimSpace(os.Getenv("YNX_EXCHANGE_INDEXER_URL")), RequiredConfirmations: int64(envInt("YNX_EXCHANGE_CONFIRMATIONS", 12)), MakerFeeBPS: int64(envInt("YNX_EXCHANGE_MAKER_FEE_BPS", 10)), TakerFeeBPS: int64(envInt("YNX_EXCHANGE_TAKER_FEE_BPS", 20)), WithdrawalFeeMicroYNXT: envInt64("YNX_EXCHANGE_WITHDRAWAL_FEE_MICRO", 10000), MaxOrderNotionalMicro: envInt64("YNX_EXCHANGE_MAX_ORDER_NOTIONAL_MICRO", 100_000*exchangeproduct.AmountScale), MaxWithdrawalMicro: envInt64("YNX_EXCHANGE_MAX_WITHDRAWAL_MICRO", 25_000*exchangeproduct.AmountScale), Chain: chain})
	if err != nil {
		log.Fatal(err)
	}
	defer service.Close()
	if databaseURL == "" {
		log.Fatal("YNX_EXCHANGE_DATABASE_URL is required: Exchange admission must use PostgreSQL in multi-instance mode")
	}
	admission, err := newPostgresAdmission(128, 600, time.Minute, databaseURL)
	if err != nil {
		log.Fatalf("configure PostgreSQL Exchange admission: %v", err)
	}
	defer admission.Close()
	api := exchangeproduct.NewServer(service)
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", api))
	mux.Handle("/", spa(http.Dir("apps/exchange/web")))
	server := &http.Server{Addr: addr, Handler: securityHeaders(admission.wrap(mux)), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("YNX Exchange testnet venue listening on %s", addr)
	log.Fatal(server.ListenAndServe())
}

type rateWindow struct {
	count int
	reset time.Time
}

// admissionStore is deliberately separate from order state. Rate-limit keys
// are hashed before persistence, so client addresses are never stored in raw
// form or emitted in logs. A PostgreSQL store makes the limit global across
// Exchange instances; the memory store is used only by isolated unit tests.
type admissionStore interface {
	allow(client string, window time.Duration, limit int) (bool, error)
	close() error
}

type admission struct {
	slots  chan struct{}
	limit  int
	window time.Duration
	store  admissionStore
}

func newAdmission(maxConcurrent, limit int, window time.Duration) *admission {
	return &admission{slots: make(chan struct{}, maxConcurrent), limit: limit, window: window, store: &memoryAdmissionStore{now: time.Now, clients: map[string]rateWindow{}}}
}

func newPostgresAdmission(maxConcurrent, limit int, window time.Duration, databaseURL string) (*admission, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("PostgreSQL admission requires YNX_EXCHANGE_DATABASE_URL")
	}
	if maxConcurrent <= 0 || limit <= 0 || window < time.Second || window%time.Second != 0 {
		return nil, errors.New("invalid Exchange admission limits")
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open PostgreSQL admission store: %w", err)
	}
	db.SetConnMaxLifetime(15 * time.Minute)
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping PostgreSQL admission store: %w", err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS ynx_exchange_admission_windows (
		client_hash TEXT NOT NULL,
		window_start TIMESTAMPTZ NOT NULL,
		requests INTEGER NOT NULL CHECK (requests > 0),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
		PRIMARY KEY (client_hash, window_start)
	)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate PostgreSQL admission store: %w", err)
	}
	return &admission{slots: make(chan struct{}, maxConcurrent), limit: limit, window: window, store: &postgresAdmissionStore{db: db}}, nil
}

func (a *admission) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client := requestClient(r)
		allowed, err := a.allow(client)
		if err != nil {
			http.Error(w, "admission service unavailable", http.StatusServiceUnavailable)
			return
		}
		if !allowed {
			w.Header().Set("Retry-After", "60")
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		select {
		case a.slots <- struct{}{}:
			defer func() { <-a.slots }()
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			http.Error(w, "service busy", http.StatusServiceUnavailable)
		}
	})
}

func (a *admission) allow(client string) (bool, error) {
	return a.store.allow(client, a.window, a.limit)
}

func (a *admission) Close() error {
	if a == nil || a.store == nil {
		return nil
	}
	return a.store.close()
}

type memoryAdmissionStore struct {
	now     func() time.Time
	mu      sync.Mutex
	clients map[string]rateWindow
}

func (s *memoryAdmissionStore) allow(client string, window time.Duration, limit int) (bool, error) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.clients[client]
	if !ok || !now.Before(entry.reset) {
		s.clients[client] = rateWindow{count: 1, reset: now.Add(window)}
		return true, nil
	}
	if entry.count >= limit {
		return false, nil
	}
	entry.count++
	s.clients[client] = entry
	return true, nil
}

func (s *memoryAdmissionStore) close() error { return nil }

type postgresAdmissionStore struct{ db *sql.DB }

func (s *postgresAdmissionStore) allow(client string, window time.Duration, limit int) (bool, error) {
	if client == "" || window < time.Second || window%time.Second != 0 || limit <= 0 {
		return false, errors.New("invalid Exchange admission request")
	}
	digest := sha256.Sum256([]byte("ynx-exchange-admission-v1\x00" + client))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var requests int
	err := s.db.QueryRowContext(ctx, `WITH current_window AS (
		SELECT to_timestamp(floor(extract(epoch FROM statement_timestamp()) / $2) * $2) AS window_start
	), allowed AS (
		INSERT INTO ynx_exchange_admission_windows (client_hash, window_start, requests, updated_at)
		SELECT $1, window_start, 1, statement_timestamp() FROM current_window
		ON CONFLICT (client_hash, window_start) DO UPDATE
		SET requests = ynx_exchange_admission_windows.requests + 1, updated_at = statement_timestamp()
		WHERE ynx_exchange_admission_windows.requests < $3
		RETURNING requests
	)
	SELECT requests FROM allowed`, hex.EncodeToString(digest[:]), int64(window/time.Second), limit).Scan(&requests)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("consume PostgreSQL admission window: %w", err)
	}
	return requests > 0 && requests <= limit, nil
}

func (s *postgresAdmissionStore) close() error { return s.db.Close() }

func requestClient(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); net.ParseIP(forwarded) != nil {
			return forwarded
		}
	}
	if ip != nil {
		return ip.String()
	}
	return "unknown"
}

func env(k, v string) string {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		return x
	}
	return v
}
func envInt(k string, v int) int {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		if n, e := strconv.Atoi(x); e == nil {
			return n
		}
	}
	return v
}
func envInt64(k string, v int64) int64 {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		if n, e := strconv.ParseInt(x, 10, 64); e == nil {
			return n
		}
	}
	return v
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
func spa(root http.FileSystem) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, err := root.Open(r.URL.Path)
		if err == nil {
			if info, e := f.Stat(); e == nil && !info.IsDir() {
				f.Close()
				http.FileServer(root).ServeHTTP(w, r)
				return
			}
			f.Close()
		}
		r.URL.Path = "/"
		http.FileServer(root).ServeHTTP(w, r)
	})
}
