package commerce

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var requestDurationBuckets = [...]float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}

type httpMetricKey struct {
	Method      string
	RouteGroup  string
	StatusClass string
}

type routeLatency struct {
	Buckets [len(requestDurationBuckets)]uint64
	Count   uint64
	Sum     float64
}

type serverMetrics struct {
	mu        sync.Mutex
	startedAt time.Time
	inFlight  int64
	requests  map[httpMetricKey]uint64
	latencies map[string]routeLatency
}

type serverMetricsSnapshot struct {
	StartedAt time.Time
	InFlight  int64
	Requests  map[httpMetricKey]uint64
	Latencies map[string]routeLatency
}

func newServerMetrics() *serverMetrics {
	return &serverMetrics{
		startedAt: time.Now().UTC(),
		requests:  map[httpMetricKey]uint64{},
		latencies: map[string]routeLatency{},
	}
}

func (m *serverMetrics) begin() {
	m.mu.Lock()
	m.inFlight++
	m.mu.Unlock()
}

func (m *serverMetrics) complete(method, routeGroup string, status int, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inFlight--
	key := httpMetricKey{Method: method, RouteGroup: routeGroup, StatusClass: responseStatusClass(status)}
	m.requests[key]++
	latency := m.latencies[routeGroup]
	seconds := duration.Seconds()
	latency.Count++
	latency.Sum += seconds
	for index, bucket := range requestDurationBuckets {
		if seconds <= bucket {
			latency.Buckets[index]++
		}
	}
	m.latencies[routeGroup] = latency
}

func (m *serverMetrics) snapshot() serverMetricsSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	requests := make(map[httpMetricKey]uint64, len(m.requests))
	for key, value := range m.requests {
		requests[key] = value
	}
	latencies := make(map[string]routeLatency, len(m.latencies))
	for key, value := range m.latencies {
		latencies[key] = value
	}
	return serverMetricsSnapshot{StartedAt: m.startedAt, InFlight: m.inFlight, Requests: requests, Latencies: latencies}
}

type metricsResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *metricsResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *metricsResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(body)
	w.bytes += n
	return n, err
}

func (w *metricsResponseWriter) Flush() {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *metricsResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

func (w *metricsResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		s.metrics.begin()
		wrapped := &metricsResponseWriter{ResponseWriter: w}
		defer func() {
			status := wrapped.status
			if status == 0 {
				status = http.StatusOK
			}
			s.metrics.complete(r.Method, requestRouteGroup(r.URL.Path), status, time.Since(started))
		}()
		next.ServeHTTP(wrapped, r)
	})
}

func requestRouteGroup(path string) string {
	switch {
	case path == "/health":
		return "health"
	case path == "/version":
		return "version"
	case path == "/metrics":
		return "metrics"
	case path == "/api/capabilities":
		return "api_capabilities"
	case strings.HasPrefix(path, "/api/auth/"):
		return "api_auth"
	case strings.HasPrefix(path, "/api/products"):
		return "api_products"
	case strings.HasPrefix(path, "/api/stores"):
		return "api_stores"
	case strings.HasPrefix(path, "/api/profile"):
		return "api_profile"
	case strings.HasPrefix(path, "/api/cart"):
		return "api_cart"
	case strings.HasPrefix(path, "/api/privacy"):
		return "api_privacy"
	case strings.HasPrefix(path, "/api/orders"):
		return "api_orders"
	case strings.HasPrefix(path, "/api/seller"):
		return "api_seller"
	case strings.HasPrefix(path, "/api/ai"):
		return "api_ai"
	case strings.HasPrefix(path, "/shop/"):
		return "shop_assets"
	case strings.HasPrefix(path, "/seller/"):
		return "seller_assets"
	default:
		return "not_found"
	}
}

func responseStatusClass(status int) string {
	if status < 100 || status > 999 {
		return "unknown"
	}
	return strconv.Itoa(status/100) + "xx"
}

type CommerceStateMetrics struct {
	SchemaVersion      int
	Stores             int
	Products           int
	PublishedProducts  int
	Variants           int
	InventoryUnits     int64
	ReservedUnits      int64
	Orders             int
	OrdersByStatus     map[string]int
	BuyerProfiles      int
	Carts              int
	AIJobs             int
	AuditEvents        int
	IdempotencyRecords int
	ActiveRateWindows  int
}

