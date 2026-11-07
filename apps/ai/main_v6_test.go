package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
	taskv6 "github.com/JiahaoAlbus/YNX-Chain/internal/authaitaskv6"
)

// This uses the actual normal factory, encrypted Store and public HTTP stack.
// It supplies no registered principal, Root, Source, signer or provider.
func TestNormalV6MissingRegistrationLifecycle(t *testing.T) {
	state := filepath.Join(t.TempDir(), "PUBLIC-empty-state.json")
	store, err := aiproduct.NewStore(state, bytes.Repeat([]byte{0x11}, 32))
	if err != nil {
		t.Fatal(err)
	}
	web, err := fs.Sub(assets, "web")
	if err != nil {
		t.Fatal(err)
	}
	server, err := aiproduct.NewServer(aiproduct.Config{
		GatewayURL: "http://127.0.0.1:1", GatewayKey: "PUBLIC-no-provider-key",
		ExactWalletCallback: "ynxai://wallet-auth/callback",
	}, store, web)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(state)
	if err != nil {
		t.Fatal(err)
	}
	for round := 0; round < 2; round++ {
		owner, openErr := taskv6.OpenOriginalAITaskActionServerV6(server)
		if owner == nil || !errors.Is(openErr, taskv6.ErrV6NormalRegistration) {
			t.Fatalf("normal registration absence changed: owner=%t err=%v", owner != nil, openErr)
		}
		public := httptest.NewServer(owner.Handler())
		for _, proof := range []string{"", "PUBLIC-invalid-v6"} {
			request, _ := http.NewRequest(http.MethodPost, public.URL+"/api/tasks", strings.NewReader(`{"conversationId":"PUBLIC-absent"}`))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Ynx-Product-Session-Proof-V6", proof)
			request.Header.Set("X-Ynx-Product-Session-Proof", "PUBLIC-old-proof")
			response, e := public.Client().Do(request)
			if e != nil {
				t.Fatal(e)
			}
			body, e := io.ReadAll(response.Body)
			response.Body.Close()
			if e != nil || response.StatusCode != http.StatusServiceUnavailable || !bytes.Contains(body, []byte("AI_V6_NORMAL_RUNTIME_NOT_SUPPLIED")) {
				t.Fatalf("V6 reached legacy or business path: status=%d body=%s err=%v", response.StatusCode, body, e)
			}
		}
		response, err := public.Client().Get(public.URL + "/healthz")
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatal("unavailable V6 blocked normal health")
		}
		public.Close() // All original public handlers drain before retirement.
		if err := closeOriginalTaskV6(owner, time.Second); err != nil {
			t.Fatal(err)
		}
		if err := closeOriginalTaskV6(owner, time.Second); err != nil {
			t.Fatal("repeated cleanup changed first result", err)
		}
		request := httptest.NewRequest(http.MethodPost, "/api/tasks", nil)
		request.Header.Set("X-Ynx-Product-Session-Proof-V6", "PUBLIC-invalid-v6")
		writer := httptest.NewRecorder()
		owner.Handler().ServeHTTP(writer, request)
		if writer.Code != http.StatusServiceUnavailable {
			t.Fatal("retired V6 owner accepted another request")
		}
	}
	after, err := os.ReadFile(state)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("unregistered V6 changed original encrypted state", err)
	}
}

func TestNormalV6FailedAcquisitionPartialCleanup(t *testing.T) {
	owner, err := taskv6.OpenOriginalAITaskActionServerV6(nil)
	if owner == nil || err == nil {
		t.Fatal("invalid original Server lost its partial owner")
	}
	if err := closeOriginalTaskV6(owner, time.Second); err != nil {
		t.Fatal(err)
	}
	if err := closeOriginalTaskV6(nil, time.Second); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// No active transport or child was created by the failed constructor.
	if err := owner.Join(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestNormalReadReceiverMissingRegistrationLifecycle(t *testing.T) {
	state := filepath.Join(t.TempDir(), "PUBLIC-read-receiver.json")
	store, err := aiproduct.NewStore(state, bytes.Repeat([]byte{0x19}, 32))
	if err != nil {
		t.Fatal(err)
	}
	web, err := fs.Sub(assets, "web")
	if err != nil {
		t.Fatal(err)
	}
	server, err := aiproduct.NewServer(aiproduct.Config{GatewayURL: "http://127.0.0.1:1", GatewayKey: "PUBLIC-no-provider-key", ExactWalletCallback: "ynxai://wallet-auth/callback"}, store, web)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(state)
	if err != nil {
		t.Fatal(err)
	}
	owner, openErr := aiproduct.OpenOriginalTaskReadReceiver(context.Background(), server)
	if owner == nil || openErr == nil {
		t.Fatal("missing original Source created a receiver")
	}
	for round := 0; round < 2; round++ {
		if err := closeOriginalTaskReadReceiver(owner, time.Second); err != nil {
			t.Fatal(err)
		}
	}
	after, err := os.ReadFile(state)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("unavailable mount altered original Store")
	}
}
