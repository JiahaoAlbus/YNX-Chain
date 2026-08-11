package quantlab

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
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

type financeQuantPayload struct {
	Product        string              `json:"product"`
	ProductVersion string              `json:"productVersion"`
	BuildCommit    string              `json:"buildCommit"`
	Strategies     []financeStrategy   `json:"strategies"`
	Experiments    []financeExperiment `json:"experiments"`
	Mandates       []financeMandate    `json:"mandates"`
	Executions     []TestnetOrder      `json:"executions"`
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
	payload, err := s.financePayload(account)
	if err != nil {
		writeTenantError(w, http.StatusServiceUnavailable, "finance_read_state_unavailable")
		return
	}
	now := s.config.Now().UTC()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = json.NewEncoder(w).Encode(map[string]any{"envelopeVersion": FinanceReadEnvelopeVersion, "sourceId": "quant", "owner": "08-quant-lab", "network": "ynx_6423-1", "nativeAsset": "YNXT", "authorizedAccount": account, "ownerContractVersion": FinanceReadContractVersion, "payloadSchema": FinanceReadPayloadSchema, "asOf": now, "asOfKind": "quant-tenant-states-observed-at", "coverage": "authorized strategies, mandates, research attribution, bounded executions, PnL and risk limits", "syncStatus": "authoritative-persisted-quant-state", "readOnly": true, "capabilities": append([]string(nil), FinanceReadCapabilities...), "payload": payload})
}

func (s *TenantServer) financePayload(account string) (financeQuantPayload, error) {
	result := financeQuantPayload{Product: ProductID, ProductVersion: Version, BuildCommit: BuildCommit, Strategies: []financeStrategy{}, Experiments: []financeExperiment{}, Mandates: []financeMandate{}, Executions: []TestnetOrder{}, Paper: []financePaperState{}}
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return result, err
	}
	if len(entries) > 4096 {
		return result, ErrUnavailable
	}
	strategySeen, experimentSeen, mandateSeen, executionSeen := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
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
			return result, lockErr
		}
		matched := false
		for digest, mandate := range service.state.Mandates {
			if mandate.Account != account {
				continue
			}
			matched = true
			if !mandateSeen[digest] {
				result.Mandates = append(result.Mandates, financeMandate{Digest: digest, StrategyHash: mandate.StrategyHash, Market: mandate.Market, Scope: mandate.Scope, MaxNotional: mandate.MaxNotional, MaxPosition: mandate.MaxPosition, MaxDailyLoss: mandate.MaxDailyLoss, MaxSlippageBPS: mandate.MaxSlippageBPS, MaxLeverageBPS: mandate.MaxLeverageBPS, MaxDrawdown: mandate.MaxDrawdown, MaxVaR: mandate.MaxVaR, MaxExpectedShortfall: mandate.MaxExpectedShortfall, ExpiresAt: mandate.ExpiresAt, Revoked: mandate.Revoked, RevokedAt: mandate.RevokedAt})
				mandateSeen[digest] = true
			}
			for _, strategy := range service.state.Strategies {
				if strategy.StrategyHash == mandate.StrategyHash && !strategySeen[strategy.StrategyHash] {
					result.Strategies = append(result.Strategies, financeStrategy{ID: strategy.ID, Name: strategy.Name, Family: strategy.Family, Stage: strategy.Stage, StrategyHash: strategy.StrategyHash, ModelHash: strategy.ModelHash, DataHash: strategy.DataHash, Params: cloneParams(strategy.Params), Limitations: strategy.Limitations, CreatedAt: strategy.CreatedAt})
					strategySeen[strategy.StrategyHash] = true
				}
			}
			for id, experiment := range service.state.Experiments {
				if experiment.Strategy.StrategyHash == mandate.StrategyHash && !experimentSeen[id] {
					metrics := experiment.Metrics
					result.Experiments = append(result.Experiments, financeExperiment{ID: experiment.ID, StrategyHash: experiment.Strategy.StrategyHash, StrategyName: experiment.Strategy.Name, Stage: experiment.Strategy.Stage, Status: experiment.Status, Metrics: financeMetrics{ReturnBPS: metrics.ReturnBPS, BuyHoldBPS: metrics.BuyHoldBPS, MaxDrawdownBPS: metrics.MaxDrawdownBPS, Trades: metrics.Trades, PartialFills: metrics.PartialFills, DataGaps: metrics.DataGaps, NoTrade: metrics.NoTrade}, Attribution: experiment.Attribution, LeakageChecksPassed: experiment.LeakageChecksPassed, AuditDigest: experiment.AuditDigest, CreatedAt: experiment.CreatedAt})
					experimentSeen[id] = true
				}
			}
			for id, order := range service.state.TestnetOrders {
				if order.MandateDigest == digest && !executionSeen[id] {
					order.WalletSignature = ""
					result.Executions = append(result.Executions, order)
					executionSeen[id] = true
				}
			}
		}
		if matched {
			paper := service.state.Paper
			result.Paper = append(result.Paper, financePaperState{Cash: paper.Cash, Position: paper.Position, RealizedPnL: paper.RealizedPnL, ReconciliationDelta: paper.ReconciliationDelta, KillSwitch: paper.KillSwitch, UpdatedAt: paper.UpdatedAt})
			result.TenantStates++
		}
		release()
		service.mu.Unlock()
	}
	sort.Slice(result.Mandates, func(i, j int) bool { return result.Mandates[i].Digest < result.Mandates[j].Digest })
	sort.Slice(result.Executions, func(i, j int) bool { return result.Executions[i].CreatedAt.After(result.Executions[j].CreatedAt) })
	sort.Slice(result.Strategies, func(i, j int) bool { return result.Strategies[i].StrategyHash < result.Strategies[j].StrategyHash })
	sort.Slice(result.Experiments, func(i, j int) bool { return result.Experiments[i].CreatedAt.After(result.Experiments[j].CreatedAt) })
	return result, nil
}
