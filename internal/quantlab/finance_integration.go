package quantlab

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

const (
	FinanceReadRoute           = "/v1/integrations/finance/account"
	FinanceReadEnvelopeVersion = "finance-source-read-envelope-v1"
	FinanceReadContractVersion = "quant-finance-read-v1"
	FinanceReadPayloadSchema   = "ynx-quant-finance-account-v1"
)

var FinanceReadCapabilities = []string{"quant.strategies.read", "quant.mandates.read", "quant.executions.read", "quant.pnl.read", "quant.risk.read", "quant.lifecycle.read"}

type financeMandate struct {
	Digest               string    `json:"digest"`
	StrategyHash         string    `json:"strategyHash"`
	Market               string    `json:"market"`
	Scope                string    `json:"scope"`
	MaxNotional          int64     `json:"maxNotional"`
	MaxPosition          int64     `json:"maxPosition"`
	MaxDailyLoss         int64     `json:"maxDailyLoss"`
	MaxSlippageBPS       int64     `json:"maxSlippageBps"`
	MaxLeverageBPS       int64     `json:"maxLeverageBps"`
	MaxDrawdown          int64     `json:"maxDrawdown"`
	MaxVaR               int64     `json:"maxVar"`
	MaxExpectedShortfall int64     `json:"maxExpectedShortfall"`
	ExpiresAt            time.Time `json:"expiresAt"`
	Revoked              bool      `json:"revoked"`
	RevokedAt            time.Time `json:"revokedAt,omitempty"`
}

type financeStrategy struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Family       string           `json:"family"`
	Stage        string           `json:"stage"`
	StrategyHash string           `json:"strategyHash"`
	ModelHash    string           `json:"modelHash"`
	DataHash     string           `json:"dataHash"`
	Params       map[string]int64 `json:"params"`
	Limitations  string           `json:"limitations"`
	CreatedAt    time.Time        `json:"createdAt"`
}

type financeMetrics struct {
	ReturnBPS      int64 `json:"returnBps"`
	BuyHoldBPS     int64 `json:"buyHoldBps"`
	MaxDrawdownBPS int64 `json:"maxDrawdownBps"`
	Trades         int   `json:"trades"`
	PartialFills   int   `json:"partialFills"`
	DataGaps       int   `json:"dataGaps"`
	NoTrade        bool  `json:"noTrade"`
}

type financeExperiment struct {
	ID                  string         `json:"id"`
	StrategyHash        string         `json:"strategyHash"`
	StrategyName        string         `json:"strategyName"`
	Stage               string         `json:"stage"`
	Status              string         `json:"status"`
	Metrics             financeMetrics `json:"metrics"`
	Attribution         PnLAttribution `json:"attribution"`
	LeakageChecksPassed bool           `json:"leakageChecksPassed"`
	AuditDigest         string         `json:"auditDigest"`
	CreatedAt           time.Time      `json:"createdAt"`
}

type financePaperState struct {
	Cash                int64     `json:"cash"`
	Position            int64     `json:"position"`
	RealizedPnL         int64     `json:"realizedPnl"`
	ReconciliationDelta int64     `json:"reconciliationDelta"`
	KillSwitch          bool      `json:"killSwitch"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type financeExecution struct {
	ID            string    `json:"id"`
	MandateDigest string    `json:"mandateDigest"`
	StrategyHash  string    `json:"strategyHash"`
	Market        string    `json:"market"`
	Side          string    `json:"side"`
	Price         int64     `json:"price"`
	Amount        int64     `json:"amount"`
	VenueOrderID  string    `json:"venueOrderId"`
	VenueStatus   string    `json:"venueStatus"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
}

type financeQuantPayload struct {
	Product        string              `json:"product"`
	ProductVersion string              `json:"productVersion"`
	BuildCommit    string              `json:"buildCommit"`
	Strategies     []financeStrategy   `json:"strategies"`
	Experiments    []financeExperiment `json:"experiments"`
	Mandates       []financeMandate    `json:"mandates"`
	Executions     []financeExecution  `json:"executions"`
	Paper          []financePaperState `json:"paper"`
	TenantStates   int                 `json:"tenantStates"`
}

