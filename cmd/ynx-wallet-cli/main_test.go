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

func TestChainStatusBindsTheExactJSONRPCID(t *testing.T) {
	for _, test := range []struct {
		name    string
		body    string
		wantErr bool
	}{
		{name: "exact response ID", body: `{"jsonrpc":"2.0","id":1,"result":"0x1917"}`},
		{name: "mismatched response ID", body: `{"jsonrpc":"2.0","id":2,"result":"0x1917"}`, wantErr: true},
		{name: "unknown response field", body: `{"jsonrpc":"2.0","id":1,"result":"0x1917","unsafe":true}`, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(test.body)), Header: make(http.Header)}, nil
			})}
			err := run([]string{"chain-status", "-rpc", "https://localhost.invalid"}, io.Discard, client)
			if test.wantErr && err == nil {
				t.Fatal("unsafe JSON-RPC response was accepted")
			}
			if !test.wantErr && err != nil {
				t.Fatalf("exact JSON-RPC response rejected: %v", err)
			}
		})
	}
}