func (s *Store) ObservabilitySnapshot() CommerceStateMetrics {
	s.mu.Lock()
	defer s.mu.Unlock()
	metrics := CommerceStateMetrics{
		SchemaVersion:      s.s.Version,
		Stores:             len(s.s.Stores),
		Products:           len(s.s.Products),
		Orders:             len(s.s.Orders),
		OrdersByStatus:     map[string]int{},
		BuyerProfiles:      len(s.s.BuyerProfiles),
		Carts:              len(s.s.Carts),
		AIJobs:             len(s.s.AIJobs),
		AuditEvents:        len(s.s.Audits),
		IdempotencyRecords: len(s.s.Idempotency),
		ActiveRateWindows:  len(s.s.RequestWindow),
	}
	for _, product := range s.s.Products {
		if product.Published {
			metrics.PublishedProducts++
		}
		metrics.Variants += len(product.Variants)
		for _, variant := range product.Variants {
			metrics.InventoryUnits += variant.Inventory
			metrics.ReservedUnits += variant.Reserved
		}
	}
	for _, order := range s.s.Orders {
		metrics.OrdersByStatus[order.Status]++
	}
	return metrics
}

func (s *Server) prometheusMetrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	runtimeMetrics := s.metrics.snapshot()
	state := s.store.ObservabilitySnapshot()
	var output strings.Builder
	output.WriteString("# HELP ynx_shop_build_info Build identity for the running YNX Shop service.\n")
	output.WriteString("# TYPE ynx_shop_build_info gauge\n")
	fmt.Fprintf(&output, "ynx_shop_build_info{version=\"%s\",commit=\"%s\"} 1\n", prometheusLabel(BuildVersion), prometheusLabel(BuildCommit))
	output.WriteString("# HELP ynx_shop_uptime_seconds Seconds since this server instance started.\n")
	output.WriteString("# TYPE ynx_shop_uptime_seconds gauge\n")
	fmt.Fprintf(&output, "ynx_shop_uptime_seconds %.6f\n", time.Since(runtimeMetrics.StartedAt).Seconds())
	output.WriteString("# HELP ynx_shop_http_in_flight Requests currently executing, including this scrape.\n")
	output.WriteString("# TYPE ynx_shop_http_in_flight gauge\n")
	fmt.Fprintf(&output, "ynx_shop_http_in_flight %d\n", runtimeMetrics.InFlight)
	output.WriteString("# HELP ynx_shop_http_requests_total Completed HTTP requests grouped without user-controlled identifiers.\n")
	output.WriteString("# TYPE ynx_shop_http_requests_total counter\n")
	requestKeys := make([]httpMetricKey, 0, len(runtimeMetrics.Requests))
	for key := range runtimeMetrics.Requests {
		requestKeys = append(requestKeys, key)
	}
	sort.Slice(requestKeys, func(i, j int) bool {
		if requestKeys[i].RouteGroup != requestKeys[j].RouteGroup {
			return requestKeys[i].RouteGroup < requestKeys[j].RouteGroup
		}
		if requestKeys[i].Method != requestKeys[j].Method {
			return requestKeys[i].Method < requestKeys[j].Method
		}
		return requestKeys[i].StatusClass < requestKeys[j].StatusClass
	})
	for _, key := range requestKeys {
		fmt.Fprintf(&output, "ynx_shop_http_requests_total{method=\"%s\",route_group=\"%s\",status_class=\"%s\"} %d\n", prometheusLabel(key.Method), prometheusLabel(key.RouteGroup), prometheusLabel(key.StatusClass), runtimeMetrics.Requests[key])
	}
	output.WriteString("# HELP ynx_shop_http_request_duration_seconds Request duration by bounded route group.\n")
	output.WriteString("# TYPE ynx_shop_http_request_duration_seconds histogram\n")
	routeGroups := make([]string, 0, len(runtimeMetrics.Latencies))
	for group := range runtimeMetrics.Latencies {
		routeGroups = append(routeGroups, group)
	}
	sort.Strings(routeGroups)
	for _, group := range routeGroups {
		latency := runtimeMetrics.Latencies[group]
		for index, bucket := range requestDurationBuckets {
			fmt.Fprintf(&output, "ynx_shop_http_request_duration_seconds_bucket{route_group=\"%s\",le=\"%g\"} %d\n", prometheusLabel(group), bucket, latency.Buckets[index])
		}
		fmt.Fprintf(&output, "ynx_shop_http_request_duration_seconds_bucket{route_group=\"%s\",le=\"+Inf\"} %d\n", prometheusLabel(group), latency.Count)
		fmt.Fprintf(&output, "ynx_shop_http_request_duration_seconds_sum{route_group=\"%s\"} %.9f\n", prometheusLabel(group), latency.Sum)
		fmt.Fprintf(&output, "ynx_shop_http_request_duration_seconds_count{route_group=\"%s\"} %d\n", prometheusLabel(group), latency.Count)
	}
	writeStateMetrics(&output, state)
	writeProviderMetrics(&output, s.cfg)
	_, _ = w.Write([]byte(output.String()))
}

