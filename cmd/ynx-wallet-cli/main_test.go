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
	if requests != 0 || strings.Contains(diagnostics.String(), secret) || diagnostics.String() != "{\"error\":{\"code\":\"TRANSPORT_CANCELLED\",\"summary\":\"The request was cancelled.\",\"remediation\":\"RETRY_WHEN_READY\"},\"ok\":false}\n" {
		t.Fatalf("unsafe diagnostic or request count: requests=%d diagnostic=%s", requests, diagnostics.String())
	}
}

func TestHelpAndExactConfigValidation(t *testing.T) {
	var help bytes.Buffer
	if err := run([]string{"help"}, &help, &http.Client{}); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"YNX Wallet CLI (Testnet)", "ynx_6423-1 / 6423 / 0x1917 / YNXT", "never requests an account, signs, or sends a transaction"} {
		if !strings.Contains(help.String(), required) {
			t.Fatalf("help missing %q", required)
		}
	}
	var output bytes.Buffer
	if err := run([]string{"validate-config"}, &output, &http.Client{}); err != nil || !strings.Contains(output.String(), `"chainId":6423`) || !strings.Contains(output.String(), `"evmChainId":"0x1917"`) {
		t.Fatalf("valid config failed: %v %s", err, output.String())
	}
	for _, args := range [][]string{
		{"validate-config", "--native-chain", "ynx_9102-1"},
		{"validate-config", "--chain-id", "9102"},
		{"validate-config", "--evm-chain-id", "0x238e"},
		{"validate-config", "--native-currency", "OLD"},
	} {
		var diagnostics bytes.Buffer
		if code := execute(context.Background(), args, io.Discard, &diagnostics, &http.Client{}); code != exitConfig || !strings.Contains(diagnostics.String(), `"remediation":"USE_YNX_TESTNET_6423"`) {
			t.Fatalf("legacy config did not fail closed: code=%d diagnostic=%s", code, diagnostics.String())
		}
	}
}

func TestChainStatusRejectsLegacyConfigBeforeTransport(t *testing.T) {
	for _, args := range [][]string{
		{"chain-status", "--native-chain", "ynx_9102-1"},
		{"chain-status", "--chain-id", "9102"},
		{"chain-status", "--evm-chain-id", "0x238e"},
		{"chain-status", "--native-currency", "OLD"},
	} {
		requests := 0
		client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			requests++
			return nil, errors.New("transport must not execute")
		})}
		var diagnostics bytes.Buffer
		code := execute(context.Background(), args, io.Discard, &diagnostics, client)
		if code != exitConfig || requests != 0 || !strings.Contains(diagnostics.String(), `"remediation":"USE_YNX_TESTNET_6423"`) {
			t.Fatalf("args=%v code=%d requests=%d diagnostic=%s", args, code, requests, diagnostics.String())
		}
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
