package oracle

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

var durationBounds = [...]int64{1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000}

type Metrics struct {
	requests       atomic.Uint64
	requestErrors  atomic.Uint64
	ingestAccepted atomic.Uint64
	ingestRejected atomic.Uint64
	priceGood      atomic.Uint64
	priceUnsafe    atomic.Uint64
	replayRequests atomic.Uint64
	duration       [len(durationBounds) + 1]atomic.Uint64
}

type MetricsSnapshot struct {
	Requests        uint64            `json:"requests"`
	RequestErrors   uint64            `json:"requestErrors"`
	IngestAccepted  uint64            `json:"ingestAccepted"`
	IngestRejected  uint64            `json:"ingestRejected"`
	PriceGood       uint64            `json:"priceGood"`
	PriceUnsafe     uint64            `json:"priceUnsafe"`
	ReplayRequests  uint64            `json:"replayRequests"`
	DurationBuckets map[string]uint64 `json:"durationBuckets"`
}

func (metrics *Metrics) observe(status int, duration time.Duration) {
	metrics.requests.Add(1)
	if status >= 400 {
		metrics.requestErrors.Add(1)
	}
	milliseconds := duration.Milliseconds()
	index := len(durationBounds)
	for candidate, bound := range durationBounds {
		if milliseconds <= bound {
			index = candidate
			break
		}
	}
	metrics.duration[index].Add(1)
}

func (metrics *Metrics) Snapshot() MetricsSnapshot {
	buckets := make(map[string]uint64, len(metrics.duration))
	for index, bound := range durationBounds {
		buckets["le_"+strconv.FormatInt(bound, 10)+"ms"] = metrics.duration[index].Load()
	}
	buckets["gt_5000ms"] = metrics.duration[len(durationBounds)].Load()
	return MetricsSnapshot{metrics.requests.Load(), metrics.requestErrors.Load(), metrics.ingestAccepted.Load(), metrics.ingestRejected.Load(), metrics.priceGood.Load(), metrics.priceUnsafe.Load(), metrics.replayRequests.Load(), buckets}
}

func (metrics *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/metrics" {
			http.NotFound(response, request)
			return
		}
		response.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		response.Header().Set("Cache-Control", "no-store")
		snapshot := metrics.Snapshot()
		var output strings.Builder
		writeMetric := func(name string, value uint64) { _, _ = fmt.Fprintf(&output, "%s %d\n", name, value) }
		writeMetric("ynx_oracle_http_requests_total", snapshot.Requests)
		writeMetric("ynx_oracle_http_request_errors_total", snapshot.RequestErrors)
		writeMetric("ynx_oracle_ingest_accepted_total", snapshot.IngestAccepted)
		writeMetric("ynx_oracle_ingest_rejected_total", snapshot.IngestRejected)
		writeMetric("ynx_oracle_price_good_total", snapshot.PriceGood)
		writeMetric("ynx_oracle_price_unsafe_total", snapshot.PriceUnsafe)
		writeMetric("ynx_oracle_replay_requests_total", snapshot.ReplayRequests)
		var cumulative uint64
		for index, bound := range durationBounds {
			cumulative += metrics.duration[index].Load()
			_, _ = fmt.Fprintf(&output, "ynx_oracle_http_request_duration_milliseconds_bucket{le=\"%d\"} %d\n", bound, cumulative)
		}
		cumulative += metrics.duration[len(durationBounds)].Load()
		_, _ = fmt.Fprintf(&output, "ynx_oracle_http_request_duration_milliseconds_bucket{le=\"+Inf\"} %d\n", cumulative)
		_, _ = response.Write([]byte(output.String()))
	})
}
