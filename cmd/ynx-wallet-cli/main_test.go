package main

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"
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

func TestDefaultRPCConsumesFrozenEndpointMatrix(t *testing.T) {
	if defaultRPC != "https://rpc.ynxweb4.com/evm" {
		t.Fatalf("unexpected default RPC %q", defaultRPC)
	}
	var observed string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		observed = request.URL.String()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"jsonrpc":"2.0","id":1,"result":"0x1917"}`)), Header: make(http.Header)}, nil
	})}
	if err := run([]string{"chain-status"}, io.Discard, client); err != nil {
		t.Fatal(err)
	}
	if observed != defaultRPC {
		t.Fatalf("default request used %q", observed)
	}
}
