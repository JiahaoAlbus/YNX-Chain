package wallet

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
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
		{name: "cancelled", err: context.Canceled, code: ErrorTransportCancelled},
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

func TestSharedTypeScriptGoTaxonomyVectorAnd6423OnlyPolicy(t *testing.T) {
	data, err := os.ReadFile("../../../testdata/wallet-sdk-error-taxonomy-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Version int `json:"version"`
		Network struct {
			NativeChainID     string `json:"nativeChainId"`
			ChainIDDecimal    int    `json:"chainIdDecimal"`
			EVMChainID        string `json:"evmChainId"`
			ForbiddenChainIDs []any  `json:"forbiddenChainIds"`
		} `json:"network"`
		RequestPolicy struct {
			ImplicitRetries bool `json:"implicitRetries"`
			MaximumAttempts int  `json:"maximumAttempts"`
		} `json:"requestPolicy"`
		ErrorCodes []ErrorCode `json:"errorCodes"`
		HTTPCases  []struct {
			Name          string         `json:"name"`
			Status        int            `json:"status"`
			AccountLookup bool           `json:"accountLookup"`
			Body          map[string]any `json:"body"`
			Expected      ErrorCode      `json:"expected"`
		} `json:"httpCases"`
	}
	if err := json.Unmarshal(data, &vector); err != nil {
		t.Fatal(err)
	}
	if vector.Version != 1 || vector.Network.NativeChainID != YNXNativeChainID || vector.Network.ChainIDDecimal != YNXChainID || vector.Network.EVMChainID != YNXEVMChainID {
		t.Fatalf("unexpected frozen network: %+v", vector.Network)
	}
	if vector.RequestPolicy.ImplicitRetries || vector.RequestPolicy.MaximumAttempts != 1 {
		t.Fatalf("unexpected request policy: %+v", vector.RequestPolicy)
	}
	wantCodes := []ErrorCode{ErrorAccountNotFound, ErrorHTTP, ErrorJSONRPC, ErrorMalformedResponse, ErrorRPCUnavailable, ErrorTransportCancelled, ErrorTransportTimeout, ErrorTransportTLS, ErrorWrongChain}
	if len(vector.ErrorCodes) != len(wantCodes) {
		t.Fatalf("unexpected error codes: %+v", vector.ErrorCodes)
	}
	for index := range wantCodes {
		if vector.ErrorCodes[index] != wantCodes[index] {
			t.Fatalf("error code %d: got %s want %s", index, vector.ErrorCodes[index], wantCodes[index])
		}
	}
	if len(vector.Network.ForbiddenChainIDs) != 2 || vector.Network.ForbiddenChainIDs[0] != float64(9102) || vector.Network.ForbiddenChainIDs[1] != "0x238e" {
		t.Fatalf("9102 rejection vector drifted: %+v", vector.Network.ForbiddenChainIDs)
	}
	for _, item := range vector.HTTPCases {
		body, err := json.Marshal(item.Body)
		if err != nil {
			t.Fatal(err)
		}
		if actual := ClassifyHTTPFailure(item.Status, body, item.AccountLookup); actual.Code != item.Expected {
			t.Fatalf("%s: got %s, want %s", item.Name, actual.Code, item.Expected)
		}
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
		{name: "batch", client: testCase(200, `[{"jsonrpc":"2.0","id":1,"result":"0x1917"}]`, nil), code: ErrorMalformedResponse},
		{name: "notification", client: testCase(200, `{"jsonrpc":"2.0","result":"0x1917"}`, nil), code: ErrorMalformedResponse},
		{name: "malformed-id", client: testCase(200, `{"jsonrpc":"2.0","id":"1","result":"0x1917"}`, nil), code: ErrorMalformedResponse},
		{name: "malformed-result", client: testCase(200, `{"jsonrpc":"2.0","id":1,"result":null}`, nil), code: ErrorMalformedResponse},
		{name: "json-rpc-error", client: testCase(200, `{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"method unavailable"}}`, nil), code: ErrorJSONRPC},
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

func TestRedactedDiagnosticExcludesCauseDetailAndEndpoint(t *testing.T) {
	secret := "secret-response-body-and-url"
	err := &TransportError{Code: ErrorJSONRPC, HTTPStatus: 200, RPCCode: -32001, Detail: "https://user:" + secret + "@example.invalid/" + secret, Cause: errors.New(secret)}
	encoded, marshalErr := json.Marshal(RedactedDiagnostic(err))
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if strings.Contains(string(encoded), secret) || string(encoded) != `{"code":"JSON_RPC_ERROR","httpStatus":200,"rpcCode":-32001}` {
		t.Fatalf("unsafe diagnostic: %s", encoded)
	}
}

func TestCancelledContextDoesNotStartARequest(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("must not execute")
	})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := ProbeYNXTestnetRPC(ctx, client, "https://rpc.example.invalid")
	var classified *TransportError
	if !errors.As(err, &classified) || classified.Code != ErrorTransportCancelled || calls != 0 {
		t.Fatalf("got error=%v calls=%d", err, calls)
	}
}

func TestProbeUsesOneBoundedAttemptWithoutImplicitRetry(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusServiceUnavailable, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"down"}`))}, nil
	})}
	_, err := ProbeYNXTestnetRPC(context.Background(), client, "https://rpc.example.invalid")
	var classified *TransportError
	if !errors.As(err, &classified) || classified.Code != ErrorRPCUnavailable || calls != 1 {
		t.Fatalf("got error=%v calls=%d", err, calls)
	}
}
