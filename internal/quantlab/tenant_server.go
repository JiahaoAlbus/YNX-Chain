package quantlab

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

const TenantHeader = "X-YNX-Tenant-ID"

var tenantIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// TenantServer gives every browser/device an isolated, restart-persistent
// research, Paper, Testnet and audit state while sharing only stateless market
// and Wallet/Exchange adapters. Tenant IDs are 256-bit unguessable device
// bindings; Wallet and order signatures remain independently mandatory.
type TenantServer struct {
	mu                 sync.Mutex
	config             Config
	role               string
	root               string
	base               http.Handler
	baseService        *Service
	paperMappings      *Service
	servers            map[string]*Server
	maxOpen            int
	financeRead        *readintegration.Verifier
	financeConcurrency chan struct{}
}

func NewTenantServer(config Config, role string) (*TenantServer, error) {
	if config.Now == nil {
		config.Now = func() time.Time { return time.Now().UTC() }
	}
	base, err := New(config)
	if err != nil {
		return nil, err
	}
	root := ""
	if config.DatabaseURL == "" {
		root = config.StatePath + ".tenants"
		if err := os.MkdirAll(root, 0o700); err != nil {
			_ = base.Close()
			return nil, err
		}
		if err := os.Chmod(root, 0o700); err != nil {
			_ = base.Close()
			return nil, err
		}
	}
	server := &TenantServer{config: config, role: role, root: root, base: NewRoleServer(base, role), baseService: base, servers: map[string]*Server{}, maxOpen: 1024, financeConcurrency: make(chan struct{}, 16)}
	base.cfg.browserBindings = base
	base.cfg.ownedRecords = server.financePayload
	base.cfg.paperWorkspace = server.paperWorkspace
	if strings.TrimSpace(config.FinanceReadKey) != "" {
		server.financeRead, err = readintegration.NewVerifier(strings.TrimSpace(config.FinanceReadKey), "finance", "quant", config.Now)
		if err != nil {
			_ = base.Close()
			return nil, err
		}
		if store, ok := base.store.(*postgresStateStore); ok {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := store.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS ynx_quant_finance_read_nonces (
				nonce TEXT PRIMARY KEY,
				expires_at TIMESTAMPTZ NOT NULL
			)`); err != nil {
				_ = base.Close()
				return nil, err
			}
			if _, err := store.db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS ynx_quant_finance_read_nonces_expiry ON ynx_quant_finance_read_nonces (expires_at)`); err != nil {
				_ = base.Close()
				return nil, err
			}
		}
	}
	return server, nil
}

func (s *TenantServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Identity status/logout and separately scoped account-owned records never
	// allocate/authorize a tenant. Records use the existing account filter only.
	if r.URL.Path == "/v1/sso/config" || r.URL.Path == "/v1/sso/account" || r.URL.Path == "/v1/sso/logout" || r.URL.Path == "/v1/wallet/private-records" || privatePaperRequest(r) {
		s.base.ServeHTTP(w, r)
		return
	}
	// Public research is stateless and must not create a durable tenant, expose
	// a legacy workspace, or mistake reverse-proxy loopback for local authority.
	if publicResearchRequest(r) || r.Method == http.MethodGet && r.URL.Path == "/v1/public/status" {
		s.base.ServeHTTP(w, r)
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/v1/snapshot" && !localPreviewRequest(r) {
		write(w, http.StatusOK, map[string]any{"strategies": map[string]any{}, "experiments": map[string]any{}, "paper": map[string]any{}, "audit": []any{}, "access": map[string]bool{"statefulPreview": false}})
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == FinanceReadRoute {
		s.financeAccount(w, r)
		return
	}
	// Operational diagnostics are service-level reads, not workspace access.
	// Clients may attach their usual tenant header; it must not allocate a new
	// tenant (or expose that tenant's private risk state) merely to probe health.
	if r.Method == http.MethodGet && (r.URL.Path == "/health" || r.URL.Path == "/ready" || r.URL.Path == "/version" || r.URL.Path == "/metrics") {
		s.base.ServeHTTP(w, r)
		return
	}
	id := r.Header.Get(TenantHeader)
	if !tenantIDPattern.MatchString(id) {
		writeTenantError(w, http.StatusUnauthorized, "tenant_binding_required")
		return
	}
	handler, err := s.tenant(id)
	if err != nil {
		writeTenantError(w, http.StatusServiceUnavailable, "tenant_capacity_unavailable")
		return
	}
	handler.ServeHTTP(w, r)
}

// StartScheduler preserves the running public service's research-only schedule
// behavior. It does not submit Paper or Testnet orders.
func (s *TenantServer) StartScheduler(ctx context.Context, interval time.Duration) <-chan struct{} {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.refreshScheduledTenants(ctx); err != nil {
					log.Print("Quant research schedule discovery unavailable; waiting for next tick")
					continue
				}
				s.mu.Lock()
				services := make([]*Service, 0, len(s.servers))
				for _, server := range s.servers {
					services = append(services, server.service)
				}
				s.mu.Unlock()
				for _, service := range services {
					if ctx.Err() != nil {
						return
					}
					_, _ = service.RunDueSchedulesContext(ctx)
				}
			}
		}
	}()
	return done
}

func (s *TenantServer) tenant(id string) (http.Handler, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if server := s.servers[id]; server != nil {
		return server, nil
	}
	if len(s.servers) >= s.maxOpen {
		return nil, ErrUnavailable
	}
	config := s.config
	// A session cannot evade a revoked association by selecting another tenant.
	config.browserBindings = s.baseService
	if config.DatabaseURL == "" {
		config.StatePath = filepath.Join(s.root, id+".json")
	} else {
		config.StateNamespace = config.StateNamespace + ":tenant:" + id
		if baseStore, ok := s.baseService.store.(*postgresStateStore); ok {
			config.sharedDatabase = baseStore.db
		}
	}
	service, err := New(config)
	if err != nil {
		return nil, err
	}
	server := NewRoleServer(service, s.role)
	s.servers[id] = server
	return server, nil
}

func (s *TenantServer) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var first error
	if s.paperMappings != nil {
		if err := s.paperMappings.Close(); err != nil {
			first = err
		}
	}
	for _, server := range s.servers {
		if err := server.service.Close(); err != nil && first == nil {
			first = err
		}
	}
	if err := s.baseService.Close(); err != nil && first == nil {
		first = err
	}
	return first
}

func writeTenantError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}
