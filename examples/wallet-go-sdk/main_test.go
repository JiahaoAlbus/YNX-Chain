package main

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	wallet "github.com/JiahaoAlbus/YNX-Chain/sdk/wallet/go"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func rpcClient(result string) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body := `{"jsonrpc":"2.0","id":1,"result":"` + result + `"}`
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
}

func TestConsumerPreservesWrongChainAndUnavailableTaxonomy(t *testing.T) {
	args := []string{"-rpc", "https://rpc.example.invalid", "-vector", "../../packages/wallet-auth/testdata/product-session-http-proof-v1.json"}
	for _, item := range []struct {
		name   string
		client *http.Client
		code   wallet.ErrorCode
	}{
		{name: "wrong-chain", client: rpcClient("0x1"), code: wallet.ErrorWrongChain},
		{name: "unavailable", client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("connection refused") })}, code: wallet.ErrorRPCUnavailable},
	} {
		t.Run(item.name, func(t *testing.T) {
			err := run(args, io.Discard, item.client)
			var classified *wallet.TransportError
			if !errors.As(err, &classified) || classified.Code != item.code {
				t.Fatalf("got %v, want %s", err, item.code)
			}
		})
	}
}

func TestRealConsumerFlowAndWrongChainFailClosed(t *testing.T) {
	var output bytes.Buffer
	args := []string{"-rpc", "https://rpc.example.invalid", "-vector", "../../packages/wallet-auth/testdata/product-session-http-proof-v1.json"}
	if err := run(args, &output, rpcClient("0x1917")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"chainId":"0x1917"`) || !strings.Contains(output.String(), `"privateKeyPersisted":false`) {
		t.Fatalf("unexpected output: %s", output.String())
	}
	if err := run(args, &output, rpcClient("0x1")); err == nil {
		t.Fatal("wrong chain was accepted")
	}
}

func TestNonHTTPSRPCFailsBeforeNetwork(t *testing.T) {
	err := run([]string{"-rpc", "http://127.0.0.1:1", "-vector", "../../packages/wallet-auth/testdata/product-session-http-proof-v1.json"}, &bytes.Buffer{}, &http.Client{})
	if err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("expected HTTPS failure, got %v", err)
	}
}

func TestDefaultRPCConsumesCentralEndpointMatrix(t *testing.T) {
	var requested string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requested = request.URL.String()
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"jsonrpc":"2.0","id":1,"result":"0x1917"}`))}, nil
	})}
	if err := run([]string{"-vector", "../../packages/wallet-auth/testdata/product-session-http-proof-v1.json"}, &bytes.Buffer{}, client); err != nil {
		t.Fatal(err)
	}
	if requested != "https://rpc.ynxweb4.com/evm" {
		t.Fatalf("unexpected default RPC %q", requested)
	}
}
