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
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Server struct {
	indexer      *Indexer
	mux          *http.ServeMux
	mu           sync.RWMutex
	lastResult   SyncResult
	lastError    string
	errorCount   int64
	reorgCount   int64
	lastSyncedAt time.Time
	startedAt    time.Time
	build        buildinfo.Info
	cursor       *cursorCodec
}

func NewServer(indexer *Indexer) *Server {
	return NewServerWithBuild(indexer, buildinfo.Info{})
}

func NewServerWithBuild(indexer *Indexer, build buildinfo.Info) *Server {
	server, err := NewServerWithBuildAndCursorKey(indexer, build, nil)
	if err != nil {
		panic(err)
	}
	return server
}

func NewServerWithBuildAndCursorKey(indexer *Indexer, build buildinfo.Info, cursorKey []byte) (*Server, error) {
	codec, err := newCursorCodec(cursorKey)
	if err != nil {
		return nil, err
	}
	s := &Server{indexer: indexer, mux: http.NewServeMux(), startedAt: time.Now().UTC(), build: buildinfo.Normalize(build), cursor: codec}
	s.routes()
	return s, nil
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
	if result.ReorgDetected {
		s.reorgCount++
	}
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
	s.mux.HandleFunc("GET /version", s.handleVersion)
	s.mux.HandleFunc("GET /ynx/overview", s.handleOverview)
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)
	s.mux.HandleFunc("POST /sync", s.handleSync)
	s.mux.HandleFunc("GET /blocks/latest", s.handleLatestBlocks)
	s.mux.HandleFunc("GET /blocks/{height}", s.handleBlock)
	s.mux.HandleFunc("GET /txs", s.handleTransactions)
	s.mux.HandleFunc("GET /txs/{hash}", s.handleTransaction)
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":       "ynx-indexerd",
		"schemaVersion": 2,
		"build":         s.build,
		"startedAt":     s.startedAt,
	})
}

type databaseSummary struct {
	Network              string
	ChainID              int64
	NativeSymbol         string
	LastIndexedHeight    uint64
	LastSourceHeight     uint64
	SourceEarliestHeight uint64
	SourceEarliestHash   string
	SourceEarliestTime   time.Time
	IndexedBlockCount    int
	IndexedTxCount       int
}

func summarizeDatabase(store *Store) (databaseSummary, error) {
	var summary databaseSummary
	err := store.View(func(db Database) error {
		summary = databaseSummary{
			Network:              db.Network,
			ChainID:              db.ChainID,
			NativeSymbol:         db.NativeSymbol,
			LastIndexedHeight:    db.LastIndexedHeight,
			LastSourceHeight:     db.LastSourceHeight,
			SourceEarliestHeight: db.SourceEarliestHeight,
			SourceEarliestHash:   db.SourceEarliestHash,
			SourceEarliestTime:   db.SourceEarliestTime,
			IndexedBlockCount:    len(db.Blocks),
			IndexedTxCount:       len(db.Transactions),
		}
		return nil
	})
	return summary, err
}

