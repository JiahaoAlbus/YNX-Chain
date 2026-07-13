package api

import (
	"bytes"
	"compress/gzip"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Server struct {
	devnet                     *chain.Devnet
	mux                        *http.ServeMux
	aiGatewayUpstreamKey       string
	payGatewayUpstreamKey      string
	trustGatewayUpstreamKey    string
	resourceGatewayUpstreamKey string
	replicationKey             string
	readOnlyReplica            bool
}

func NewServer(devnet *chain.Devnet) http.Handler {
	return NewServerWithConfig(devnet, ServerConfig{})
}

type ServerConfig struct {
	AIGatewayUpstreamKey       string
	PayGatewayUpstreamKey      string
	TrustGatewayUpstreamKey    string
	ResourceGatewayUpstreamKey string
	ReplicationKey             string
	ReadOnlyReplica            bool
}

func NewServerWithConfig(devnet *chain.Devnet, cfg ServerConfig) http.Handler {
	s := &Server{
		devnet:                     devnet,
		mux:                        http.NewServeMux(),
		aiGatewayUpstreamKey:       strings.TrimSpace(cfg.AIGatewayUpstreamKey),
		payGatewayUpstreamKey:      strings.TrimSpace(cfg.PayGatewayUpstreamKey),
		trustGatewayUpstreamKey:    strings.TrimSpace(cfg.TrustGatewayUpstreamKey),
		resourceGatewayUpstreamKey: strings.TrimSpace(cfg.ResourceGatewayUpstreamKey),
		replicationKey:             strings.TrimSpace(cfg.ReplicationKey),
		readOnlyReplica:            cfg.ReadOnlyReplica,
	}
	s.routes()
	return s.withHeaders(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /status", s.handleStatus)
	s.mux.HandleFunc("GET /node/identity", s.handleNodeIdentity)
	s.mux.HandleFunc("GET /internal/replication/snapshot", s.handleReplicationSnapshot)
	s.mux.HandleFunc("POST /evm", s.handleEVM)
	s.mux.HandleFunc("POST /", s.handleEVM)
	s.mux.HandleFunc("GET /blocks/latest", s.handleLatestBlock)
	s.mux.HandleFunc("GET /blocks/{height}", s.handleBlockByHeight)
	s.mux.HandleFunc("GET /accounts/{address}", s.handleAccount)
	s.mux.HandleFunc("GET /validators", s.handleValidators)
	s.mux.HandleFunc("GET /validators/peers", s.handleValidatorPeers)
	s.mux.HandleFunc("GET /validators/peer-sync", s.handleValidatorPeerSyncs)
	s.mux.HandleFunc("POST /validators/{address}/heartbeat", s.handleValidatorHeartbeat)
	s.mux.HandleFunc("POST /validators/{address}/peers/observe", s.handleValidatorPeerObserve)
	s.mux.HandleFunc("POST /validators/{address}/peer-sync", s.handleValidatorPeerSync)
	s.mux.HandleFunc("GET /txs", s.handleRecentTransactions)
	s.mux.HandleFunc("GET /txs/{hash}", s.handleTransaction)
	s.mux.HandleFunc("GET /explorer/summary", s.handleExplorerSummary)
	s.mux.HandleFunc("POST /faucet", s.handleFaucet)
	s.mux.HandleFunc("POST /transfer", s.handleTransfer)
	s.mux.HandleFunc("POST /staking/stake", s.handleStake)
	s.mux.HandleFunc("GET /resources/{address}", s.handleResources)
	s.trustRoute("GET /trust/trace/{address}", s.handleTrustTrace)
	s.trustRoute("POST /trust/labels", s.handleTrustLabel)
	s.trustRoute("POST /trust/evidence", s.handleEvidencePacket)
	s.trustRoute("GET /trust/evidence/{id}", s.handleEvidenceLookup)
	s.trustRoute("POST /governance/requests", s.handleGovernanceRequest)
	s.trustRoute("GET /governance/requests/{id}", s.handleGovernanceRequestLookup)
	s.trustRoute("POST /governance/requests/{id}/review", s.handleGovernanceRequestReview)
	s.trustRoute("POST /governance/requests/{id}/reject", s.handleGovernanceRequestReject)
	s.trustRoute("GET /governance/request-validity-rules", s.handleRequestValidityRules)
	s.trustRoute("GET /governance/transparency", s.handleTransparencyReport)
	s.trustRoute("POST /trust/appeals", s.handleTrustAppeal)
	s.trustRoute("GET /trust/appeals/{id}", s.handleTrustAppealLookup)
	s.trustRoute("POST /trust/appeals/{id}/resolve", s.handleTrustAppealResolve)
	s.trustRoute("POST /trust/tracking-reviews", s.handleTrackingPolicyReview)
	s.trustRoute("GET /trust/tracking-reviews/{id}", s.handleTrackingPolicyReviewLookup)
	s.payRoute("POST /pay/intents", s.handlePayIntent)
	s.payRoute("GET /pay/intents/{id}", s.handlePayIntentLookup)
	s.payRoute("POST /pay/invoices", s.handleInvoice)
	s.payRoute("GET /pay/invoices/{id}", s.handleInvoiceLookup)
	s.payRoute("POST /pay/refunds", s.handleRefund)
	s.payRoute("POST /pay/webhook-signatures", s.handleWebhookSignature)
	s.payRoute("GET /pay/webhook-signatures/{eventId}", s.handleWebhookSignatureLookup)
	s.payRoute("GET /pay/events", s.handlePayEvents)
	s.payRoute("GET /pay/events/{id}", s.handlePayEventLookup)
	s.resourceRoute("GET /resource-market/policy", s.handleResourcePolicy)
	s.resourceRoute("GET /resource-market/quote", s.handleResourceQuote)
	s.resourceRoute("GET /resource-market/analytics", s.handleResourceAnalytics)
	s.resourceRoute("POST /resource-market/delegations", s.handleResourceDelegation)
	s.resourceRoute("GET /resource-market/delegations/{address}", s.handleResourceDelegations)
	s.resourceRoute("POST /resource-market/rent", s.handleResourceRent)
	s.resourceRoute("GET /resource-market/income/{address}", s.handleResourceIncome)
	s.aiRoute("GET /ai/stream", s.handleAIStream)
	s.aiRoute("POST /ai/permissions", s.handleAIPermission)
	s.aiRoute("GET /ai/permissions", s.handleAIPermissions)
	s.aiRoute("GET /ai/permissions/{id}", s.handleAIPermissionLookup)
	s.aiRoute("POST /ai/actions", s.handleAIActionProposal)
	s.aiRoute("GET /ai/actions", s.handleAIActions)
	s.aiRoute("GET /ai/actions/{id}", s.handleAIActionLookup)
	s.aiRoute("POST /ai/actions/{id}/approve", s.handleAIActionApprove)
	s.aiRoute("POST /ai/actions/{id}/reject", s.handleAIActionReject)
	s.mux.HandleFunc("GET /ide/compiler", s.handleIDECompiler)
	s.mux.HandleFunc("POST /ide/compile", s.handleIDECompile)
	s.mux.HandleFunc("POST /ide/deploy", s.handleIDEDeploy)
	s.mux.HandleFunc("POST /ide/call", s.handleIDECall)
	s.mux.HandleFunc("POST /ide/execute", s.handleIDEExecute)
	s.mux.HandleFunc("POST /ide/verify", s.handleIDEVerify)
	s.mux.HandleFunc("GET /ide/verifier/{address}", s.handleIDEVerifier)
	s.mux.HandleFunc("GET /contracts/{address}", s.handleContractLookup)
	s.mux.HandleFunc("GET /monitoring/health", s.handleMonitoring)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
}

func (s *Server) aiRoute(pattern string, handler http.HandlerFunc) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if s.aiGatewayUpstreamKey != "" && !constantTimeEqual(r.Header.Get("X-YNX-AI-Gateway-Upstream-Key"), s.aiGatewayUpstreamKey) {
			writeError(w, http.StatusUnauthorized, "AI routes require the authenticated YNX AI Gateway")
			return
		}
		handler(w, r)
	})
}

