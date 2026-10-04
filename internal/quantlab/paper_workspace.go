package quantlab

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const quantPaperWorkspaceScope = "quant:paper:workspace"

// Durable data ownership, not a bearer tenant capability or identity issuer.
type paperWorkspaceBinding struct {
	Account   string    `json:"account"`
	TenantID  string    `json:"tenantId"`
	CreatedAt time.Time `json:"createdAt"`
}

func privatePaperRequest(r *http.Request) bool {
	return r.Method == http.MethodGet && r.URL.Path == "/v1/wallet/paper/snapshot" || r.Method == http.MethodPost && (r.URL.Path == "/v1/wallet/paper/backtests/from-market" || r.URL.Path == "/v1/wallet/paper/orders" || r.URL.Path == "/v1/wallet/paper/risk/kill" || r.URL.Path == "/v1/wallet/paper/risk/reconcile")
}

func (s *TenantServer) paperWorkspace(account string) (*Service, error) {
	root, err := s.paperMappingStore()
	if err != nil {
		return nil, err
	}
	root.mu.Lock()
	release, err := root.lockAndReload()
	if err != nil {
		root.mu.Unlock()
		return nil, err
	}
	key := hashBytes([]byte("YNX Quant Paper workspace v1\x00" + account))
	binding, exists := root.state.PaperWorkspaceBindings[key]
	if exists && (binding.Account != account || !tenantIDPattern.MatchString(binding.TenantID) || binding.CreatedAt.IsZero()) {
		release()
		root.mu.Unlock()
		return nil, ErrUnavailable
	}
	if !exists {
		previous := root.state
		if len(root.state.PaperWorkspaceBindings) >= 10000 {
			release()
			root.mu.Unlock()
			return nil, ErrUnavailable
		}
		var random [32]byte
		if _, err = rand.Read(random[:]); err != nil {
			release()
			root.mu.Unlock()
			return nil, err
		}
		binding = paperWorkspaceBinding{account, hex.EncodeToString(random[:]), root.cfg.Now()}
		next := make(map[string]paperWorkspaceBinding, len(root.state.PaperWorkspaceBindings)+1)
		for key, value := range root.state.PaperWorkspaceBindings {
			next[key] = value
		}
		root.state.PaperWorkspaceBindings = next
		root.state.PaperWorkspaceBindings[key] = binding
		root.audit("paper_workspace_bound", key, hashBytes([]byte(binding.TenantID)))
		if err = root.save(); err != nil {
			if !errors.Is(err, ErrConflict) {
				root.state = previous
			}
			release()
			root.mu.Unlock()
			return nil, err
		}
	}
	release()
	root.mu.Unlock()
	handler, err := s.tenant(binding.TenantID)
	if err != nil {
		return nil, err
	}
	server, ok := handler.(*Server)
	if !ok {
		return nil, ErrUnavailable
	}
	return server.service, nil
}

// Ownership is isolated from every existing root/tenant data envelope. Reuse
// the original atomic file lock/CAS store, with a distinct path/DB namespace;
// an old binary never opens this sidecar and can still read original history.
// Initialize only after the server verified the independent Paper scope.
func (s *TenantServer) paperMappingStore() (*Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.paperMappings != nil {
		return s.paperMappings, nil
	}
	config := s.baseService.cfg
	if strings.TrimSpace(config.StatePath) == "" {
		return nil, ErrUnavailable
	}
	config.StatePath += ".paper-workspaces"
	config.StateNamespace += ":paper-workspaces:v1"
	config.PrivateSession = nil
	config.paperWorkspace = nil
	config.browserBindings = nil
	config.ownedRecords = nil
	if store, ok := s.baseService.store.(*postgresStateStore); ok {
		config.sharedDatabase = store.db
	}
	created, err := New(config)
	if err != nil {
		return nil, err
	}
	s.paperMappings = created
	return created, nil
}

