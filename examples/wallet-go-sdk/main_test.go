package main

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func rpcClient(result string) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body := `{"jsonrpc":"2.0","id":1,"result":"` + result + `"}`
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
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
