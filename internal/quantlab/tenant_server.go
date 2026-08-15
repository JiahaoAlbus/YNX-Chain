package quantlab

import (
	"context"
	"encoding/json"
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
	mu                      sync.Mutex
	config                  Config
	role                    string
	root                    string
	base                    http.Handler
	servers                 map[string]tenantRuntime
	maxOpen                 int
	financeRead             *readintegration.Verifier
	financeConcurrency      chan struct{}
	testnetExecutionEnabled bool
}

type tenantRuntime struct {
	service *Service
	handler http.Handler
}

func NewTenantServer(config Config, role string) (*TenantServer, error) {
	return newTenantServer(config, role, true)
}

// NewProductionTenantServer binds the custody gate to both the public base
// server and each isolated tenant runtime.
func NewProductionTenantServer(config Config, role string, executionEnabled bool) (*TenantServer, error) {
	return newTenantServer(config, role, executionEnabled)
}

func newTenantServer(config Config, role string, executionEnabled bool) (*TenantServer, error) {
	if config.Now == nil {
		config.Now = func() time.Time { return time.Now().UTC() }
	}
	base, err := New(config)
	if err != nil {
		return nil, err
	}
	root := config.StatePath + ".tenants"
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return nil, err
	}
	server := &TenantServer{config: config, role: role, root: root, base: NewProductionRoleServer(base, role, executionEnabled), servers: map[string]tenantRuntime{}, maxOpen: 1024, financeConcurrency: make(chan struct{}, 16), testnetExecutionEnabled: executionEnabled}
	if strings.TrimSpace(config.FinanceReadKey) != "" {
		server.financeRead, err = readintegration.NewVerifier(strings.TrimSpace(config.FinanceReadKey), "finance", "quant", config.Now)
		if err != nil {
			return nil, err
		}
	}
	return server, nil
}

func (s *TenantServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && r.URL.Path == FinanceReadRoute {
		s.financeAccount(w, r)
		return
	}
	if r.Method == http.MethodGet && (r.URL.Path == "/health" || r.URL.Path == "/version" || r.URL.Path == "/metrics") && r.Header.Get(TenantHeader) == "" {
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

func (s *TenantServer) tenant(id string) (http.Handler, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if runtime, exists := s.servers[id]; exists {
		return runtime.handler, nil
	}
	if len(s.servers) >= s.maxOpen {
		return nil, ErrUnavailable
	}
	config := s.config
	config.StatePath = filepath.Join(s.root, id+".json")
	service, err := New(config)
	if err != nil {
		return nil, err
	}
	server := NewProductionRoleServer(service, s.role, s.testnetExecutionEnabled)
	s.servers[id] = tenantRuntime{service: service, handler: server}
	return server, nil
}

// StartScheduler runs persisted research schedules for every active tenant.
// Claims are protected by the same cross-process state lock as user writes, so
// a second server instance cannot execute the same due run.
func (s *TenantServer) StartScheduler(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.mu.Lock()
				services := make([]*Service, 0, len(s.servers))
				for _, runtime := range s.servers {
					services = append(services, runtime.service)
				}
				s.mu.Unlock()
				for _, service := range services {
					_, _ = service.RunDueSchedules()
				}
			}
		}
	}()
}

func writeTenantError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}
