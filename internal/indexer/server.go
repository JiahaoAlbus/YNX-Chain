package indexer

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
)

type Server struct {
	indexer      *Indexer
	mux          *http.ServeMux
	mu           sync.RWMutex
	lastResult   SyncResult
	lastError    string
	errorCount   int64
	lastSyncedAt time.Time
	build        buildinfo.Info
}

func NewServer(indexer *Indexer) *Server {
	return NewServerWithBuild(indexer, buildinfo.Info{})
}

func NewServerWithBuild(indexer *Indexer, build buildinfo.Info) *Server {
	s := &Server{indexer: indexer, mux: http.NewServeMux(), build: buildinfo.Normalize(build)}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) SyncOnce(ctx context.Context) (SyncResult, error) {
	result, err := s.indexer.SyncOnce(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.errorCount++
		s.lastError = err.Error()
		return SyncResult{}, err
	}
	s.lastError = ""
	s.lastResult = result
	s.lastSyncedAt = time.Now().UTC()
	return result, nil
}

func (s *Server) StartPolling(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	_, _ = s.SyncOnce(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = s.SyncOnce(ctx)
		}
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("POST /sync", s.handleSync)
	s.mux.HandleFunc("GET /blocks/latest", s.handleLatestBlocks)
	s.mux.HandleFunc("GET /blocks/{height}", s.handleBlock)
	s.mux.HandleFunc("GET /txs", s.handleTransactions)
	s.mux.HandleFunc("GET /txs/{hash}", s.handleTransaction)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	db, err := s.indexer.Store().Load()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s.mu.RLock()
	lastError, lastSyncedAt, errorCount := s.lastError, s.lastSyncedAt, s.errorCount
	s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                lastError == "",
		"service":           "ynx-indexerd",
		"network":           db.Network,
		"chainId":           db.ChainID,
		"nativeSymbol":      db.NativeSymbol,
		"lastIndexedHeight": db.LastIndexedHeight,
		"lastSourceHeight":  db.LastSourceHeight,
		"indexedBlockCount": len(db.Blocks),
		"indexedTxCount":    len(db.Transactions),
		"lastSyncedAt":      lastSyncedAt,
		"lastError":         lastError,
		"syncErrorCount":    errorCount,
		"build":             s.build,
		"truthfulStatus":    "local-indexer",
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	db, err := s.indexer.Store().Load()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	s.mu.RLock()
	errorCount := s.errorCount
	s.mu.RUnlock()
	lag := int64(db.LastSourceHeight) - int64(db.LastIndexedHeight)
	if lag < 0 {
		lag = 0
	}
	labels := fmt.Sprintf(`network="%s",chain_id="%d",native_symbol="%s"`, prometheusLabel(db.Network), db.ChainID, prometheusLabel(db.NativeSymbol))
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_last_indexed_height Last block height indexed by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_last_indexed_height gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_last_indexed_height{%s} %d\n", labels, db.LastIndexedHeight)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_source_height Last source chain height observed by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_source_height gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_source_height{%s} %d\n", labels, db.LastSourceHeight)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_sync_lag_blocks Source height minus indexed height.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_sync_lag_blocks gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_sync_lag_blocks{%s} %d\n", labels, lag)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_blocks_total Blocks stored by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_blocks_total gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_blocks_total{%s} %d\n", labels, len(db.Blocks))
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_transactions_total Transactions stored by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_transactions_total gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_transactions_total{%s} %d\n", labels, len(db.Transactions))
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_sync_errors_total Sync errors observed by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_sync_errors_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_sync_errors_total{%s} %d\n", labels, errorCount)
}

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	result, err := s.SyncOnce(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleLatestBlocks(w http.ResponseWriter, r *http.Request) {
	db, err := s.indexer.Store().Load()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocks": LatestBlocks(db, intQuery(r, "limit", 25))})
}

func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	db, err := s.indexer.Store().Load()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	block, ok := db.Blocks[r.PathValue("height")]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "indexed block not found"})
		return
	}
	writeJSON(w, http.StatusOK, block)
}

func (s *Server) handleTransactions(w http.ResponseWriter, r *http.Request) {
	db, err := s.indexer.Store().Load()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": LatestTransactions(db, intQuery(r, "limit", 25))})
}

func (s *Server) handleTransaction(w http.ResponseWriter, r *http.Request) {
	db, err := s.indexer.Store().Load()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	tx, ok := db.Transactions[r.PathValue("hash")]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "indexed transaction not found"})
		return
	}
	writeJSON(w, http.StatusOK, tx)
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
	if err != nil {
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