func (s *Server) payRoute(pattern string, handler http.HandlerFunc) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if s.payGatewayUpstreamKey != "" && !constantTimeEqual(r.Header.Get("X-YNX-Pay-Gateway-Upstream-Key"), s.payGatewayUpstreamKey) {
			writeError(w, http.StatusUnauthorized, "Pay routes require the authenticated YNX Pay Gateway")
			return
		}
		handler(w, r)
	})
}

func (s *Server) trustRoute(pattern string, handler http.HandlerFunc) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if s.trustGatewayUpstreamKey != "" && !constantTimeEqual(r.Header.Get("X-YNX-Trust-Gateway-Upstream-Key"), s.trustGatewayUpstreamKey) {
			writeError(w, http.StatusUnauthorized, "Trust and governance routes require the authenticated YNX Trust Gateway")
			return
		}
		handler(w, r)
	})
}

func (s *Server) resourceRoute(pattern string, handler http.HandlerFunc) {
	s.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if s.resourceGatewayUpstreamKey != "" && !constantTimeEqual(r.Header.Get("X-YNX-Resource-Gateway-Upstream-Key"), s.resourceGatewayUpstreamKey) {
			writeError(w, http.StatusUnauthorized, "Resource Market routes require the authenticated YNX Resource Gateway")
			return
		}
		handler(w, r)
	})
}

func constantTimeEqual(a, b string) bool {
	aHash := sha256.Sum256([]byte(a))
	bHash := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(aHash[:], bHash[:]) == 1
}

func normalizeAccountInput(value string) (string, error) {
	value = strings.TrimSpace(value)
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, accountaddress.HRP+"1") || strings.HasPrefix(lower, "0x") {
		return accountaddress.Normalize(value)
	}
	return value, nil
}

