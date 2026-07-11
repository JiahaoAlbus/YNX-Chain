package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestFetchReplicationSnapshotVerifiesSignature(t *testing.T) {
	source := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	source.ProduceBlock()
	payload, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-YNX-Replication-Key") != "replication-key" {
			t.Fatal("missing replication key")
		}
		mac := hmac.New(sha256.New, []byte("replication-key"))
		_, _ = mac.Write(payload)
		w.Header().Set("X-YNX-Replication-SHA256", hex.EncodeToString(mac.Sum(nil)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	got, err := fetchReplicationSnapshot(context.Background(), server.Client(), server.URL, "replication-key")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatal("replication payload changed")
	}
}

func TestFetchReplicationSnapshotRejectsBadSignature(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-YNX-Replication-SHA256", strings.Repeat("00", sha256.Size))
		_, _ = w.Write([]byte(`{"version":1}`))
	}))
	defer server.Close()
	_, err := fetchReplicationSnapshot(context.Background(), server.Client(), server.URL, "replication-key")
	if err == nil || !strings.Contains(err.Error(), "signature mismatch") {
		t.Fatalf("expected signature mismatch, got %v", err)
	}
}
