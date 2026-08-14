package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type sample struct {
	Latency time.Duration
	Status  int
	Err     string
}

type latencySummary struct {
	P50Millis float64 `json:"p50Millis"`
	P95Millis float64 `json:"p95Millis"`
	P99Millis float64 `json:"p99Millis"`
	MaxMillis float64 `json:"maxMillis"`
}

type report struct {
	Schema            string         `json:"schema"`
	BaseURL           string         `json:"baseUrl"`
	StartedAt         time.Time      `json:"startedAt"`
	FinishedAt        time.Time      `json:"finishedAt"`
	DurationSeconds   float64        `json:"durationSeconds"`
	Concurrency       int            `json:"concurrency"`
	SSEClients        int            `json:"sseClients"`
	Requests          int            `json:"requests"`
	RequestsPerSecond float64        `json:"requestsPerSecond"`
	Errors            int            `json:"errors"`
	ErrorRate         float64        `json:"errorRate"`
	StatusCodes       map[int]int    `json:"statusCodes"`
	Latency           latencySummary `json:"latency"`
	SSEEvents         int64          `json:"sseEvents"`
	SSEReconnects     int64          `json:"sseReconnects"`
	SSEErrors         int64          `json:"sseErrors"`
}

func main() {
	var (
		baseURL     = flag.String("base-url", "", "Explorer origin, for example https://explorer.example")
		duration    = flag.Duration("duration", 30*time.Second, "test duration")
		concurrency = flag.Int("concurrency", 20, "concurrent HTTP workers")
		sseClients  = flag.Int("sse-clients", 5, "concurrent SSE subscribers")
		searchQuery = flag.String("search-query", "", "real block, transaction, address, token, or contract query")
		timeout     = flag.Duration("timeout", 5*time.Second, "per-request timeout")
		allowLocal  = flag.Bool("allow-http-local", false, "allow plain HTTP only for loopback local verification")
	)
	flag.Parse()

	if err := run(*baseURL, *duration, *concurrency, *sseClients, *searchQuery, *timeout, *allowLocal, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "explorer load verification failed:", err)
		os.Exit(1)
	}
}