func (s *Server) withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg := s.devnet.Config()
		w.Header().Set("X-YNX-Network", cfg.Slug)
		w.Header().Set("X-YNX-Truthful-Status", chain.TruthfulStatus(cfg))
		if s.readOnlyReplica && r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusConflict, "replicated follower is read-only; submit mutations to the authoritative producer")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "ynx-chaind", "network": s.devnet.Config(), "timestamp": time.Now().UTC()})
}
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.Status())
}
func (s *Server) handleNodeIdentity(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.NodeIdentity())
}
func (s *Server) handleReplicationSnapshot(w http.ResponseWriter, r *http.Request) {
	if s.replicationKey == "" || !constantTimeEqual(r.Header.Get("X-YNX-Replication-Key"), s.replicationKey) {
		writeError(w, http.StatusUnauthorized, "replication snapshot requires node authentication")
		return
	}
	payload, err := s.devnet.ReplicationSnapshotJSON()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "replication snapshot unavailable")
		return
	}
	mac := hmac.New(sha256.New, []byte(s.replicationKey))
	_, _ = mac.Write(payload)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-YNX-Replication-SHA256", hex.EncodeToString(mac.Sum(nil)))
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		w.WriteHeader(http.StatusOK)
		compressed, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
		if err != nil {
			return
		}
		_, _ = compressed.Write(payload)
		_ = compressed.Close()
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}
func (s *Server) handleLatestBlock(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.LatestBlock())
}
func (s *Server) handleBlockByHeight(w http.ResponseWriter, r *http.Request) {
	height, err := strconv.ParseUint(r.PathValue("height"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid block height")
		return
	}
	block, ok := s.devnet.BlockByHeight(height)
	if !ok {
		writeError(w, http.StatusNotFound, "block not found")
		return
	}
	writeJSON(w, http.StatusOK, block)
}
func (s *Server) handleTransaction(w http.ResponseWriter, r *http.Request) {
	tx, ok := s.devnet.Transaction(r.PathValue("hash"))
	if !ok {
		writeError(w, http.StatusNotFound, "transaction not found")
		return
	}
	writeJSON(w, http.StatusOK, tx)
}
func (s *Server) handleRecentTransactions(w http.ResponseWriter, r *http.Request) {
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		limit = parsed
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": s.devnet.RecentTransactions(limit)})
}
func (s *Server) handleAccount(w http.ResponseWriter, r *http.Request) {
	address, err := normalizeAccountInput(r.PathValue("address"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	account, ok := s.devnet.Account(address)
	if !ok {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	resources, _ := s.devnet.Resources(account.Address)
	trace, _ := s.devnet.TrustTrace(account.Address)
	writeJSON(w, http.StatusOK, map[string]any{"account": account, "resources": resources, "trace": trace})
}
func (s *Server) handleValidators(w http.ResponseWriter, r *http.Request) {
	validators := s.devnet.Validators()
	writeJSON(w, http.StatusOK, map[string]any{
		"validators":             validators,
		"expectedValidatorCount": len(validators),
	})
}
func (s *Server) handleValidatorPeers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"peers": s.devnet.ValidatorPeers()})
}
func (s *Server) handleValidatorPeerSyncs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"syncs": s.devnet.ValidatorPeerSyncs()})
}
func (s *Server) handleValidatorHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req chain.ValidatorPeerHeartbeatInput
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Address = r.PathValue("address")
	validator, err := s.devnet.UpdateValidatorPeerState(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, validator)
}
func (s *Server) handleValidatorPeerObserve(w http.ResponseWriter, r *http.Request) {
	var req chain.ValidatorPeerObservationInput
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Address = r.PathValue("address")
	peer, err := s.devnet.ObserveValidatorPeer(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, peer)
}
func (s *Server) handleValidatorPeerSync(w http.ResponseWriter, r *http.Request) {
	var req chain.ValidatorPeerSyncInput
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Source = r.PathValue("address")
	sync, err := s.devnet.RecordValidatorPeerSync(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sync)
}
func (s *Server) handleExplorerSummary(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.ExplorerSummary())
}
func (s *Server) handleFaucet(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address string `json:"address"`
		Amount  int64  `json:"amount"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	address, err := normalizeAccountInput(req.Address)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, err := s.devnet.Faucet(address, req.Amount)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tx)
}
func (s *Server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From, To string
		Amount   int64
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	from, err := normalizeAccountInput(req.From)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	to, err := normalizeAccountInput(req.To)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, err := s.devnet.Transfer(from, to, req.Amount)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tx)
}
func (s *Server) handleStake(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address string `json:"address"`
		Amount  int64  `json:"amount"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	address, err := normalizeAccountInput(req.Address)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, resources, err := s.devnet.Stake(address, req.Amount)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"transaction": tx, "resources": resources})
}
func (s *Server) handleResources(w http.ResponseWriter, r *http.Request) {
	address, err := normalizeAccountInput(r.PathValue("address"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	resources, err := s.devnet.Resources(address)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resources)
}
func (s *Server) handleTrustTrace(w http.ResponseWriter, r *http.Request) {
	address, err := normalizeAccountInput(r.PathValue("address"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	trace, err := s.devnet.TrustTrace(address)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, trace)
}
func (s *Server) handleTrustLabel(w http.ResponseWriter, r *http.Request) {
	var req chain.RiskLabelInput
	if !decodeJSON(w, r, &req) {
		return
	}
	label, err := s.devnet.AddRiskLabelFromInput(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, label)
}
func (s *Server) handleEvidencePacket(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Subject string `json:"subject"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	packet, err := s.devnet.EvidencePacket(req.Subject)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, packet)
}
func (s *Server) handleEvidenceLookup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	asPDF := strings.HasSuffix(id, ".pdf")
	if asPDF {
		id = strings.TrimSuffix(id, ".pdf")
	}
	packet, ok := s.devnet.StoredEvidencePacket(id)
	if !ok {
		writeError(w, http.StatusNotFound, "evidence packet not found")
		return
	}
	if asPDF {
		w.Header().Set("Content-Type", "application/pdf")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(minimalEvidencePDF(packet))
		return
	}
	writeJSON(w, http.StatusOK, packet)
}
func (s *Server) handleGovernanceRequest(w http.ResponseWriter, r *http.Request) {
	var req chain.GovernanceRequestInput
	if !decodeJSON(w, r, &req) {
		return
	}
	request, err := s.devnet.CreateGovernanceRequest(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, request)
}
func (s *Server) handleGovernanceRequestLookup(w http.ResponseWriter, r *http.Request) {
	request, ok := s.devnet.GovernanceRequest(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "governance request not found")
		return
	}
	writeJSON(w, http.StatusOK, request)
}
func (s *Server) handleGovernanceRequestReview(w http.ResponseWriter, r *http.Request) {
	request, err := s.devnet.ReviewGovernanceRequest(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, request)
}
func (s *Server) handleGovernanceRequestReject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	request, err := s.devnet.RejectGovernanceRequest(r.PathValue("id"), req.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, request)
}
func (s *Server) handleTransparencyReport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.TransparencyReport())
}
func (s *Server) handleRequestValidityRules(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"rules": chain.RequestValidityRules()})
}
func (s *Server) handleTrustAppeal(w http.ResponseWriter, r *http.Request) {
	var req chain.TrustAppealInput
	if !decodeJSON(w, r, &req) {
		return
	}
	appeal, err := s.devnet.CreateTrustAppeal(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, appeal)
}
func (s *Server) handleTrustAppealLookup(w http.ResponseWriter, r *http.Request) {
	appeal, ok := s.devnet.TrustAppeal(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "trust appeal not found")
		return
	}
	writeJSON(w, http.StatusOK, appeal)
}
func (s *Server) handleTrustAppealResolve(w http.ResponseWriter, r *http.Request) {
	var req chain.TrustAppealDecisionInput
	if !decodeJSON(w, r, &req) {
		return
	}
	appeal, err := s.devnet.ResolveTrustAppeal(r.PathValue("id"), req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, appeal)
}
func (s *Server) handleTrackingPolicyReview(w http.ResponseWriter, r *http.Request) {
	var req chain.TrackingPolicyReviewInput
	if !decodeJSON(w, r, &req) {
		return
	}
	review, err := s.devnet.CreateTrackingPolicyReview(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, review)
}
func (s *Server) handleTrackingPolicyReviewLookup(w http.ResponseWriter, r *http.Request) {
	review, ok := s.devnet.TrackingPolicyReview(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "tracking policy review not found")
		return
	}
	writeJSON(w, http.StatusOK, review)
}
func (s *Server) handlePayIntent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Merchant       string `json:"merchant"`
		Amount         int64  `json:"amount"`
		CallbackURL    string `json:"callbackUrl"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	intent, err := s.devnet.CreatePayIntentWithIdempotency(req.Merchant, req.Amount, req.CallbackURL, req.IdempotencyKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, intent)
}
func (s *Server) handlePayIntentLookup(w http.ResponseWriter, r *http.Request) {
	intent, ok := s.devnet.PayIntent(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "payment intent not found")
		return
	}
	writeJSON(w, http.StatusOK, intent)
}
func (s *Server) handleInvoice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IntentID       string `json:"intentId"`
		DueInHours     int64  `json:"dueInHours"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	invoice, err := s.devnet.CreateInvoiceWithIdempotency(req.IntentID, req.DueInHours, req.IdempotencyKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, invoice)
}
func (s *Server) handleInvoiceLookup(w http.ResponseWriter, r *http.Request) {
	invoice, ok := s.devnet.Invoice(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "invoice not found")
		return
	}
	writeJSON(w, http.StatusOK, invoice)
}
func (s *Server) handleRefund(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IntentID       string `json:"intentId"`
		Amount         int64  `json:"amount"`
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	refund, err := s.devnet.CreateRefundWithIdempotency(req.IntentID, req.Amount, req.Reason, req.IdempotencyKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, refund)
}
func (s *Server) handleWebhookSignature(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IntentID       string `json:"intentId"`
		EventType      string `json:"eventType"`
		SigningKey     string `json:"signingKey"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	signature, err := s.devnet.SignWebhookWithIdempotency(req.IntentID, req.EventType, req.SigningKey, req.IdempotencyKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, signature)
}
func (s *Server) handleWebhookSignatureLookup(w http.ResponseWriter, r *http.Request) {
	signature, ok := s.devnet.WebhookSignature(r.PathValue("eventId"))
	if !ok {
		writeError(w, http.StatusNotFound, "webhook signature not found")
		return
	}
	writeJSON(w, http.StatusOK, signature)
}
func (s *Server) handlePayEvents(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"events": s.devnet.PayEvents(r.URL.Query().Get("intentId"))})
}
func (s *Server) handlePayEventLookup(w http.ResponseWriter, r *http.Request) {
	event, ok := s.devnet.PayEvent(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "pay event not found")
		return
	}
	writeJSON(w, http.StatusOK, event)
}
func (s *Server) handleResourceQuote(w http.ResponseWriter, r *http.Request) {
	bandwidth, err := int64Query(r, "bandwidth")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	compute, err := int64Query(r, "compute")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	aiCredits, err := int64Query(r, "aiCredits")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	trustCredits, err := int64Query(r, "trustCredits")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	quote, err := s.devnet.ResourceQuote(r.URL.Query().Get("address"), bandwidth, compute, aiCredits, trustCredits)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, quote)
}
func (s *Server) handleResourcePolicy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.ResourceMarketPolicy())
}
func (s *Server) handleResourceAnalytics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.devnet.ResourceAnalytics())
}
func (s *Server) handleResourceDelegation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider    string `json:"provider"`
		Beneficiary string `json:"beneficiary"`
		Amount      int64  `json:"amount"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	delegation, tx, resources, err := s.devnet.DelegateResources(req.Provider, req.Beneficiary, req.Amount)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"delegation": delegation, "transaction": tx, "resources": resources})
}
func (s *Server) handleResourceDelegations(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"delegations": s.devnet.ResourceDelegations(r.PathValue("address"))})
}
func (s *Server) handleResourceRent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address      string `json:"address"`
		Provider     string `json:"provider"`
		Bandwidth    int64  `json:"bandwidth"`
		Compute      int64  `json:"compute"`
		AICredits    int64  `json:"aiCredits"`
		TrustCredits int64  `json:"trustCredits"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	rental, resources, err := s.devnet.RentResources(req.Address, req.Provider, req.Bandwidth, req.Compute, req.AICredits, req.TrustCredits)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"rental": rental, "resources": resources})
}
func (s *Server) handleResourceIncome(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"income": s.devnet.ResourceIncome(r.PathValue("address"))})
}
func (s *Server) handleAIStream(w http.ResponseWriter, r *http.Request) {
	session, query := r.URL.Query().Get("session"), r.URL.Query().Get("q")
	if session == "" || query == "" {
		writeError(w, http.StatusBadRequest, "session and q are required")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	status := s.devnet.Status()
	chunks := []string{fmt.Sprintf("session %s", session), fmt.Sprintf("query: %s", query), fmt.Sprintf("network: %s", status["network"]), fmt.Sprintf("latest height: %v", status["height"]), "AI actions that move value require explicit user confirmation and scoped permissions."}
	for _, chunk := range chunks {
		_, _ = fmt.Fprintf(w, "event: token\ndata: %s\n\n", sanitizeSSE(chunk))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		time.Sleep(10 * time.Millisecond)
	}
	_, _ = fmt.Fprint(w, "event: done\ndata: ok\n\n")
}
func (s *Server) handleAIPermission(w http.ResponseWriter, r *http.Request) {
	var req chain.AIPermissionInput
	if !decodeJSON(w, r, &req) {
		return
	}
	grant, err := s.devnet.RequestAIPermission(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, grant)
}
func (s *Server) handleAIPermissionLookup(w http.ResponseWriter, r *http.Request) {
	grant, ok := s.devnet.AIPermission(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "AI permission not found")
		return
	}
	writeJSON(w, http.StatusOK, grant)
}
func (s *Server) handleAIPermissions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"permissions": s.devnet.AIPermissions(r.URL.Query().Get("sessionId"))})
}
func (s *Server) handleAIActionProposal(w http.ResponseWriter, r *http.Request) {
	var req chain.AIActionProposalInput
	if !decodeJSON(w, r, &req) {
		return
	}
	proposal, err := s.devnet.ProposeAIAction(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, proposal)
}
func (s *Server) handleAIActions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"actions": s.devnet.AIActions(r.URL.Query().Get("sessionId"))})
}
func (s *Server) handleAIActionLookup(w http.ResponseWriter, r *http.Request) {
	proposal, ok := s.devnet.AIAction(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "AI action proposal not found")
		return
	}
	writeJSON(w, http.StatusOK, proposal)
}
func (s *Server) handleAIActionApprove(w http.ResponseWriter, r *http.Request) {
	var req chain.AIActionApprovalInput
	if !decodeJSON(w, r, &req) {
		return
	}
	proposal, err := s.devnet.ApproveAIAction(r.PathValue("id"), req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, proposal)
}
func (s *Server) handleAIActionReject(w http.ResponseWriter, r *http.Request) {
	var req chain.AIActionApprovalInput
	if !decodeJSON(w, r, &req) {
		return
	}
	proposal, err := s.devnet.RejectAIAction(r.PathValue("id"), req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, proposal)
}
func (s *Server) handleIDECompiler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, chain.SolidityCompilerConfig())
}
func (s *Server) handleIDECompile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Source string `json:"source"`
		Name   string `json:"name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result := preflightContract(req.Name, req.Source)
	status := http.StatusOK
	if !result.OK {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, result)
}
func (s *Server) handleIDEDeploy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Deployer        string   `json:"deployer"`
		Name            string   `json:"name"`
		Source          string   `json:"source"`
		ConstructorArgs []string `json:"constructorArgs"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result := preflightContract(req.Name, req.Source)
	if !result.OK {
		writeJSON(w, http.StatusBadRequest, result)
		return
	}
	artifact, tx, err := s.devnet.DeployContractWithArgs(req.Deployer, req.Name, req.Source, req.ConstructorArgs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"contract": artifact, "transaction": tx})
}
func (s *Server) handleIDEVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address string `json:"address"`
		Source  string `json:"source"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	artifact, err := s.devnet.VerifyContract(req.Address, req.Source)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, artifact)
}
func (s *Server) handleIDECall(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address  string `json:"address"`
		Function string `json:"function"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := s.devnet.CallContract(req.Address, req.Function)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (s *Server) handleIDEExecute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Caller   string `json:"caller"`
		Address  string `json:"address"`
		Calldata string `json:"calldata"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	result, tx, err := s.devnet.ExecuteContract(req.Caller, req.Address, req.Calldata)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result, "transaction": tx})
}
func (s *Server) handleIDEVerifier(w http.ResponseWriter, r *http.Request) {
	evidence, ok := s.devnet.ContractVerification(r.PathValue("address"))
	if !ok {
		writeError(w, http.StatusNotFound, "contract not found")
		return
	}
	writeJSON(w, http.StatusOK, evidence)
}
func (s *Server) handleContractLookup(w http.ResponseWriter, r *http.Request) {
	artifact, ok := s.devnet.Contract(r.PathValue("address"))
	if !ok {
		writeError(w, http.StatusNotFound, "contract not found")
		return
	}
	writeJSON(w, http.StatusOK, artifact)
}
func (s *Server) handleMonitoring(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "height": s.devnet.LatestBlock().Height, "service": "ynx-monitoring-local"})
}
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	cfg := s.devnet.Config()
	summary := s.devnet.ExplorerSummary()
	resourceAnalytics := s.devnet.ResourceAnalytics()
	labels := fmt.Sprintf(`network="%s",chain_id="%d",native_symbol="%s"`, prometheusLabel(cfg.Slug), cfg.ChainID, prometheusLabel(cfg.NativeCurrencySymbol))
	persistenceError := 0
	if summary.PersistenceError != "" {
		persistenceError = 1
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_height Latest indexed YNX Chain block height.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_height gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_height{%s} %d\n", labels, summary.Height)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_transactions_total Total transactions known to the local node.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_transactions_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_transactions_total{%s} %d\n", labels, summary.TotalTransactions)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_validators Active validator records known to the local node.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_validators gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_validators{%s} %d\n", labels, summary.ValidatorCount)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_pending_transactions Pending transaction count.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_pending_transactions gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_pending_transactions{%s} %d\n", labels, summary.PendingTxCount)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_known_accounts Known account count.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_known_accounts gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_known_accounts{%s} %d\n", labels, summary.KnownAccounts)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_pay_intents_total Pay intents recorded by the local node.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_pay_intents_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_pay_intents_total{%s} %d\n", labels, summary.PayIntentCount)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_trust_evidence_total Trust evidence packets recorded by the local node.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_trust_evidence_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_trust_evidence_total{%s} %d\n", labels, summary.TrustEvidenceCount)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_contracts_total Contracts recorded by the local node.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_contracts_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_contracts_total{%s} %d\n", labels, summary.ContractCount)
	_, _ = fmt.Fprint(w, "# HELP ynx_chain_persistence_error Whether the node reports a persistence error.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_chain_persistence_error gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_chain_persistence_error{%s} %d\n", labels, persistenceError)
	_, _ = fmt.Fprint(w, "# HELP ynx_resource_delegated_ynxt Total YNXT delegated into resource capacity.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_resource_delegated_ynxt gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_resource_delegated_ynxt{%s} %d\n", labels, resourceAnalytics.DelegatedYNXT)
	_, _ = fmt.Fprint(w, "# HELP ynx_resource_rental_volume_ynxt Total YNXT paid for resource rentals.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_resource_rental_volume_ynxt counter\n")
	_, _ = fmt.Fprintf(w, "ynx_resource_rental_volume_ynxt{%s} %d\n", labels, resourceAnalytics.RentalVolumeYNXT)
	_, _ = fmt.Fprint(w, "# HELP ynx_resource_provider_income_ynxt Total YNXT income paid to resource providers.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_resource_provider_income_ynxt counter\n")
	_, _ = fmt.Fprintf(w, "ynx_resource_provider_income_ynxt{%s} %d\n", labels, resourceAnalytics.ProviderIncomeYNXT)
	_, _ = fmt.Fprint(w, "# HELP ynx_resource_protocol_fee_ynxt Total YNXT protocol fee from resource rentals.\n")
	_, _ = fmt.Fprint(w, "# TYPE ynx_resource_protocol_fee_ynxt counter\n")
	_, _ = fmt.Fprintf(w, "ynx_resource_protocol_fee_ynxt{%s} %d\n", labels, resourceAnalytics.ProtocolFeeYNXT)
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}
type rpcResponse struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Result  any    `json:"result,omitempty"`
	Error   any    `json:"error,omitempty"`
}

func (s *Server) handleEVM(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "EVM JSON-RPC requires POST")
		return
	}
	var req rpcRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	result, err := s.evmResult(req.Method, req.Params)
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	if err != nil {
		resp.Error = map[string]any{"code": -32601, "message": err.Error()}
	} else {
		resp.Result = result
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) evmResult(method string, params []any) (any, error) {
	cfg, latest := s.devnet.Config(), s.devnet.LatestBlock()
	switch method {
	case "eth_chainId":
		return hexQuantity(uint64(cfg.ChainID)), nil
	case "net_version":
		return fmt.Sprint(cfg.ChainID), nil
	case "eth_blockNumber":
		return hexQuantity(latest.Height), nil
	case "eth_getBalance":
		if len(params) == 0 {
			return "0x0", nil
		}
		addr, _ := params[0].(string)
		acct, ok := s.devnet.Account(addr)
		if !ok {
			return "0x0", nil
		}
		return hexQuantity(uint64(acct.Balance)), nil
	case "eth_getBlockByNumber":
		return evmBlock(latest, len(s.devnet.RecentTransactions(100))), nil
	case "eth_getBlockByHash":
		return evmBlock(latest, len(s.devnet.RecentTransactions(100))), nil
	case "eth_getTransactionByHash":
		if len(params) == 0 {
			return nil, nil
		}
		tx, ok := s.devnet.Transaction(fmt.Sprint(params[0]))
		if !ok {
			return nil, nil
		}
		return evmTx(tx), nil
	case "eth_getTransactionReceipt":
		if len(params) == 0 {
			return nil, nil
		}
		tx, ok := s.devnet.Transaction(fmt.Sprint(params[0]))
		if !ok {
			return nil, nil
		}
		return map[string]any{"transactionHash": tx.Hash, "status": "0x1", "blockHash": tx.BlockHash, "blockNumber": hexQuantity(tx.BlockNum), "gasUsed": "0x5208", "logs": evmLogs(tx.Logs)}, nil
	case "eth_sendRawTransaction":
		if len(params) == 0 || fmt.Sprint(params[0]) == "" {
			return nil, fmt.Errorf("raw transaction parameter is required")
		}
		tx, err := s.devnet.Faucet("0xraw_tx_sink", 1)
		if err != nil {
			return nil, err
		}
		s.devnet.ProduceBlock()
		return tx.Hash, nil
	case "eth_sendTransaction":
		if len(params) == 0 {
			return nil, fmt.Errorf("transaction object is required")
		}
		call, ok := params[0].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("transaction parameter must be an object")
		}
		from := strings.TrimSpace(fmt.Sprint(call["from"]))
		to := strings.TrimSpace(fmt.Sprint(call["to"]))
		data := strings.TrimSpace(fmt.Sprint(call["data"]))
		if from == "" || to == "" || data == "" || data == "<nil>" {
			return nil, fmt.Errorf("from, to, and data are required")
		}
		_, tx, err := s.devnet.ExecuteContract(from, to, data)
		if err != nil {
			return nil, err
		}
		s.devnet.ProduceBlock()
		return tx.Hash, nil
	case "eth_estimateGas":
		return "0x5208", nil
	case "eth_call":
		if len(params) > 0 {
			call, ok := params[0].(map[string]any)
			if ok {
				to := strings.TrimSpace(fmt.Sprint(call["to"]))
				data := strings.TrimSpace(fmt.Sprint(call["data"]))
				if to != "" && data != "" && data != "<nil>" {
					result, err := s.devnet.CallContract(to, data)
					if err != nil {
						return nil, err
					}
					return result.EncodedResult, nil
				}
			}
		}
		return "0x", nil
	case "eth_getLogs":
		filter, err := parseEVMLogFilter(params, latest.Height)
		if err != nil {
			return nil, err
		}
		return evmLogs(s.devnet.EVMLogs(filter)), nil
	default:
		return nil, fmt.Errorf("method %s is not implemented by the local YNX devnet RPC", method)
	}
}

func evmBlock(block chain.Block, txCount int) map[string]any {
	return map[string]any{"number": hexQuantity(block.Height), "hash": "0x" + trim0x(block.Hash), "parentHash": "0x" + trim0x(block.ParentHash), "timestamp": hexQuantity(uint64(block.Time.Unix())), "transactions": []any{}, "transactionsRoot": "0x" + strings.Repeat("0", 64), "stateRoot": "0x" + strings.Repeat("0", 64), "receiptsRoot": "0x" + strings.Repeat("0", 64), "miner": "0x0000000000000000000000000000000000000000", "gasUsed": "0x0", "gasLimit": "0x1c9c380", "transactionCount": txCount}
}
func evmTx(tx chain.Transaction) map[string]any {
	return map[string]any{"hash": tx.Hash, "from": tx.From, "to": tx.To, "value": hexQuantity(uint64(tx.Amount)), "nonce": hexQuantity(tx.Nonce), "blockHash": tx.BlockHash, "blockNumber": hexQuantity(tx.BlockNum), "gas": "0x5208", "gasPrice": "0x1"}
}
func evmLogs(logs []chain.EVMLog) []any {
	out := make([]any, 0, len(logs))
	for _, log := range logs {
		out = append(out, map[string]any{
			"address":          log.Address,
			"topics":           log.Topics,
			"data":             log.Data,
			"blockHash":        log.BlockHash,
			"blockNumber":      hexQuantity(log.BlockNumber),
			"transactionHash":  log.TransactionHash,
			"transactionIndex": hexQuantity(log.TransactionIndex),
			"logIndex":         hexQuantity(log.LogIndex),
			"removed":          log.Removed,
		})
	}
	return out
}
func hexQuantity(v uint64) string { return "0x" + strconv.FormatUint(v, 16) }
func parseEVMLogFilter(params []any, latestHeight uint64) (chain.EVMLogFilter, error) {
	if len(params) == 0 || params[0] == nil {
		return chain.EVMLogFilter{}, nil
	}
	raw, ok := params[0].(map[string]any)
	if !ok {
		return chain.EVMLogFilter{}, fmt.Errorf("eth_getLogs filter must be an object")
	}
	filter := chain.EVMLogFilter{}
	if value, ok := raw["fromBlock"]; ok {
		height, err := parseBlockTag(value, latestHeight)
		if err != nil {
			return filter, err
		}
		filter.FromBlock = &height
	}
	if value, ok := raw["toBlock"]; ok {
		height, err := parseBlockTag(value, latestHeight)
		if err != nil {
			return filter, err
		}
		filter.ToBlock = &height
	}
	if value, ok := raw["address"]; ok {
		switch typed := value.(type) {
		case string:
			if typed != "" {
				filter.Addresses = []string{typed}
			}
		case []any:
			for _, item := range typed {
				if address := strings.TrimSpace(fmt.Sprint(item)); address != "" && address != "<nil>" {
					filter.Addresses = append(filter.Addresses, address)
				}
			}
		default:
			return filter, fmt.Errorf("eth_getLogs address must be a string or array")
		}
	}
	if value, ok := raw["topics"]; ok {
		topics, ok := value.([]any)
		if !ok {
			return filter, fmt.Errorf("eth_getLogs topics must be an array")
		}
		filter.Topics = make([][]string, 0, len(topics))
		for _, topic := range topics {
			switch typed := topic.(type) {
			case nil:
				filter.Topics = append(filter.Topics, nil)
			case string:
				filter.Topics = append(filter.Topics, []string{strings.ToLower(typed)})
			case []any:
				accepted := make([]string, 0, len(typed))
				for _, item := range typed {
					if item == nil {
						continue
					}
					accepted = append(accepted, strings.ToLower(fmt.Sprint(item)))
				}
				filter.Topics = append(filter.Topics, accepted)
			default:
				return filter, fmt.Errorf("eth_getLogs topic entries must be strings, null, or arrays")
			}
		}
	}
	return filter, nil
}
func parseBlockTag(value any, latestHeight uint64) (uint64, error) {
	switch typed := value.(type) {
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "", "latest", "safe", "finalized":
			return latestHeight, nil
		case "earliest":
			return 0, nil
		case "pending":
			return latestHeight + 1, nil
		}
		if strings.HasPrefix(typed, "0x") {
			height, err := strconv.ParseUint(strings.TrimPrefix(typed, "0x"), 16, 64)
			if err != nil {
				return 0, fmt.Errorf("invalid block tag")
			}
			return height, nil
		}
		height, err := strconv.ParseUint(typed, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid block tag")
		}
		return height, nil
	case float64:
		if typed < 0 {
			return 0, fmt.Errorf("invalid block tag")
		}
		return uint64(typed), nil
	default:
		return 0, fmt.Errorf("invalid block tag")
	}
}
func trim0x(v string) string {
	v = strings.TrimPrefix(v, "0x")
	if v == "" {
		return strings.Repeat("0", 64)
	}
	if _, err := hex.DecodeString(v); err != nil {
		return fmt.Sprintf("%064x", v)
	}
	return v
}

type compileResult struct {
	OK                               bool                            `json:"ok"`
	Name                             string                          `json:"name"`
	SourceHash                       string                          `json:"sourceHash,omitempty"`
	BytecodeHash                     string                          `json:"bytecodeHash,omitempty"`
	DeployedBytecodeHash             string                          `json:"deployedBytecodeHash,omitempty"`
	ArtifactHash                     string                          `json:"artifactHash,omitempty"`
	ArtifactKind                     string                          `json:"artifactKind,omitempty"`
	CompilerMode                     string                          `json:"compilerMode,omitempty"`
	CompilerConfigHash               string                          `json:"compilerConfigHash,omitempty"`
	Compiler                         chain.ContractCompilerConfig    `json:"compiler,omitempty"`
	CompilerArtifact                 *chain.ContractCompilerArtifact `json:"compilerArtifact,omitempty"`
	CompilerExecutionStatus          string                          `json:"compilerExecutionStatus,omitempty"`
	RuntimeMode                      string                          `json:"runtimeMode,omitempty"`
	VerifierMode                     string                          `json:"verifierMode,omitempty"`
	ReproducibleBuild                bool                            `json:"reproducibleBuild"`
	ReproducibilityStatus            string                          `json:"reproducibilityStatus,omitempty"`
	DeployedBytecodeComparisonStatus string                          `json:"deployedBytecodeComparisonStatus,omitempty"`
	ABI                              []chain.ContractABIEntry        `json:"abi,omitempty"`
	Events                           []chain.ContractEventABI        `json:"events,omitempty"`
	Functions                        []chain.ContractFunctionABI     `json:"functions,omitempty"`
	Limitations                      []string                        `json:"limitations,omitempty"`
	Warnings                         []string                        `json:"warnings,omitempty"`
	Errors                           []string                        `json:"errors,omitempty"`
	TruthfulNote                     string                          `json:"truthfulNote"`
}

func preflightContract(name, source string) compileResult {
	result := compileResult{Name: name, Compiler: chain.SolidityCompilerConfig(), TruthfulNote: "Local devnet deterministic source preflight and artifact analysis with pinned Solidity compiler configuration. Bytecode is analyzer metadata until production solc execution and remote verifier are wired."}
	trimmed := strings.TrimSpace(source)
	if trimmed == "" {
		result.Errors = append(result.Errors, "source is required")
		return result
	}
	if !strings.Contains(trimmed, "contract ") {
		result.Errors = append(result.Errors, "source must contain a Solidity contract declaration")
		return result
	}
	if !strings.Contains(trimmed, "pragma solidity") {
		result.Warnings = append(result.Warnings, "missing pragma solidity declaration")
	}
	artifact := chain.AnalyzeContractSource(name, trimmed)
	result.OK = true
	result.SourceHash = artifact.SourceHash
	result.BytecodeHash = artifact.BytecodeHash
	result.DeployedBytecodeHash = artifact.DeployedBytecodeHash
	result.ArtifactHash = artifact.ArtifactHash
	result.ArtifactKind = artifact.ArtifactKind
	result.CompilerMode = artifact.CompilerMode
	result.CompilerConfigHash = artifact.CompilerConfigHash
	result.Compiler = artifact.Compiler
	result.CompilerArtifact = artifact.CompilerArtifact
	result.CompilerExecutionStatus = artifact.CompilerExecutionStatus
	result.RuntimeMode = artifact.RuntimeMode
	result.VerifierMode = artifact.VerifierMode
	result.ReproducibleBuild = artifact.ReproducibleBuild
	result.ReproducibilityStatus = artifact.ReproducibilityStatus
	result.DeployedBytecodeComparisonStatus = artifact.DeployedBytecodeComparisonStatus
	result.ABI = artifact.ABI
	result.Events = artifact.Events
	result.Functions = artifact.Functions
	result.Limitations = artifact.Limitations
	return result
}
func decodeJSON(w http.ResponseWriter, r *http.Request, dest any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}
func sanitizeSSE(value string) string {
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	return value
}
func prometheusLabel(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "")
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, `"`, `\"`)
	return value
}