func (s *TenantServer) financeAccount(w http.ResponseWriter, r *http.Request) {
	if s.financeRead == nil {
		writeTenantError(w, http.StatusServiceUnavailable, "finance_read_unavailable")
		return
	}
	select {
	case s.financeConcurrency <- struct{}{}:
		defer func() { <-s.financeConcurrency }()
	default:
		writeTenantError(w, http.StatusServiceUnavailable, "finance_read_capacity")
		return
	}
	account, err := s.financeRead.Verify(r, FinanceReadRoute)
	if err != nil {
		writeTenantError(w, http.StatusUnauthorized, "invalid_read_credential")
		return
	}
	account, err = nativewallet.NormalizeNativeAddress(account)
	if err != nil {
		writeTenantError(w, http.StatusUnauthorized, "invalid_read_account")
		return
	}
	if ok, err := s.claimFinanceReadNonce(r.Header.Get(readintegration.HeaderNonce)); err != nil || !ok {
		writeTenantError(w, http.StatusServiceUnavailable, "finance_read_replay_protection_unavailable")
		return
	}
	payload, err := s.financePayload(account)
	if err != nil {
		writeTenantError(w, http.StatusServiceUnavailable, "finance_read_state_unavailable")
		return
	}
	if payload.TenantStates == 0 {
		writeTenantError(w, http.StatusNotFound, "finance_read_account_not_found")
		return
	}
	now := s.config.Now().UTC()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = json.NewEncoder(w).Encode(map[string]any{"envelopeVersion": FinanceReadEnvelopeVersion, "sourceId": "quant", "owner": "08-quant-lab", "network": "ynx_6423-1", "nativeAsset": "YNXT", "authorizedAccount": account, "ownerContractVersion": FinanceReadContractVersion, "payloadSchema": FinanceReadPayloadSchema, "asOf": now, "asOfKind": "quant-tenant-states-observed-at", "coverage": "authorized strategies, mandates, research attribution, bounded executions, PnL and risk limits", "syncStatus": "authoritative-persisted-quant-state", "readOnly": true, "capabilities": append([]string(nil), FinanceReadCapabilities...), "payload": payload})
}

