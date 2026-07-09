package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type peerSyncTarget struct {
	Address string `json:"address"`
	URL     string `json:"url"`
}

func parsePeerSyncTargets(raw string) ([]peerSyncTarget, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if strings.HasPrefix(raw, "[") {
		var targets []peerSyncTarget
		if err := json.Unmarshal([]byte(raw), &targets); err != nil {
			return nil, fmt.Errorf("parse YNX_PEER_RPC_URLS JSON: %w", err)
		}
		return normalizePeerSyncTargets(targets)
	}
	entries := strings.Split(raw, ";")
	targets := make([]peerSyncTarget, 0, len(entries))
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.Split(entry, "|")
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid peer sync target %q: expected address|url", entry)
		}
		targets = append(targets, peerSyncTarget{Address: strings.TrimSpace(parts[0]), URL: strings.TrimSpace(parts[1])})
	}
	return normalizePeerSyncTargets(targets)
}

func normalizePeerSyncTargets(targets []peerSyncTarget) ([]peerSyncTarget, error) {
	out := make([]peerSyncTarget, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		target.Address = strings.TrimSpace(target.Address)
		target.URL = strings.TrimRight(strings.TrimSpace(target.URL), "/")
		if target.Address == "" {
			return nil, fmt.Errorf("peer sync target address is required")
		}
		if target.URL == "" {
			return nil, fmt.Errorf("peer sync target %s url is required", target.Address)
		}
		parsed, err := url.Parse(target.URL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return nil, fmt.Errorf("peer sync target %s has invalid url %q", target.Address, target.URL)
		}
		if seen[target.Address] {
			return nil, fmt.Errorf("duplicate peer sync target %s", target.Address)
		}
		seen[target.Address] = true
		out = append(out, target)
	}
	return out, nil
}

func startPeerSyncPolling(ctx context.Context, devnet *chain.Devnet, source string, targets []peerSyncTarget, interval time.Duration, client *http.Client) {
	source = strings.TrimSpace(source)
	if source == "" || len(targets) == 0 {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Second
	}
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	poll := func() {
		sourceHeight := devnet.LatestHeight()
		for _, target := range targets {
			if target.Address == source {
				continue
			}
			targetHeight, err := fetchPeerHeight(ctx, client, target.URL)
			if err != nil {
				log.Printf("validator peer sync poll failed source=%s target=%s url=%s: %v", source, target.Address, target.URL, err)
				continue
			}
			_, err = devnet.RecordValidatorPeerSync(chain.ValidatorPeerSyncInput{
				Source:       source,
				Target:       target.Address,
				SourceHeight: sourceHeight,
				TargetHeight: targetHeight,
				Evidence:     "peer-rpc-poll:" + target.URL + "/status",
			})
			if err != nil {
				log.Printf("validator peer sync record failed source=%s target=%s: %v", source, target.Address, err)
			}
		}
	}
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		poll()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				poll()
			}
		}
	}()
}

func fetchPeerHeight(ctx context.Context, client *http.Client, baseURL string) (uint64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/status", nil)
	if err != nil {
		return 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("status endpoint returned HTTP %d", resp.StatusCode)
	}
	var payload struct {
		Height any `json:"height"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return 0, err
	}
	height, err := jsonHeight(payload.Height)
	if err != nil {
		return 0, fmt.Errorf("parse peer height: %w", err)
	}
	return height, nil
}

func jsonHeight(value any) (uint64, error) {
	switch v := value.(type) {
	case float64:
		if v < 0 {
			return 0, fmt.Errorf("height is negative")
		}
		return uint64(v), nil
	case string:
		parsed, err := strconv.ParseUint(strings.TrimSpace(v), 10, 64)
		if err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("height missing or unsupported")
	}
}
