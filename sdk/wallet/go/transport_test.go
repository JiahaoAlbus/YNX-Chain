package wallet

import (
	"context"
	"crypto/x509"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (fn transportFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func TestStrictTransportAndHTTPErrorTaxonomy(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code ErrorCode
	}{
		{name: "timeout", err: context.DeadlineExceeded, code: ErrorTransportTimeout},
		{name: "tls", err: x509.UnknownAuthorityError{}, code: ErrorTransportTLS},
		{name: "unavailable", err: errors.New("connection refused"), code: ErrorRPCUnavailable},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			if actual := ClassifyTransportError(item.err); actual.Code != item.code {
				t.Fatalf("got %s, want %s", actual.Code, item.code)
			}
		})
	}
	if actual := ClassifyHTTPFailure(404, []byte(`{"code":"ACCOUNT_NOT_FOUND","message":"account not found"}`), true); actual.Code != ErrorAccountNotFound {
		t.Fatalf("got %s", actual.Code)
	}
	if actual := ClassifyHTTPFailure(404, []byte(`{"error":"route not found"}`), true); actual.Code != ErrorHTTP {
		t.Fatalf("unrelated 404 became %s", actual.Code)
	}
	if actual := ClassifyHTTPFailure(503, []byte(`{"error":"temporarily unavailable"}`), false); actual.Code != ErrorRPCUnavailable {
		t.Fatalf("503 became %s", actual.Code)
	}
}

func TestProbeYNXTestnetRPCTaxonomy(t *testing.T) {
	testCase := func(status int, body string, transportError error) *http.Client {
		return &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
			if transportError != nil {
				return nil, transportError
			}
			return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
		})}
	}
	chainID, err := ProbeYNXTestnetRPC(context.Background(), testCase(200, `{"jsonrpc":"2.0","id":1,"result":"0x1917"}`, nil), "https://rpc.example.invalid")
	if err != nil || chainID != YNXEVMChainID {
		t.Fatalf("valid probe failed: %s %v", chainID, err)
	}
	for _, item := range []struct {
		name   string
		client *http.Client
		code   ErrorCode
	}{
		{name: "malformed", client: testCase(200, `{"jsonrpc":"2.0","id":1}`, nil), code: ErrorMalformedResponse},
		{name: "wrong-chain", client: testCase(200, `{"jsonrpc":"2.0","id":1,"result":"0x1"}`, nil), code: ErrorWrongChain},
		{name: "unavailable", client: testCase(503, `{"error":"down"}`, nil), code: ErrorRPCUnavailable},
		{name: "timeout", client: testCase(0, "", context.DeadlineExceeded), code: ErrorTransportTimeout},
	} {
		t.Run(item.name, func(t *testing.T) {
			_, err := ProbeYNXTestnetRPC(context.Background(), item.client, "https://rpc.example.invalid")
			var classified *TransportError
			if !errors.As(err, &classified) || classified.Code != item.code {
				t.Fatalf("got %v, want %s", err, item.code)
			}
		})
	}
}
