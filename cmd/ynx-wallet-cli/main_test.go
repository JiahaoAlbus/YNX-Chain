package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	wallet "github.com/JiahaoAlbus/YNX-Chain/sdk/wallet/go"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSelfTestAndNetworkFailClosed(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"sign-self-test"}, &out, &http.Client{}); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"jsonrpc":"2.0","id":1,"result":"0x1"}`)), Header: make(http.Header)}, nil
	})}
	if err := run([]string{"chain-status", "-rpc", "https://localhost.invalid"}, io.Discard, client); err == nil {
		t.Fatal("wrong chain accepted")
	}
}

func TestChainStatusPreservesStrictSDKTaxonomy(t *testing.T) {
	for _, item := range []struct {
		name   string
		client *http.Client
		code   wallet.ErrorCode
	}{
		{name: "timeout", client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, context.DeadlineExceeded })}, code: wallet.ErrorTransportTimeout},
		{name: "malformed", client: responseClient(200, "not-json"), code: wallet.ErrorMalformedResponse},
		{name: "wrong-chain", client: responseClient(200, `{"jsonrpc":"2.0","id":1,"result":"0x1"}`), code: wallet.ErrorWrongChain},
		{name: "unavailable", client: responseClient(503, `{"error":"down"}`), code: wallet.ErrorRPCUnavailable},
	} {
		t.Run(item.name, func(t *testing.T) {
			err := run([]string{"chain-status", "-rpc", "https://rpc.example.invalid"}, io.Discard, item.client)
			var classified *wallet.TransportError
			if !errors.As(err, &classified) || classified.Code != item.code {
				t.Fatalf("got %v, want %s", err, item.code)
			}
		})
	}
}

func TestTypedExitCodesAndRedactedDiagnostics(t *testing.T) {
	secret := "secret-response-body-and-url"
	for _, item := range []struct {
		name string
		err  *wallet.TransportError
		code int
	}{
		{name: "cancelled", err: &wallet.TransportError{Code: wallet.ErrorTransportCancelled, Detail: secret, Cause: errors.New(secret)}, code: exitCancelled},
		{name: "timeout", err: &wallet.TransportError{Code: wallet.ErrorTransportTimeout, Detail: secret, Cause: errors.New(secret)}, code: exitTimeout},
		{name: "malformed", err: &wallet.TransportError{Code: wallet.ErrorMalformedResponse, Detail: secret}, code: exitData},
		{name: "wrong-chain", err: &wallet.TransportError{Code: wallet.ErrorWrongChain, Detail: secret}, code: exitConfig},
		{name: "unavailable", err: &wallet.TransportError{Code: wallet.ErrorRPCUnavailable, Detail: secret}, code: exitUnavailable},
	} {
		t.Run(item.name, func(t *testing.T) {
			if actual := exitCode(item.err); actual != item.code {
				t.Fatalf("got %d want %d", actual, item.code)
			}
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var diagnostics bytes.Buffer
	requests := 0
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		requests++
		return nil, errors.New(secret)
	})}
	if code := execute(ctx, []string{"chain-status", "-rpc", "https://rpc.example.invalid"}, io.Discard, &diagnostics, client); code != exitCancelled {
		t.Fatalf("got exit %d: %s", code, diagnostics.String())
	}
	if requests != 0 || strings.Contains(diagnostics.String(), secret) || diagnostics.String() != "{\"error\":{\"code\":\"TRANSPORT_CANCELLED\"},\"ok\":false}\n" {
		t.Fatalf("unsafe diagnostic or request count: requests=%d diagnostic=%s", requests, diagnostics.String())
	}
}

func responseClient(status int, body string) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
}

func TestChainStatusUsesCanonicalPublicRPCByDefault(t *testing.T) {
	var requested string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requested = request.URL.String()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"jsonrpc":"2.0","id":1,"result":"0x1917"}`)), Header: make(http.Header)}, nil
	})}
	if err := run([]string{"chain-status"}, io.Discard, client); err != nil {
		t.Fatal(err)
	}
	if requested != "https://rpc.ynxweb4.com/evm" {
		t.Fatalf("unexpected default RPC %q", requested)
	}
}