func trySummarizeDatabase(store *Store) (databaseSummary, bool, error) {
	var summary databaseSummary
	ready, err := store.TryView(func(db Database) error {
		summary = databaseSummary{
			Network:              db.Network,
			ChainID:              db.ChainID,
			NativeSymbol:         db.NativeSymbol,
			LastIndexedHeight:    db.LastIndexedHeight,
			LastSourceHeight:     db.LastSourceHeight,
			SourceEarliestHeight: db.SourceEarliestHeight,
			SourceEarliestHash:   db.SourceEarliestHash,
			SourceEarliestTime:   db.SourceEarliestTime,
			IndexedBlockCount:    len(db.Blocks),
			IndexedTxCount:       len(db.Transactions),
		}
		return nil
	})
	return summary, ready, err
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	db, err := summarizeDatabase(s.indexer.Store())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s.mu.RLock()
	lastError, lastSyncedAt, lastResult := s.lastError, s.lastSyncedAt, s.lastResult
	s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                   lastError == "" && !lastSyncedAt.IsZero(),
		"service":              "ynx-indexerd",
		"network":              db.Network,
		"chainId":              db.ChainID,
		"nativeCurrencySymbol": db.NativeSymbol,
		"lastIndexedHeight":    db.LastIndexedHeight,
		"lastSourceHeight":     db.LastSourceHeight,
		"sourceEarliestHeight": db.SourceEarliestHeight,
		"sourceEarliestHash":   db.SourceEarliestHash,
		"sourceEarliestTime":   db.SourceEarliestTime,
		"indexedBlockCount":    db.IndexedBlockCount,
		"indexedTxCount":       db.IndexedTxCount,
		"lastSyncedAt":         lastSyncedAt,
		"lastError":            lastError,
		"lastRecoveryMode":     lastResult.RecoveryMode,
		"lastReorgDetected":    lastResult.ReorgDetected,
		"lastCommonAncestor":   lastResult.CommonAncestorHeight,
		"lastRollbackFrom":     lastResult.RollbackFromHeight,
		"lastRolledBackBlocks": lastResult.RolledBackBlockCount,
		"lastRolledBackTxs":    lastResult.RolledBackTxCount,
		"maxReorgDepth":        lastResult.MaxReorgDepth,
		"build":                s.build,
		"cursorVersion":        cursorVersion,
		"cursorPersistence":    cursorPersistence(s.cursor),
		"truthfulStatus":       "local-indexer",
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	db, storeReady, err := trySummarizeDatabase(s.indexer.Store())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s.mu.RLock()
	lastError, lastSyncedAt, errorCount, reorgCount, lastResult := s.lastError, s.lastSyncedAt, s.errorCount, s.reorgCount, s.lastResult
	s.mu.RUnlock()
	ready := storeReady && lastError == "" && !lastSyncedAt.IsZero()
	dependencyStatus := "healthy"
	if !storeReady {
		dependencyStatus = "warming"
	} else if lastError != "" {
		dependencyStatus = "unavailable"
	} else if lastSyncedAt.IsZero() {
		dependencyStatus = "not-yet-synced"
	}
	status := http.StatusOK
	if !ready {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"ok":                   ready,
		"service":              "ynx-indexerd",
		"startedAt":            s.startedAt,
		"network":              db.Network,
		"chainId":              db.ChainID,
		"nativeSymbol":         db.NativeSymbol,
		"lastIndexedHeight":    db.LastIndexedHeight,
		"lastSourceHeight":     db.LastSourceHeight,
		"sourceEarliestHeight": db.SourceEarliestHeight,
		"sourceEarliestHash":   db.SourceEarliestHash,
		"indexedBlockCount":    db.IndexedBlockCount,
		"indexedTxCount":       db.IndexedTxCount,
		"lastSyncedAt":         lastSyncedAt,
		"lastError":            lastError,
		"syncErrorCount":       errorCount,
		"reorgRecoveryCount":   reorgCount,
		"lastRecoveryMode":     lastResult.RecoveryMode,
		"lastReorgDetected":    lastResult.ReorgDetected,
		"lastCommonAncestor":   lastResult.CommonAncestorHeight,
		"lastRollbackFrom":     lastResult.RollbackFromHeight,
		"lastRolledBackBlocks": lastResult.RolledBackBlockCount,
		"lastRolledBackTxs":    lastResult.RolledBackTxCount,
		"maxReorgDepth":        lastResult.MaxReorgDepth,
		"build":                s.build,
		"cursorVersion":        cursorVersion,
		"cursorPersistence":    cursorPersistence(s.cursor),
		"dependencies": map[string]any{
			"chainRpc": map[string]any{"status": dependencyStatus},
		},
		"truthfulStatus": "local-indexer",
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	db, err := summarizeDatabase(s.indexer.Store())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	s.mu.RLock()
	errorCount, reorgCount, lastResult := s.errorCount, s.reorgCount, s.lastResult
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
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_source_earliest_height Earliest retained source block height observed by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_source_earliest_height gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_source_earliest_height{%s} %d\n", labels, db.SourceEarliestHeight)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_sync_lag_blocks Source height minus indexed height.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_sync_lag_blocks gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_sync_lag_blocks{%s} %d\n", labels, lag)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_blocks_total Blocks stored by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_blocks_total gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_blocks_total{%s} %d\n", labels, db.IndexedBlockCount)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_transactions_total Transactions stored by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_transactions_total gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_transactions_total{%s} %d\n", labels, db.IndexedTxCount)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_sync_errors_total Sync errors observed by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_sync_errors_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_sync_errors_total{%s} %d\n", labels, errorCount)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_reorg_recoveries_total Canonical fork or source-height rollback recoveries completed by ynx-indexerd.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_reorg_recoveries_total counter\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_reorg_recoveries_total{%s} %d\n", labels, reorgCount)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_last_common_ancestor_height Common ancestor height used by the latest recovery.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_last_common_ancestor_height gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_last_common_ancestor_height{%s} %d\n", labels, lastResult.CommonAncestorHeight)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_last_rolled_back_blocks Blocks removed by the latest recovery.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_last_rolled_back_blocks gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_last_rolled_back_blocks{%s} %d\n", labels, lastResult.RolledBackBlockCount)
	_, _ = fmt.Fprintf(w, "# HELP ynx_indexer_last_rolled_back_transactions Transactions removed by the latest recovery.\n")
	_, _ = fmt.Fprintf(w, "# TYPE ynx_indexer_last_rolled_back_transactions gauge\n")
	_, _ = fmt.Fprintf(w, "ynx_indexer_last_rolled_back_transactions{%s} %d\n", labels, lastResult.RolledBackTxCount)
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
	after, err := s.cursor.decode(r.URL.Query().Get("cursor"), "blocks")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_cursor", "detail": err.Error()})
		return
	}
	var blocks []chain.Block
	var nextAfter string
	err = s.indexer.Store().View(func(db Database) error {
		var pageErr error
		blocks, nextAfter, pageErr = LatestBlocksPage(db, intQuery(r, "limit", 25), after)
		return pageErr
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_cursor", "detail": err.Error()})
		return
	}
	nextCursor := ""
	if nextAfter != "" {
		nextCursor, err = s.cursor.encode("blocks", nextAfter)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cursor_encoding_failed"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocks": blocks, "nextCursor": nextCursor, "cursorVersion": cursorVersion})
}

