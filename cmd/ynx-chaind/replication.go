package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func startReplicationPolling(ctx context.Context, devnet *chain.Devnet, sourceURL, key string, interval time.Duration, client *http.Client) {
	sourceURL = strings.TrimRight(strings.TrimSpace(sourceURL), "/")
	key = strings.TrimSpace(key)
	if sourceURL == "" || key == "" {
		return
	}
	if interval <= 0 {
		interval = 2 * time.Second
	}
	if client == nil {
		timeout := envDurationOrDefault("YNX_REPLICATION_REQUEST_TIMEOUT", 45*time.Second)
		if timeout < 5*time.Second || timeout > 5*time.Minute {
			timeout = 45 * time.Second
		}
		client = &http.Client{Timeout: timeout}
	}
	allowAuthoritativeRebase := true
	poll := func() {
		devnet.BeginReplicationAttempt()
		payload, err := fetchReplicationSnapshot(ctx, client, sourceURL, key)
		if err != nil {
			devnet.RecordReplicationFailure("fetch", err)
			log.Printf("authoritative replication fetch failed source=%s: %v", sourceURL, err)
			return
		}
		result, err := devnet.ApplyReplicationSnapshotJSON(payload, allowAuthoritativeRebase)
		if err != nil {
			devnet.RecordReplicationFailure("apply", err)
			log.Printf("authoritative replication apply failed source=%s: %v", sourceURL, err)
			return
		}
		devnet.RecordReplicationSuccess(result)
		allowAuthoritativeRebase = false
		if result.Applied {
			log.Printf("authoritative replication applied source=%s height=%d hash=%s", sourceURL, result.Height, result.BlockHash)
		}
	}
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		defer devnet.StopReplicationRuntime()
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

func fetchReplicationSnapshot(ctx context.Context, client *http.Client, sourceURL, key string) ([]byte, error) {
	endpoint := strings.TrimRight(sourceURL, "/") + "/internal/replication/snapshot"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-YNX-Replication-Key", key)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("replication endpoint returned HTTP %d", resp.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, chain.MaxReplicationSnapshotBytes+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > chain.MaxReplicationSnapshotBytes {
		return nil, fmt.Errorf("replication response exceeds %d bytes", chain.MaxReplicationSnapshotBytes)
	}
	presented, err := hex.DecodeString(strings.TrimSpace(resp.Header.Get("X-YNX-Replication-SHA256")))
	if err != nil || len(presented) != sha256.Size {
		return nil, fmt.Errorf("replication response signature is missing or invalid")
	}
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write(payload)
	if subtle.ConstantTimeCompare(mac.Sum(nil), presented) != 1 {
		return nil, fmt.Errorf("replication response signature mismatch")
	}
	return payload, nil
}
