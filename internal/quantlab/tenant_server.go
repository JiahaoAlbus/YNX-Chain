package quantlab

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

const TenantHeader = "X-YNX-Tenant-ID"

var tenantIDPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// TenantServer gives every browser/device an isolated, restart-persistent
// research, Paper, Testnet and audit state while sharing only stateless market
// and Wallet/Exchange adapters. Tenant IDs are 256-bit unguessable device
// bindings; Wallet and order signatures remain independently mandatory.
type TenantServer struct {
	mu          sync.Mutex
	config      Config
	role        string
	root        string
	base        http.Handler
	baseService *Service
	servers     map[string]*Server
	maxOpen     int
}

func NewTenantServer(config Config, role string) (*TenantServer, error) {
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
	return &TenantServer{config: config, role: role, root: root, base: NewRoleServer(base, role), baseService: base, servers: map[string]*Server{}, maxOpen: 1024}, nil
}

func (s *TenantServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && (r.URL.Path == "/health" || r.URL.Path == "/ready" || r.URL.Path == "/version" || r.URL.Path == "/metrics") && r.Header.Get(TenantHeader) == "" {
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
	if server := s.servers[id]; server != nil {
		return server, nil
	}
	if len(s.servers) >= s.maxOpen {
		return nil, ErrUnavailable
	}
	config := s.config
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
