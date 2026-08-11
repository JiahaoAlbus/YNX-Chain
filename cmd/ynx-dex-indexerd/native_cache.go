package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const nativeDEXSource = "authoritative chain-native YNX Testnet state"

var nativeDEXReadPaths = []string{"/dex/assets", "/dex/pools", "/dex/events"}

type nativeDEXCacheEntry struct {
	body      []byte
	etag      string
	fetchedAt time.Time
}

type nativeDEXCache struct {
	upstream *url.URL
	next     http.Handler
	client   *http.Client
	now      func() time.Time
	mu       sync.RWMutex
	entries  map[string]nativeDEXCacheEntry
}

func newNativeDEXCache(upstream string, next http.Handler) *nativeDEXCache {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(upstream), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		panic("YNX_DEX_NATIVE_URL must be an absolute HTTP URL")
	}
	return &nativeDEXCache{
		upstream: parsed,
		next:     next,
		client:   &http.Client{Timeout: 8 * time.Second},
		now:      time.Now,
		entries:  map[string]nativeDEXCacheEntry{},
	}
}

func (c *nativeDEXCache) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || !isNativeDEXReadPath(r.URL.Path) {
		c.next.ServeHTTP(w, r)
		return
	}
	c.mu.RLock()
	entry, ok := c.entries[r.URL.Path]
	c.mu.RUnlock()
	if !ok || c.now().Sub(entry.fetchedAt) > 2*time.Minute {
		http.Error(w, "authoritative DEX snapshot is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=1, stale-while-revalidate=15")
	w.Header().Set("ETag", entry.etag)
	w.Header().Set("X-YNX-Authoritative-Snapshot-Age", c.now().Sub(entry.fetchedAt).Round(time.Millisecond).String())
	if r.Header.Get("If-None-Match") == entry.etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	_, _ = w.Write(entry.body)
}

func (c *nativeDEXCache) run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refreshContext, cancel := context.WithTimeout(ctx, 25*time.Second)
			if err := c.refresh(refreshContext); err != nil {
				log.Printf("YNX DEX native cache refresh incomplete: %v", err)
			}
			cancel()
		}
	}
}

func (c *nativeDEXCache) refresh(ctx context.Context) error {
	var failures []error
	for _, path := range nativeDEXReadPaths {
		if err := c.refreshPath(ctx, path); err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", path, err))
		}
	}
	return errors.Join(failures...)
}

func (c *nativeDEXCache) refreshPath(ctx context.Context, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.upstream.String()+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	response, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20+1))
	if err != nil {
		return err
	}
	if len(body) > 4<<20 {
		return errors.New("upstream response exceeds 4 MiB")
	}
	var envelope struct {
		Source string          `json:"source"`
		Items  json.RawMessage `json:"items"`
	}
	if json.Unmarshal(body, &envelope) != nil || envelope.Source != nativeDEXSource || len(envelope.Items) == 0 || envelope.Items[0] != '[' {
		return errors.New("upstream response is not an authoritative DEX collection")
	}
	sum := sha256.Sum256(body)
	entry := nativeDEXCacheEntry{body: append([]byte(nil), body...), etag: `"` + hex.EncodeToString(sum[:]) + `"`, fetchedAt: c.now()}
	c.mu.Lock()
	c.entries[path] = entry
	c.mu.Unlock()
	return nil
}

func isNativeDEXReadPath(path string) bool {
	for _, candidate := range nativeDEXReadPaths {
		if path == candidate {
			return true
		}
	}
	return false
}
