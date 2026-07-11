package explorer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Server struct {
	service *Service
	mux     *http.ServeMux
	build   buildinfo.Info

	streamMu      sync.Mutex
	streamClients map[chan streamEvent]struct{}
	streamRunning bool
}

type streamEvent struct {
	id      string
	event   string
	payload []byte
}

func NewServer(service *Service) *Server {
	return NewServerWithBuild(service, buildinfo.Info{})
}

func NewServerWithBuild(service *Service, build buildinfo.Info) *Server {
	s := &Server{
		service:       service,
		mux:           http.NewServeMux(),
		build:         buildinfo.Normalize(build),
		streamClients: make(map[chan streamEvent]struct{}),
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /", s.handleWeb)
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("GET /api/summary", s.handleSummary)
	s.mux.HandleFunc("GET /api/stream", s.handleStream)
	s.mux.HandleFunc("GET /api/blocks/latest", s.handleLatestBlocks)
	s.mux.HandleFunc("GET /api/blocks/{height}", s.handleBlock)
	s.mux.HandleFunc("GET /api/txs", s.handleTransactions)
	s.mux.HandleFunc("GET /api/txs/{hash}", s.handleTransaction)
	s.mux.HandleFunc("GET /api/accounts/{address}", s.handleAccount)
	s.mux.HandleFunc("GET /api/tokens/{symbol}", s.handleToken)
	s.mux.HandleFunc("GET /api/validators", s.handleValidators)
	s.mux.HandleFunc("GET /api/resources/{address}", s.handleResources)
	s.mux.HandleFunc("GET /api/resource-market/analytics", s.handleResourceAnalytics)
	s.mux.HandleFunc("GET /api/fees/{hash}", s.handleFee)
	s.mux.HandleFunc("GET /api/search", s.handleSearch)
}

type dashboardSnapshot struct {
	Summary      Summary             `json:"summary"`
	Blocks       []chain.Block       `json:"blocks"`
	Transactions []chain.Transaction `json:"transactions"`
	Validators   map[string]any      `json:"validators"`
	Resources    map[string]any      `json:"resources"`
	Warnings     []string            `json:"warnings,omitempty"`
}

func (s *Server) dashboardSnapshot(ctx context.Context) (dashboardSnapshot, error) {
	var (
		summary                             Summary
		blocks                              []chain.Block
		transactions                        []chain.Transaction
		validators, resources               map[string]any
		summaryErr, blocksErr, txErr        error
		validatorsErr, resourceAnalyticsErr error
		wg                                  sync.WaitGroup
	)
	wg.Add(5)
	go func() { defer wg.Done(); summary, summaryErr = s.service.Summary(ctx) }()
	go func() { defer wg.Done(); blocks, blocksErr = s.service.LatestBlocks(ctx, 12) }()
	go func() { defer wg.Done(); transactions, txErr = s.service.Transactions(ctx, 12) }()
	go func() { defer wg.Done(); validators, validatorsErr = s.service.Validators(ctx) }()
	go func() { defer wg.Done(); resources, resourceAnalyticsErr = s.service.ResourceAnalytics(ctx) }()
	wg.Wait()
	if summaryErr != nil {
		return dashboardSnapshot{}, summaryErr
	}
	if blocksErr != nil {
		return dashboardSnapshot{}, blocksErr
	}
	if txErr != nil {
		return dashboardSnapshot{}, txErr
	}
	warnings := []string{}
	if validatorsErr != nil {
		warnings = append(warnings, "validator state unavailable: "+validatorsErr.Error())
		validators = map[string]any{}
	}
	if resourceAnalyticsErr != nil {
		warnings = append(warnings, "resource analytics unavailable: "+resourceAnalyticsErr.Error())
		resources = map[string]any{}
	}
	summary.Build = s.build
	return dashboardSnapshot{Summary: summary, Blocks: blocks, Transactions: transactions, Validators: validators, Resources: resources, Warnings: warnings}, nil
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "streaming is unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	_, _ = fmt.Fprint(w, "retry: 2000\n\n")
	flusher.Flush()

	client := s.subscribeStream()
	defer s.unsubscribeStream(client)
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-client:
			if event.id != "" {
				_, _ = fmt.Fprintf(w, "id: %s\n", event.id)
			}
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.event, event.payload)
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": keep-alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) subscribeStream() chan streamEvent {
	client := make(chan streamEvent, 1)
	s.streamMu.Lock()
	s.streamClients[client] = struct{}{}
	if !s.streamRunning {
		s.streamRunning = true
		go s.runStream()
	}
	s.streamMu.Unlock()
	return client
}