func run(base string, duration time.Duration, concurrency, sseClients int, searchQuery string, timeout time.Duration, allowLocal bool, out io.Writer) error {
	origin, err := validateOrigin(base, allowLocal)
	if err != nil {
		return err
	}
	if duration <= 0 || concurrency <= 0 || sseClients < 0 || timeout <= 0 {
		return errors.New("duration, concurrency and timeout must be positive; sse-clients cannot be negative")
	}

	paths := []string{"/api/summary", "/api/blocks/latest?limit=12", "/api/txs?limit=12"}
	if strings.TrimSpace(searchQuery) != "" {
		paths = append(paths, "/api/search?q="+url.QueryEscape(strings.TrimSpace(searchQuery)))
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = concurrency + sseClients + 16
	transport.MaxIdleConnsPerHost = concurrency + sseClients + 16
	transport.MaxConnsPerHost = concurrency + sseClients + 16
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	client := &http.Client{Transport: transport, Timeout: timeout}

	started := time.Now().UTC()
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()
	samples := make(chan sample, concurrency*8)
	var sseEvents, sseReconnects, sseErrors atomic.Int64
	var workers sync.WaitGroup

	for worker := 0; worker < concurrency; worker++ {
		workers.Add(1)
		go func(offset int) {
			defer workers.Done()
			sequence := offset
			for ctx.Err() == nil {
				path := paths[sequence%len(paths)]
				sequence++
				startedRequest := time.Now()
				req, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, origin+path, nil)
				if requestErr != nil {
					samples <- sample{Latency: time.Since(startedRequest), Err: requestErr.Error()}
					continue
				}
				req.Header.Set("Accept", "application/json")
				resp, requestErr := client.Do(req)
				latency := time.Since(startedRequest)
				if requestErr != nil {
					if ctx.Err() == nil {
						samples <- sample{Latency: latency, Err: requestErr.Error()}
					}
					continue
				}
				_, copyErr := io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<20))
				resp.Body.Close()
				entry := sample{Latency: latency, Status: resp.StatusCode}
				if copyErr != nil {
					entry.Err = copyErr.Error()
				} else if resp.StatusCode < 200 || resp.StatusCode >= 300 {
					entry.Err = http.StatusText(resp.StatusCode)
				}
				samples <- entry
			}
		}(worker)
	}

	for subscriber := 0; subscriber < sseClients; subscriber++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for ctx.Err() == nil {
				req, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/api/stream", nil)
				if requestErr != nil {
					sseErrors.Add(1)
					return
				}
				req.Header.Set("Accept", "text/event-stream")
				resp, requestErr := transport.RoundTrip(req)
				if requestErr != nil {
					if ctx.Err() == nil {
						sseErrors.Add(1)
						sseReconnects.Add(1)
					}
					continue
				}
				if resp.StatusCode != http.StatusOK {
					resp.Body.Close()
					sseErrors.Add(1)
					sseReconnects.Add(1)
					continue
				}
				scanner := bufio.NewScanner(resp.Body)
				scanner.Buffer(make([]byte, 64<<10), 2<<20)
				for scanner.Scan() {
					if strings.HasPrefix(scanner.Text(), "event:") {
						sseEvents.Add(1)
					}
				}
				resp.Body.Close()
				if ctx.Err() == nil {
					if scanner.Err() != nil {
						sseErrors.Add(1)
					}
					sseReconnects.Add(1)
				}
			}
		}()
	}

	go func() {
		workers.Wait()
		close(samples)
	}()

	collected := make([]sample, 0, concurrency*128)
	for entry := range samples {
		collected = append(collected, entry)
	}
	finished := time.Now().UTC()
	result := summarize(origin, started, finished, concurrency, sseClients, collected, sseEvents.Load(), sseReconnects.Load(), sseErrors.Load())
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		return err
	}
	if result.Requests == 0 {
		return errors.New("no HTTP samples were completed")
	}
	if result.Errors > 0 || result.SSEErrors > 0 {
		return fmt.Errorf("verification observed %d HTTP errors and %d SSE errors", result.Errors, result.SSEErrors)
	}
	return nil
}

func validateOrigin(raw string, allowLocal bool) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("base-url must be an absolute origin without credentials, query or fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", errors.New("base-url must not include a path")
	}
	if parsed.Scheme != "https" {
		local := parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1")
		if !allowLocal || !local {
			return "", errors.New("base-url must use HTTPS; plain HTTP is restricted to explicit loopback verification")
		}
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func summarize(base string, started, finished time.Time, concurrency, sseClients int, samples []sample, sseEvents, sseReconnects, sseErrors int64) report {
	latencies := make([]time.Duration, 0, len(samples))
	statuses := map[int]int{}
	errorsSeen := 0
	for _, entry := range samples {
		latencies = append(latencies, entry.Latency)
		if entry.Status != 0 {
			statuses[entry.Status]++
		}
		if entry.Err != "" {
			errorsSeen++
		}
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	elapsed := finished.Sub(started).Seconds()
	result := report{
		Schema: "ynx.explorer.load.v1", BaseURL: base, StartedAt: started, FinishedAt: finished,
		DurationSeconds: elapsed, Concurrency: concurrency, SSEClients: sseClients, Requests: len(samples),
		Errors: errorsSeen, StatusCodes: statuses, SSEEvents: sseEvents, SSEReconnects: sseReconnects, SSEErrors: sseErrors,
	}
	if elapsed > 0 {
		result.RequestsPerSecond = float64(len(samples)) / elapsed
	}
	if len(samples) > 0 {
		result.ErrorRate = float64(errorsSeen) / float64(len(samples))
	}
	if len(latencies) > 0 {
		result.Latency = latencySummary{
			P50Millis: millis(percentile(latencies, 0.50)), P95Millis: millis(percentile(latencies, 0.95)),
			P99Millis: millis(percentile(latencies, 0.99)), MaxMillis: millis(latencies[len(latencies)-1]),
		}
	}
	return result
}

func percentile(values []time.Duration, quantile float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	index := int(float64(len(values)-1) * quantile)
	return values[index]
}

func millis(value time.Duration) float64 { return float64(value.Microseconds()) / 1000 }
