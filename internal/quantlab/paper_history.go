package quantlab

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

const paperHistoryPageSize = 20

// Only an already-authorized owner's Service is passed here. Paging does not
// accept tenant/account input and cannot grant scheduling or execution rights.
// Revision is the original durable CAS identity, not an in-memory cursor.
func (s *Service) boundedPaperHistory(r *http.Request) (map[string]any, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, ErrInvalid
	}
	allowed := map[string]bool{"history": true, "offset": true, "revision": true}
	detail := r.URL.Path == "/v1/wallet/paper/experiment"
	if detail {
		allowed = map[string]bool{"id": true, "revision": true}
	}
	for key, values := range query {
		if !allowed[key] || len(values) != 1 || values[0] == "" {
			return nil, ErrInvalid
		}
	}
	version := query.Get("history")
	if !detail && version != "bounded_v1" && version != "bounded_v2" {
		return nil, ErrInvalid
	}
	offset := 0
	if raw := query.Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || strconv.Itoa(offset) != raw || offset < 0 || int64(offset) > 9007199254740971 || offset%paperHistoryPageSize != 0 {
			return nil, ErrInvalid
		}
	}
	if (detail || offset != 0) && query.Get("revision") == "" {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return nil, ErrUnavailable
	}
	defer release()
	revision := fmt.Sprintf("%d:%s", s.state.Revision, s.state.Integrity)
	if wanted := query.Get("revision"); wanted != "" && wanted != revision {
		return nil, ErrConflict
	}
	if detail {
		value, exists := s.state.Experiments[query.Get("id")]
		if !exists {
			return nil, ErrInvalid
		}
		// The original saved curve is not recalculated. A bounded deterministic
		// projection preserves original endpoints, timestamps and integer values.
		total := len(value.EquityCurve)
		if total > 100001 {
			return nil, ErrUnavailable
		}
		for i, point := range value.EquityCurve {
			const safe = int64(9007199254740991)
			if point.Time.IsZero() || (i > 0 && !point.Time.After(value.EquityCurve[i-1].Time)) || point.Equity < -safe || point.Equity > safe || point.BenchmarkEquity < -safe || point.BenchmarkEquity > safe || point.PeriodReturnBPS < -safe || point.PeriodReturnBPS > safe {
				return nil, ErrUnavailable
			}
		}
		count := total
		if count > 200 {
			count = 200
		}
		curve := make([]EquityPoint, 0, count)
		for i := 0; i < count; i++ {
			index := i
			if count > 1 {
				index = (i*(total-1) + (count-1)/2) / (count - 1)
			}
			curve = append(curve, value.EquityCurve[index])
		}
		value.EquityCurve = curve
		return detachedPaperHistory(map[string]any{"revision": revision, "experiment": value, "curveProjection": map[string]any{"policy": "saved_points_endpoint_preserving_v1", "originalPoints": total, "returnedPoints": count}})
	}
	experiments := make([]Experiment, 0, len(s.state.Experiments))
	for _, value := range s.state.Experiments {
		value.EquityCurve = nil
		experiments = append(experiments, value)
	}
	sort.Slice(experiments, func(i, j int) bool {
		if experiments[i].CreatedAt.Equal(experiments[j].CreatedAt) {
			return experiments[i].ID < experiments[j].ID
		}
		return experiments[i].CreatedAt.After(experiments[j].CreatedAt)
	})
	orders := append([]PaperOrder{}, s.state.Paper.Orders...)
	sort.Slice(orders, func(i, j int) bool {
		if orders[i].CreatedAt.Equal(orders[j].CreatedAt) {
			return orders[i].ID < orders[j].ID
		}
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	audit := []AuditEvent{}
	for i := len(s.state.Audit) - 1; i >= 0; i-- {
		event := s.state.Audit[i]
		if strings.HasPrefix(event.Action, "paper_order_") || strings.Contains(event.Action, "backtest") || event.Action == "paper_reconciled" || event.Action == "kill_switch_activated" {
			audit = append(audit, event)
		}
	}
	window := func(length int) (int, int) {
		start := offset
		if start > length {
			start = length
		}
		end := start + paperHistoryPageSize
		if end > length {
			end = length
		}
		return start, end
	}
	start, end := window(len(experiments))
	page := make(map[string]Experiment, end-start)
	for _, value := range experiments[start:end] {
		page[value.ID] = value
	}
	paper := s.state.Paper
	start, end = window(len(orders))
	paper.Orders = orders[start:end]
	start, end = window(len(audit))
	maximum := max(len(experiments), len(orders), len(audit))
	strategies := s.state.Strategies
	counts := map[string]int{"experiments": len(experiments), "orders": len(orders), "audit": len(audit)}
	if version == "bounded_v2" {
		catalog := make([]StrategySpec, 0, len(strategies))
		for _, value := range strategies {
			catalog = append(catalog, value)
		}
		sort.Slice(catalog, func(i, j int) bool {
			if catalog[i].CreatedAt.Equal(catalog[j].CreatedAt) {
				return catalog[i].ID < catalog[j].ID
			}
			return catalog[i].CreatedAt.After(catalog[j].CreatedAt)
		})
		first, last := window(len(catalog))
		strategies = make(map[string]StrategySpec, last-first)
		for _, value := range catalog[first:last] {
			strategies[value.ID] = value
		}
		counts["strategies"] = len(catalog)
		maximum = max(maximum, len(catalog))
	}
	return detachedPaperHistory(map[string]any{"strategies": strategies, "experiments": page, "paper": paper, "audit": audit[start:end], "history": map[string]any{"version": version, "revision": revision, "offset": offset, "pageSize": paperHistoryPageSize, "hasNext": offset+paperHistoryPageSize < maximum, "counts": counts}, "access": map[string]bool{"statefulPreview": false, "paperWorkspaceAuthorized": true, "nativeExecutionEnabled": false, "scheduleAuthorized": false}})
}

// Copy selected records while the original lock/CAS observation is held.
// RawMessage preserves integer tokens; no intermediate float64 conversion.
func detachedPaperHistory(value map[string]any) (map[string]any, error) {
	result := make(map[string]any, len(value))
	for key, field := range value {
		raw, err := json.Marshal(field)
		if err != nil {
			return nil, ErrUnavailable
		}
		result[key] = json.RawMessage(raw)
	}
	return result, nil
}