func int64Query(r *http.Request, key string) (int64, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s", key)
	}
	return value, nil
}

func minimalEvidencePDF(packet chain.EvidencePacket) []byte {
	line := fmt.Sprintf("YNX Trust evidence packet %s subject %s json %s generated %s conclusion %s effectiveRiskBps %d assetEffect %s",
		packet.ID, packet.Subject, packet.JSONHash, packet.GeneratedAt.Format(time.RFC3339), packet.RiskSummary.Conclusion, packet.RiskSummary.EffectiveRiskWeightBps, packet.RiskSummary.AssetEffect)
	line = strings.NewReplacer("\\", "\\\\", "(", "\\(", ")", "\\)").Replace(line)
	stream := fmt.Sprintf("BT /F1 12 Tf 72 720 Td (%s) Tj ET", line)
	objects := []string{
		"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
		"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
		"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
		"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
		fmt.Sprintf("5 0 obj << /Length %d >> stream\n%s\nendstream endobj\n", len(stream), stream),
	}
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for _, obj := range objects {
		offsets = append(offsets, buf.Len())
		buf.WriteString(obj)
	}
	xrefOffset := buf.Len()
	buf.WriteString(fmt.Sprintf("xref\n0 %d\n0000000000 65535 f \n", len(offsets)))
	for i := 1; i < len(offsets); i++ {
		buf.WriteString(fmt.Sprintf("%010d 00000 n \n", offsets[i]))
	}
	buf.WriteString(fmt.Sprintf("trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xrefOffset))
	return buf.Bytes()
}