func writeStateMetrics(output *strings.Builder, state CommerceStateMetrics) {
	output.WriteString("# HELP ynx_shop_persistence_schema_version Active commerce persistence schema version.\n")
	output.WriteString("# TYPE ynx_shop_persistence_schema_version gauge\n")
	fmt.Fprintf(output, "ynx_shop_persistence_schema_version %d\n", state.SchemaVersion)
	gauges := []struct {
		name  string
		help  string
		value int64
	}{
		{"ynx_shop_state_stores", "Persisted seller stores.", int64(state.Stores)},
		{"ynx_shop_state_products", "Persisted catalog products.", int64(state.Products)},
		{"ynx_shop_state_published_products", "Persisted published catalog products.", int64(state.PublishedProducts)},
		{"ynx_shop_state_variants", "Persisted catalog variants.", int64(state.Variants)},
		{"ynx_shop_state_inventory_units", "Current inventory units across variants.", state.InventoryUnits},
		{"ynx_shop_state_reserved_units", "Current reserved inventory units across variants.", state.ReservedUnits},
		{"ynx_shop_state_orders", "Persisted orders.", int64(state.Orders)},
		{"ynx_shop_state_buyer_profiles", "Persisted buyer profiles.", int64(state.BuyerProfiles)},
		{"ynx_shop_state_carts", "Persisted carts.", int64(state.Carts)},
		{"ynx_shop_state_ai_jobs", "Persisted bounded AI jobs.", int64(state.AIJobs)},
		{"ynx_shop_state_audit_events", "Persisted audit events.", int64(state.AuditEvents)},
		{"ynx_shop_state_idempotency_records", "Persisted idempotency records.", int64(state.IdempotencyRecords)},
		{"ynx_shop_state_active_rate_windows", "Active bounded rate-limit windows.", int64(state.ActiveRateWindows)},
	}
	for _, gauge := range gauges {
		fmt.Fprintf(output, "# HELP %s %s\n", gauge.name, gauge.help)
		fmt.Fprintf(output, "# TYPE %s gauge\n", gauge.name)
		fmt.Fprintf(output, "%s %d\n", gauge.name, gauge.value)
	}
	output.WriteString("# HELP ynx_shop_state_orders_by_status Persisted orders grouped by bounded order status.\n")
	output.WriteString("# TYPE ynx_shop_state_orders_by_status gauge\n")
	statuses := make([]string, 0, len(state.OrdersByStatus))
	for status := range state.OrdersByStatus {
		statuses = append(statuses, status)
	}
	sort.Strings(statuses)
	for _, status := range statuses {
		fmt.Fprintf(output, "ynx_shop_state_orders_by_status{status=\"%s\"} %d\n", prometheusLabel(status), state.OrdersByStatus[status])
	}
}

func writeProviderMetrics(output *strings.Builder, cfg ServerConfig) {
	providers := []struct {
		name      string
		available bool
	}{
		{"wallet_gateway", cfg.Auth != nil && cfg.Auth.Available()},
		{"pay", cfg.Pay.BaseURL != "" && cfg.Pay.APIKey != "" && cfg.Pay.MerchantID != "" && cfg.Pay.PayoutAddress != ""},
		{"trust", cfg.Trust != nil && cfg.Trust.Available()},
		{"ai", cfg.AI.BaseURL != "" && cfg.AI.APIKey != ""},
	}
	output.WriteString("# HELP ynx_shop_provider_available Whether a configured external or central provider boundary is available.\n")
	output.WriteString("# TYPE ynx_shop_provider_available gauge\n")
	for _, provider := range providers {
		value := 0
		if provider.available {
			value = 1
		}
		fmt.Fprintf(output, "ynx_shop_provider_available{provider=\"%s\"} %d\n", provider.name, value)
	}
}

func prometheusLabel(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "\n", "\\n", "\"", "\\\"")
	return replacer.Replace(value)
}
