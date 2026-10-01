package faucet

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const capabilityFreshness = 20 * time.Second
const firstResponseBudget = 1500 * time.Millisecond
const maxAsyncFundingAttempts = 3

type fundingResult struct {
	tx                   chain.Transaction
	status               int
	err                  error
	persistenceUncertain bool
	persisted            bool
}

type fundingFlight struct {
	done   chan struct{}
	result fundingResult
}

type statusResult struct {
	tx       chain.Transaction
	pending  bool
	notFound bool
	err      error
}

type statusFlight struct {
	done   chan struct{}
	result statusResult
}

type capabilityFlight struct {
	done chan struct{}
	err  error
}

type flightStats struct {
	fundingStarted, fundingJoined, fundingActive uint64
	statusStarted, statusJoined, statusActive    uint64
	capabilityStarted, capabilityJoined          uint64
	capabilityCacheHits                          uint64
}

func newUpstreamHTTPClient(totalTimeout, responseHeaderTimeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   32,
		MaxConnsPerHost:       64,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: responseHeaderTimeout,
		ExpectContinueTimeout: time.Second,
	}
	return &http.Client{Transport: transport, Timeout: totalTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// requireFreshFaucetCapability prevents every admitted user from serially
// re-probing the same immutable Core protocol contract. A successful probe is
// cached only slightly longer than the background health interval. Failures are
// never cached, and one disconnected caller cannot cancel the shared probe.
func (s *Service) requireFreshFaucetCapability(ctx context.Context) error {
	now := time.Now()
	s.flightMu.Lock()
	if now.Before(s.capabilityValidUntil) {
		s.flightStats.capabilityCacheHits++
		s.flightMu.Unlock()
		return nil
	}
	f := s.capabilityFlight
	if f == nil {
		f = &capabilityFlight{done: make(chan struct{})}
		s.capabilityFlight = f
		s.flightStats.capabilityStarted++
		go func() {
			probeCtx, cancel := context.WithTimeout(context.Background(), s.cfg.HealthTimeout)
			defer cancel()
			f.err = s.probeFaucetCapability(probeCtx, s.httpClient)
			s.flightMu.Lock()
			if f.err == nil {
				s.capabilityValidUntil = time.Now().Add(capabilityFreshness)
			}
			s.capabilityFlight = nil
			close(f.done)
			s.flightMu.Unlock()
		}()
	} else {
		s.flightStats.capabilityJoined++
	}
	s.flightMu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-f.done:
		return f.err
	}
}

func (s *Service) noteCapabilitySuccess() {
	s.flightMu.Lock()
	s.capabilityValidUntil = time.Now().Add(capabilityFreshness)
	s.flightMu.Unlock()
}

// fundAdmitted coalesces retries for one durable request ID while allowing
// different users to reach Core concurrently. The accepted operation is bounded
// independently from the client connection, so disconnecting a browser does not
// abandon an already charged admission.
func (s *Service) fundAdmitted(ctx context.Context, record admissionRecord, hash string, entry LogEntry) (fundingResult, bool) {
	s.flightMu.Lock()
	if s.closing {
		s.flightMu.Unlock()
		return fundingResult{status: 503, err: errors.New("faucet is shutting down; retain the same request ID")}, false
	}
	f := s.fundingFlights[record.RequestID]
	joined := f != nil
	if f == nil {
		f = &fundingFlight{done: make(chan struct{})}
		s.fundingFlights[record.RequestID] = f
		s.flightStats.fundingStarted++
		s.flightStats.fundingActive++
		s.workWG.Add(1)
		go func() {
			defer s.workWG.Done()
			f.result = s.runFunding(record, hash)
			if f.result.err == nil && !f.result.persisted {
				if err := s.admissions.complete(record, f.result.tx); err != nil {
					s.recordAdmissionStoreError("complete")
					f.result.status, f.result.err, f.result.persistenceUncertain = 503, errors.New("faucet receipt needs confirmation; retain the same request ID"), true
				}
			}
			entry.TxHash = hash
			if f.result.err == nil {
				entry.Status = "sent"
				_ = s.appendLog(entry)
				s.mu.Lock()
				s.successes++
				s.lastHash = hash
				s.lastError = ""
				s.mu.Unlock()
			} else {
				entry.Status, entry.Error = "error", f.result.err.Error()
				_ = s.appendLog(entry)
				s.mu.Lock()
				s.lastError = f.result.err.Error()
				s.mu.Unlock()
			}
			s.flightMu.Lock()
			delete(s.fundingFlights, record.RequestID)
			s.flightStats.fundingActive--
			close(f.done)
			s.flightMu.Unlock()
		}()
	} else {
		s.flightStats.fundingJoined++
	}
	s.flightMu.Unlock()
	select {
	case <-ctx.Done():
		return fundingResult{status: 503, err: errors.New("faucet request continues; check status with the same request ID")}, joined
	case <-f.done:
		return f.result, joined
	case <-time.After(firstResponseBudget):
		return fundingResult{status: http.StatusAccepted}, joined
	}
}