func (s *Server) unsubscribeStream(client chan streamEvent) {
	s.streamMu.Lock()
	delete(s.streamClients, client)
	s.streamMu.Unlock()
}

func (s *Server) runStream() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		snapshot, err := s.dashboardSnapshot(context.Background())
		event := streamEvent{event: "dashboard"}
		if err != nil {
			event.event = "upstream-error"
			event.payload, _ = json.Marshal(map[string]string{"error": err.Error()})
		} else {
			event.id = fmt.Sprintf("%d-%d-%d", snapshot.Summary.RPCHeight, snapshot.Summary.IndexedHeight, snapshot.Summary.IndexedTxCount)
			event.payload, err = json.Marshal(snapshot)
			if err != nil {
				event.event = "upstream-error"
				event.payload, _ = json.Marshal(map[string]string{"error": "dashboard snapshot encoding failed"})
			}
		}

		if !s.broadcastStream(event) {
			return
		}
		<-ticker.C
	}
}

func (s *Server) broadcastStream(event streamEvent) bool {
	s.streamMu.Lock()
	defer s.streamMu.Unlock()
	if len(s.streamClients) == 0 {
		s.streamRunning = false
		return false
	}
	for client := range s.streamClients {
		select {
		case client <- event:
		default:
		}
	}
	return true
}

func (s *Server) handleWeb(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	_, _ = w.Write([]byte(indexHTML))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	summary, err := s.service.Summary(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "service": "ynx-explorerd", "error": err.Error()})
		return
	}
	summary.Build = s.build
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := s.service.Summary(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	summary.Build = s.build
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleLatestBlocks(w http.ResponseWriter, r *http.Request) {
	blocks, err := s.service.LatestBlocks(r.Context(), intQuery(r, "limit", 10))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocks": blocks})
}

func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	block, err := s.service.Block(r.Context(), r.PathValue("height"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, block)
}

func (s *Server) handleTransactions(w http.ResponseWriter, r *http.Request) {
	txs, err := s.service.Transactions(r.Context(), intQuery(r, "limit", 10))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": txs})
}

func (s *Server) handleTransaction(w http.ResponseWriter, r *http.Request) {
	tx, err := s.service.Transaction(r.Context(), r.PathValue("hash"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, tx)
}

func (s *Server) handleAccount(w http.ResponseWriter, r *http.Request) {
	account, err := s.service.Account(r.Context(), r.PathValue("address"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (s *Server) handleToken(w http.ResponseWriter, r *http.Request) {
	token, err := s.service.Token(r.Context(), r.PathValue("symbol"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, token)
}

func (s *Server) handleValidators(w http.ResponseWriter, r *http.Request) {
	validators, err := s.service.Validators(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, validators)
}

func (s *Server) handleResources(w http.ResponseWriter, r *http.Request) {
	resources, err := s.service.Resources(r.Context(), r.PathValue("address"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resources)
}

func (s *Server) handleResourceAnalytics(w http.ResponseWriter, r *http.Request) {
	analytics, err := s.service.ResourceAnalytics(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, analytics)
}

func (s *Server) handleFee(w http.ResponseWriter, r *http.Request) {
	tx, err := s.service.Transaction(r.Context(), r.PathValue("hash"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, FeeDetailFromTx(tx))
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.Search(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	summary, err := s.service.Summary(context.Background())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	labels := fmt.Sprintf(`network="%s",chain_id="%d",native_symbol="%s"`, prometheusLabel(summary.Network.Name), summary.Network.ChainID, prometheusLabel(summary.NativeSymbol))
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprintf(w, "# HELP ynx_explorer_rpc_height Last RPC height observed by ynx-explorerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_explorer_rpc_height gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_explorer_rpc_height{%s} %d\n", labels, summary.RPCHeight)
	_, _ = fmt.Fprintf(w, "# HELP ynx_explorer_indexed_height Last indexed height observed by ynx-explorerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_explorer_indexed_height gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_explorer_indexed_height{%s} %d\n", labels, summary.IndexedHeight)
	_, _ = fmt.Fprintf(w, "# HELP ynx_explorer_sync_lag_blocks RPC height minus indexed height.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_explorer_sync_lag_blocks gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_explorer_sync_lag_blocks{%s} %d\n", labels, summary.SyncLagBlocks)
	_, _ = fmt.Fprintf(w, "# HELP ynx_explorer_transactions_total Transactions visible through the indexer.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_explorer_transactions_total gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_explorer_transactions_total{%s} %d\n", labels, summary.IndexedTxCount)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func intQuery(r *http.Request, key string, fallback int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 || parsed > 100 {
		return fallback
	}
	return parsed
}

func prometheusLabel(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "")
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, `"`, `\"`)
	return value
}
