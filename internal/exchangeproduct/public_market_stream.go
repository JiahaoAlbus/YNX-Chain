package exchangeproduct

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

var marketDataStreamPollInterval = 5 * time.Second

func (s *Server) marketSnapshot(w http.ResponseWriter, _ *http.Request) {
	snapshot, _ := s.service.marketDataSnapshot()
	writeJSON(w, http.StatusOK, snapshot)
}

// Guest SSE is read-only and re-reads durable state on every reconciliation.
// It bypasses the ordinary status recorder so Flush reaches the real writer.
func (s *Server) marketDataStream(w http.ResponseWriter, r *http.Request) {
	_, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming response writer unavailable"})
		return
	}
	load := func() (MarketDataSnapshot, string, error) {
		if err := s.service.refreshState(); err != nil {
			return MarketDataSnapshot{}, "", err
		}
		snapshot, fingerprint := s.service.marketDataSnapshot()
		return snapshot, fingerprint, nil
	}
	snapshot, fingerprint, err := load()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "exchange durable state unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	writeFrame := func(frame string) error {
		// Some in-process writers do not implement deadlines. A real transport
		// failure, however, must retire this subscriber and release its slot.
		if err := controller.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return err
		}
		if _, err := fmt.Fprint(w, frame); err != nil {
			return err
		}
		return controller.Flush()
	}
	emit := func(event string, value MarketDataSnapshot, id string) error {
		payload, err := json.Marshal(value)
		if err != nil {
			return err
		}
		return writeFrame(fmt.Sprintf("id: state-%s\nevent: %s\ndata: %s\n\n", id, event, payload))
	}
	if err := emit("snapshot", snapshot, fingerprint); err != nil {
		return
	}
	previous := fingerprint
	ticker := time.NewTicker(marketDataStreamPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			snapshot, fingerprint, err := load()
			if err != nil {
				_ = writeFrame("event: source-unavailable\ndata: {\"code\":\"FIN_SOURCE_UNAVAILABLE\",\"retryable\":true}\n\n")
				return
			}
			if fingerprint != previous {
				if err := emit("reconciled", snapshot, fingerprint); err != nil {
					return
				}
				previous = fingerprint
				continue
			}
			if err := writeFrame(fmt.Sprintf("event: heartbeat\ndata: {\"revision\":%d}\n\n", snapshot.Revision)); err != nil {
				return
			}
		}
	}
}