func (s *Service) fundOnce(record admissionRecord, hash string) fundingResult {
	opCtx, cancel := context.WithTimeout(s.workCtx, 10*time.Second)
	defer cancel()
	tx, status, err := s.sendDurableFaucetRequest(opCtx, record, hash)
	result := fundingResult{tx: tx, status: status, err: err}
	if errors.Is(err, errUpstreamResultUnknown) {
		readCtx, readCancel := context.WithTimeout(s.workCtx, 3*time.Second)
		recovered := s.fetchAndPersistReceipt(readCtx, record, hash)
		readCancel()
		if recovered.err == nil && !recovered.pending {
			return fundingResult{tx: recovered.tx, status: http.StatusCreated, persisted: true}
		}
	}
	return result
}

func (s *Service) runFunding(record admissionRecord, hash string) fundingResult {
	var result fundingResult
	if !record.Async {
		result = s.fundOnce(record, hash)
		if result.err == nil {
			return result
		}
		current, found, err := s.admissions.lookup(record.RequestID)
		if err != nil || !found || !current.Async {
			return result
		}
		record = current
	}
	// Only a durable 202 marker authorizes autonomous retries. Before each
	// additional Core POST, read the exact deterministic receipt; an unavailable
	// read path never authorizes another mutation.
	readFailures := 0
	for s.workCtx.Err() == nil {
		current, found, err := s.admissions.lookup(record.RequestID)
		if err != nil || !found {
			return fundingResult{status: 503, err: errors.New("pending admission unavailable")}
		}
		if current.Transaction != nil {
			return fundingResult{tx: *current.Transaction, status: 200, persisted: true}
		}
		if current.AsyncStopped || current.AsyncAttempts >= maxAsyncFundingAttempts {
			return fundingResult{status: 503, err: errors.New("faucet retry budget exhausted; retain the same request ID")}
		}
		next := current.AsyncNextAt
		if next.IsZero() || !next.After(time.Now()) {
			next = time.Now().Add(time.Duration(current.AsyncAttempts*2) * time.Second)
			if err := s.admissions.scheduleAsyncRetry(record.RequestID, next); err != nil {
				return fundingResult{status: 503, err: err}
			}
		}
		select {
		case <-s.workCtx.Done():
			return fundingResult{status: 503, err: s.workCtx.Err()}
		case <-time.After(time.Until(next)):
		}
		readCtx, cancel := context.WithTimeout(s.workCtx, 3*time.Second)
		recovered := s.fetchAndPersistReceipt(readCtx, record, hash)
		cancel()
		if recovered.err == nil && !recovered.pending {
			return fundingResult{tx: recovered.tx, status: 200, persisted: true}
		}
		if recovered.err != nil {
			readFailures++
			if readFailures >= maxAsyncFundingAttempts {
				if err := s.admissions.stopAsync(record.RequestID); err != nil {
					return fundingResult{status: 503, err: err}
				}
				return fundingResult{status: 503, err: errors.New("receipt read unavailable; retain the same request ID")}
			}
			if err := s.admissions.scheduleAsyncRetry(record.RequestID, time.Now().Add(time.Duration(readFailures*2)*time.Second)); err != nil {
				return fundingResult{status: 503, err: err}
			}
			continue
		}
		readFailures = 0
		started, err := s.admissions.beginAsyncRetry(record.RequestID, maxAsyncFundingAttempts)
		if err != nil {
			return fundingResult{status: 503, err: err}
		}
		if !started {
			continue
		}
		result = s.fundOnce(record, hash)
		if result.err == nil {
			return result
		}
	}
	return fundingResult{status: 503, err: s.workCtx.Err()}
}

func (s *Service) flightMetrics() string {
	s.flightMu.Lock()
	st := s.flightStats
	s.flightMu.Unlock()
	return fmt.Sprintf(`# HELP ynx_faucet_funding_flights_total Unique admitted funding operations sent upstream.
# TYPE ynx_faucet_funding_flights_total counter
ynx_faucet_funding_flights_total %d
# HELP ynx_faucet_funding_flight_joined_total Same-ID callers joined to an existing operation.
# TYPE ynx_faucet_funding_flight_joined_total counter
ynx_faucet_funding_flight_joined_total %d
# HELP ynx_faucet_funding_flights_active Currently active unique funding operations.
# TYPE ynx_faucet_funding_flights_active gauge
ynx_faucet_funding_flights_active %d
# HELP ynx_faucet_status_recovery_flights_total Unique durable receipt recovery operations.
# TYPE ynx_faucet_status_recovery_flights_total counter
ynx_faucet_status_recovery_flights_total %d
# HELP ynx_faucet_status_recovery_joined_total Same-ID status callers joined to a recovery.
# TYPE ynx_faucet_status_recovery_joined_total counter
ynx_faucet_status_recovery_joined_total %d
# HELP ynx_faucet_capability_probes_total Request-path capability probes.
# TYPE ynx_faucet_capability_probes_total counter
ynx_faucet_capability_probes_total %d
# HELP ynx_faucet_capability_probe_joined_total Request-path callers joining a capability probe.
# TYPE ynx_faucet_capability_probe_joined_total counter
ynx_faucet_capability_probe_joined_total %d
# HELP ynx_faucet_capability_cache_hits_total Request-path uses of a recent successful probe.
# TYPE ynx_faucet_capability_cache_hits_total counter
ynx_faucet_capability_cache_hits_total %d
`, st.fundingStarted, st.fundingJoined, st.fundingActive, st.statusStarted, st.statusJoined, st.capabilityStarted, st.capabilityJoined, st.capabilityCacheHits)
}