func (s *TenantServer) claimFinanceReadNonce(nonce string) (bool, error) {
	store, ok := s.baseService.store.(*postgresStateStore)
	if !ok {
		// The filesystem tenant store is single-host; the verifier consumes
		// its nonce. PostgreSQL shares claims across all serving instances.
		return true, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_finance_read_nonces WHERE nonce IN (
		SELECT nonce FROM ynx_quant_finance_read_nonces WHERE expires_at < NOW() ORDER BY expires_at LIMIT 64
	)`); err != nil {
		return false, err
	}
	result, err := store.db.ExecContext(ctx, `INSERT INTO ynx_quant_finance_read_nonces (nonce, expires_at) VALUES ($1, NOW() + INTERVAL '1 minute') ON CONFLICT (nonce) DO NOTHING`, nonce)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s *TenantServer) financePayload(account string) (financeQuantPayload, error) {
	result := financeQuantPayload{Product: ProductID, ProductVersion: Version, BuildCommit: BuildCommit, Strategies: []financeStrategy{}, Experiments: []financeExperiment{}, Mandates: []financeMandate{}, Executions: []financeExecution{}, Paper: []financePaperState{}}
	seen := financeSeen{strategies: map[string]bool{}, experiments: map[string]bool{}, mandates: map[string]bool{}, executions: map[string]bool{}}
	if s.config.DatabaseURL != "" {
		store, ok := s.baseService.store.(*postgresStateStore)
		if !ok {
			return result, ErrUnavailable
		}
		prefix := s.config.StateNamespace + ":tenant:"
		upperBound := s.config.StateNamespace + ":tenant;"
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		rows, err := store.db.QueryContext(ctx, `SELECT state_key, revision, payload FROM ynx_quant_state WHERE state_key >= $1 AND state_key < $2 ORDER BY state_key LIMIT 4097`, prefix, upperBound)
		if err != nil {
			return result, err
		}
		defer rows.Close()
		count := 0
		for rows.Next() {
			count++
			if count > 4096 {
				return result, ErrUnavailable
			}
			var key string
			var revision int64
			var raw []byte
			if err := rows.Scan(&key, &revision, &raw); err != nil {
				return result, err
			}
			if !tenantIDPattern.MatchString(strings.TrimPrefix(key, prefix)) || len(key) != len(prefix)+64 {
				continue
			}
			var snapshot state
			if json.Unmarshal(raw, &snapshot) != nil || !verifyStateBytes(raw, snapshot) {
				return result, ErrUnavailable
			}
			snapshot.Revision = revision
			normalizeQuantState(&snapshot)
			appendFinanceState(&result, account, snapshot, &seen)
		}
		if err := rows.Err(); err != nil {
			return result, err
		}
		sortFinancePayload(&result)
		return result, nil
	}
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return result, err
	}
	if len(entries) > 4096 {
		return result, ErrUnavailable
	}
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(s.root, entry.Name())
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			continue
		}
		cfg := s.config
		cfg.StatePath = path
		service, openErr := New(cfg)
		if openErr != nil {
			return result, openErr
		}
		service.mu.Lock()
		release, lockErr := service.lockAndReload()
		if lockErr != nil {
			service.mu.Unlock()
			_ = service.Close()
			return result, lockErr
		}
		appendFinanceState(&result, account, service.state, &seen)
		release()
		service.mu.Unlock()
		_ = service.Close()
	}
	sortFinancePayload(&result)
	return result, nil
}

type financeSeen struct {
	strategies  map[string]bool
	experiments map[string]bool
	mandates    map[string]bool
	executions  map[string]bool
}

func appendFinanceState(result *financeQuantPayload, account string, snapshot state, seen *financeSeen) {
	matched := false
	for digest, mandate := range snapshot.Mandates {
		if mandate.Account != account {
			continue
		}
		matched = true
		if !seen.mandates[digest] {
			result.Mandates = append(result.Mandates, financeMandate{Digest: digest, StrategyHash: mandate.StrategyHash, Market: mandate.Market, Scope: mandate.Scope, MaxNotional: mandate.MaxNotional, MaxPosition: mandate.MaxPosition, MaxDailyLoss: mandate.MaxDailyLoss, MaxSlippageBPS: mandate.MaxSlippageBPS, MaxLeverageBPS: mandate.MaxLeverageBPS, MaxDrawdown: mandate.MaxDrawdown, MaxVaR: mandate.MaxVaR, MaxExpectedShortfall: mandate.MaxExpectedShortfall, ExpiresAt: mandate.ExpiresAt, Revoked: mandate.Revoked, RevokedAt: mandate.RevokedAt})
			seen.mandates[digest] = true
		}
		for _, strategy := range snapshot.Strategies {
			if strategy.StrategyHash == mandate.StrategyHash && !seen.strategies[strategy.StrategyHash] {
				result.Strategies = append(result.Strategies, financeStrategy{ID: strategy.ID, Name: strategy.Name, Family: strategy.Family, Stage: strategy.Stage, StrategyHash: strategy.StrategyHash, ModelHash: strategy.ModelHash, DataHash: strategy.DataHash, Params: cloneParams(strategy.Params), Limitations: strategy.Limitations, CreatedAt: strategy.CreatedAt})
				seen.strategies[strategy.StrategyHash] = true
			}
		}
		for id, experiment := range snapshot.Experiments {
			if experiment.Strategy.StrategyHash == mandate.StrategyHash && !seen.experiments[id] {
				metrics := experiment.Metrics
				result.Experiments = append(result.Experiments, financeExperiment{ID: experiment.ID, StrategyHash: experiment.Strategy.StrategyHash, StrategyName: experiment.Strategy.Name, Stage: experiment.Strategy.Stage, Status: experiment.Status, Metrics: financeMetrics{ReturnBPS: metrics.ReturnBPS, BuyHoldBPS: metrics.BuyHoldBPS, MaxDrawdownBPS: metrics.MaxDrawdownBPS, Trades: metrics.Trades, PartialFills: metrics.PartialFills, DataGaps: metrics.DataGaps, NoTrade: metrics.NoTrade}, Attribution: experiment.Attribution, LeakageChecksPassed: experiment.LeakageChecksPassed, AuditDigest: experiment.AuditDigest, CreatedAt: experiment.CreatedAt})
				seen.experiments[id] = true
			}
		}
		for id, order := range snapshot.TestnetOrders {
			if order.MandateDigest == digest && !seen.executions[id] {
				result.Executions = append(result.Executions, financeExecution{ID: order.ID, MandateDigest: order.MandateDigest, StrategyHash: order.StrategyHash, Market: order.Market, Side: order.Side, Price: order.Price, Amount: order.Amount, VenueOrderID: order.VenueOrderID, VenueStatus: order.VenueStatus, Status: order.Status, CreatedAt: order.CreatedAt})
				seen.executions[id] = true
			}
		}
	}
	if matched {
		paper := snapshot.Paper
		result.Paper = append(result.Paper, financePaperState{Cash: paper.Cash, Position: paper.Position, RealizedPnL: paper.RealizedPnL, ReconciliationDelta: paper.ReconciliationDelta, KillSwitch: paper.KillSwitch, UpdatedAt: paper.UpdatedAt})
		result.TenantStates++
	}
}

func sortFinancePayload(result *financeQuantPayload) {
	sort.Slice(result.Mandates, func(i, j int) bool { return result.Mandates[i].Digest < result.Mandates[j].Digest })
	sort.Slice(result.Executions, func(i, j int) bool { return result.Executions[i].CreatedAt.After(result.Executions[j].CreatedAt) })
	sort.Slice(result.Strategies, func(i, j int) bool { return result.Strategies[i].StrategyHash < result.Strategies[j].StrategyHash })
	sort.Slice(result.Experiments, func(i, j int) bool { return result.Experiments[i].CreatedAt.After(result.Experiments[j].CreatedAt) })
}