func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	var block chain.Block
	var ok bool
	err := s.indexer.Store().View(func(db Database) error {
		block, ok = db.Blocks[r.PathValue("height")]
		return nil
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "indexed block not found"})
		return
	}
	writeJSON(w, http.StatusOK, block)
}

func (s *Server) handleTransactions(w http.ResponseWriter, r *http.Request) {
	after, err := s.cursor.decode(r.URL.Query().Get("cursor"), "transactions")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_cursor", "detail": err.Error()})
		return
	}
	var transactions []chain.Transaction
	var nextAfter string
	err = s.indexer.Store().View(func(db Database) error {
		var pageErr error
		transactions, nextAfter, pageErr = LatestTransactionsPage(db, intQuery(r, "limit", 25), after)
		return pageErr
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_cursor", "detail": err.Error()})
		return
	}
	nextCursor := ""
	if nextAfter != "" {
		nextCursor, err = s.cursor.encode("transactions", nextAfter)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cursor_encoding_failed"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": transactions, "nextCursor": nextCursor, "cursorVersion": cursorVersion})
}

func (s *Server) handleTransaction(w http.ResponseWriter, r *http.Request) {
	var tx chain.Transaction
	var ok bool
	err := s.indexer.Store().View(func(db Database) error {
		tx, ok = db.Transactions[r.PathValue("hash")]
		return nil
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
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