func (s *Server) privatePaper(w http.ResponseWriter, r *http.Request) {
	if !privatePaperRequest(r) || s.service.cfg.PrivateSession == nil || s.service.cfg.paperWorkspace == nil {
		writeProblem(w, r, 503, "paper_workspace_unavailable")
		return
	}
	// No submitted account, tenant header or central identity grants this scope.
	session, err := s.service.cfg.PrivateSession.Authorize(r.Context(), r, []string{quantPaperWorkspaceScope})
	if err != nil {
		var auth *productsessionv2.Error
		if errors.As(err, &auth) {
			writeProblem(w, r, auth.Status, auth.Code)
		} else {
			writeProblem(w, r, 503, "paper_authorization_unavailable")
		}
		return
	}
	if status := s.authorizeBrowserSSO(r, session); status != 200 {
		writeProblem(w, r, status, "browser_identity_binding_unavailable")
		return
	}
	workspace, err := s.service.cfg.paperWorkspace(session.Account)
	if err != nil {
		writeProblem(w, r, 503, "paper_workspace_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	switch r.URL.Path {
	case "/v1/wallet/paper/snapshot":
		source := workspace.Snapshot()
		if source["failure"] != nil {
			writeProblem(w, r, 503, "paper_workspace_unavailable")
			return
		}
		audit := []AuditEvent{}
		for _, event := range source["audit"].([]AuditEvent) {
			if strings.HasPrefix(event.Action, "paper_order_") || strings.Contains(event.Action, "backtest") || event.Action == "paper_reconciled" || event.Action == "kill_switch_activated" {
				audit = append(audit, event)
			}
		}
		write(w, 200, map[string]any{"account": session.Account, "sessionBinding": session.SessionBinding, "strategies": source["strategies"], "experiments": source["experiments"], "paper": source["paper"], "audit": audit, "access": map[string]bool{"statefulPreview": false, "paperWorkspaceAuthorized": true, "nativeExecutionEnabled": false, "scheduleAuthorized": false}})
	case "/v1/wallet/paper/backtests/from-market":
		var input struct {
			Strategy       StrategySpec `json:"strategy"`
			Assumptions    Assumptions  `json:"assumptions"`
			IdempotencyKey string       `json:"idempotencyKey"`
		}
		if !decode(w, r, &input) {
			return
		}
		result, err := workspace.RunBacktestFromMarketOnceContext(r.Context(), input.Strategy, input.Assumptions, input.IdempotencyKey)
		if err != nil {
			respond(w, r, nil, err, 201)
			return
		}
		paperOwnedResult(w, r, session, result, 201)
	case "/v1/wallet/paper/orders":
		var input struct {
			StrategyHash   string          `json:"strategyHash"`
			Side           string          `json:"side"`
			Amount         int64           `json:"amount"`
			IdempotencyKey string          `json:"idempotencyKey"`
			ExecutionCosts json.RawMessage `json:"executionCosts"`
		}
		if !decode(w, r, &input) {
			return
		}
		costs, err := decodePaperExecutionCosts(input.ExecutionCosts)
		if err != nil {
			writeProblem(w, r, http.StatusBadRequest, "invalid_json")
			return
		}
		result, err := workspace.SubmitPaperSignalWithCostsFromMarket(input.StrategyHash, input.Side, input.Amount, input.IdempotencyKey, costs)
		if err != nil {
			respond(w, r, nil, err, 201)
			return
		}
		paperOwnedResult(w, r, session, result, 201)
	case "/v1/wallet/paper/risk/kill", "/v1/wallet/paper/risk/reconcile":
		var key, reason string
		var cash, position int64
		action := "kill"
		if strings.HasSuffix(r.URL.Path, "/kill") {
			var input struct {
				Reason         string `json:"reason"`
				IdempotencyKey string `json:"idempotencyKey"`
			}
			if !decode(w, r, &input) {
				return
			}
			key, reason = input.IdempotencyKey, input.Reason
		} else {
			action = "reconcile"
			var input struct {
				Cash           *int64 `json:"cash"`
				Position       *int64 `json:"position"`
				IdempotencyKey string `json:"idempotencyKey"`
			}
			if !decode(w, r, &input) {
				return
			}
			if input.Cash == nil || input.Position == nil {
				writeProblem(w, r, 400, "invalid_request")
				return
			}
			key, cash, position = input.IdempotencyKey, *input.Cash, *input.Position
		}
		result, err := workspace.submitPaperRisk(action, key, reason, cash, position)
		if err != nil {
			respond(w, r, nil, err, 201)
			return
		}
		paperOwnedResult(w, r, session, result, 201)
	}
}

func paperOwnedResult(w http.ResponseWriter, r *http.Request, session productsessionv2.Session, result any, status int) {
	// Preserve the original result fields, with a verified owner receipt beside
	// them. Never expose the random internal tenant as a client credential.
	encoded, err := json.Marshal(result)
	if err != nil {
		writeProblem(w, r, 503, "paper_result_unavailable")
		return
	}
	var payload map[string]any
	if json.Unmarshal(encoded, &payload) != nil {
		writeProblem(w, r, 503, "paper_result_unavailable")
		return
	}
	payload["account"], payload["sessionBinding"] = session.Account, session.SessionBinding
	write(w, status, payload)
}
