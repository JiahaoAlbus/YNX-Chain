package quantlab

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// refreshScheduledTenants restores only already opted-in research schedules.
// Discovery is not authentication, a trading mandate, or an order executor.
// The loaded Service still uses its existing durable claim/stop/CAS fences.
func (s *TenantServer) refreshScheduledTenants(ctx context.Context) error {
	s.mu.Lock()
	maxOpen := s.maxOpen
	s.mu.Unlock()
	ids := make([]string, 0)
	if store, ok := s.baseService.store.(*postgresStateStore); ok {
		queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		prefix := s.config.StateNamespace + ":tenant:"
		// Exact prefix comparison, not LIKE: namespace punctuation cannot widen
		// discovery into another product or namespace. JSON is only a candidate
		// index; New/load verifies full persisted integrity before execution.
		rows, err := store.db.QueryContext(queryCtx, `SELECT state_key FROM ynx_quant_state
			WHERE left(state_key, length($1)) = $1 AND EXISTS (
				SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(payload->'strategies')='object'
				THEN payload->'strategies' ELSE '{}'::jsonb END) AS strategy
				WHERE strategy.value->'Runtime'->'enabled' = 'true'::jsonb
		) ORDER BY state_key COLLATE "C" LIMIT $2`, prefix, maxOpen+1)
		if err != nil {
			return ErrUnavailable
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				return ErrUnavailable
			}
			id := strings.TrimPrefix(key, prefix)
			if !tenantIDPattern.MatchString(id) {
				return ErrUnavailable
			}
			ids = append(ids, id)
		}
		if rows.Err() != nil {
			return ErrUnavailable
		}
	} else {
		entries, err := os.ReadDir(s.root)
		if err != nil {
			return ErrUnavailable
		}
		for _, entry := range entries {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			id := strings.TrimSuffix(entry.Name(), ".json")
			if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !strings.HasSuffix(entry.Name(), ".json") || !tenantIDPattern.MatchString(id) {
				continue
			}
			loaded, found, err := (fileStateStore{path: filepath.Join(s.root, entry.Name())}).load()
			if err != nil {
				return ErrUnavailable
			}
			if !found {
				continue
			}
			for _, strategy := range loaded.Strategies {
				if strategy.Runtime.Enabled {
					ids = append(ids, id)
					break
				}
			}
			if len(ids) > maxOpen {
				return ErrUnavailable
			}
		}
	}
	if len(ids) > maxOpen {
		return ErrUnavailable
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if _, err := s.tenant(id); err != nil {
			return err
		}
	}
	return nil
}
