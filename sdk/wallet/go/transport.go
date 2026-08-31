package wallet

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type ErrorCode string

const (
	ErrorAccountNotFound    ErrorCode = "ACCOUNT_NOT_FOUND"
	ErrorHTTP               ErrorCode = "HTTP_ERROR"
	ErrorJSONRPC            ErrorCode = "JSON_RPC_ERROR"
	ErrorMalformedResponse  ErrorCode = "MALFORMED_RESPONSE"
	ErrorRPCUnavailable     ErrorCode = "RPC_UNAVAILABLE"
	ErrorTransportCancelled ErrorCode = "TRANSPORT_CANCELLED"
	ErrorTransportTLS       ErrorCode = "TRANSPORT_TLS"
	ErrorTransportTimeout   ErrorCode = "TRANSPORT_TIMEOUT"
	ErrorWrongChain         ErrorCode = "WRONG_CHAIN"
)

const (
	YNXNativeChainID = "ynx_6423-1"
	YNXEVMChainID    = "0x1917"
	YNXChainID       = 6423
)

type TransportError struct {
	Code       ErrorCode
	HTTPStatus int
	RPCCode    int
	Cause      error
	Detail     string
}

func (e *TransportError) Error() string {
	if e.HTTPStatus != 0 {
		return fmt.Sprintf("%s (HTTP %d): %s", e.Code, e.HTTPStatus, e.Detail)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Detail)
}

func (e *TransportError) Unwrap() error { return e.Cause }

// ClassifyTransportError preserves timeout and TLS failures instead of
// collapsing every failed request into RPC_UNAVAILABLE.
func ClassifyTransportError(err error) *TransportError {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return &TransportError{Code: ErrorTransportCancelled, Cause: err, Detail: "request was cancelled"}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &TransportError{Code: ErrorTransportTimeout, Cause: err, Detail: "request timed out"}
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return &TransportError{Code: ErrorTransportTimeout, Cause: err, Detail: "request timed out"}
	}
	var unknownAuthority x509.UnknownAuthorityError
	var certificateInvalid x509.CertificateInvalidError
	var hostnameError x509.HostnameError
	message := strings.ToLower(err.Error())
	if errors.As(err, &unknownAuthority) || errors.As(err, &certificateInvalid) || errors.As(err, &hostnameError) || strings.Contains(message, "tls handshake") || strings.Contains(message, "certificate") {
		return &TransportError{Code: ErrorTransportTLS, Cause: err, Detail: "TLS validation failed"}
	}
	return &TransportError{Code: ErrorRPCUnavailable, Cause: err, Detail: "RPC transport is unavailable"}
}

// ClassifyHTTPFailure treats a 404 as authoritative account absence only for
// an account lookup and only when the response carries that exact semantic.
func ClassifyHTTPFailure(status int, body []byte, accountLookup bool) *TransportError {
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Error   any    `json:"error"`
	}
	_ = json.Unmarshal(body, &payload)
	code, message := payload.Code, payload.Message
	switch value := payload.Error.(type) {
	case string:
		if message == "" {
			message = value
		}
	case map[string]any:
		if nested, ok := value["code"].(string); ok && code == "" {
			code = nested
		}
		if nested, ok := value["message"].(string); ok && message == "" {
			message = nested
		}
	}
	if accountLookup && status == http.StatusNotFound && (code == string(ErrorAccountNotFound) || strings.EqualFold(strings.TrimSpace(message), "account not found")) {
		return &TransportError{Code: ErrorAccountNotFound, HTTPStatus: status, Detail: "authoritative account does not exist"}
	}
	if status == http.StatusBadGateway || status == http.StatusServiceUnavailable || status == http.StatusGatewayTimeout {
		return &TransportError{Code: ErrorRPCUnavailable, HTTPStatus: status, Detail: "RPC service is unavailable"}
	}
	return &TransportError{Code: ErrorHTTP, HTTPStatus: status, Detail: "endpoint returned a non-success status"}
}

func ProbeYNXTestnetRPC(ctx context.Context, client *http.Client, endpoint string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", ClassifyTransportError(err)
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", &TransportError{Code: ErrorHTTP, Cause: err, Detail: "RPC must be an absolute HTTPS URL without userinfo"}
	}
	requestBody := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), requestBody)
	if err != nil {
		return "", &TransportError{Code: ErrorHTTP, Cause: err, Detail: "could not create RPC request"}
	}
	request.Header.Set("content-type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return "", ClassifyTransportError(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil {
		return "", ClassifyTransportError(err)
	}
	if len(body) > 1<<20 {
		return "", &TransportError{Code: ErrorMalformedResponse, HTTPStatus: response.StatusCode, Detail: "RPC response exceeds 1 MiB"}
	}
	if response.StatusCode != http.StatusOK {
		return "", ClassifyHTTPFailure(response.StatusCode, body, false)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil || len(envelope) != 3 {
		return "", &TransportError{Code: ErrorMalformedResponse, HTTPStatus: response.StatusCode, Cause: err, Detail: "RPC JSON envelope is malformed"}
	}
	var version string
	var id int
	if json.Unmarshal(envelope["jsonrpc"], &version) != nil || json.Unmarshal(envelope["id"], &id) != nil || version != "2.0" || id != 1 {
		return "", &TransportError{Code: ErrorMalformedResponse, HTTPStatus: response.StatusCode, Detail: "RPC JSON envelope is malformed"}
	}
	if rawError, ok := envelope["error"]; ok {
		if _, hasResult := envelope["result"]; hasResult {
			return "", &TransportError{Code: ErrorMalformedResponse, HTTPStatus: response.StatusCode, Detail: "RPC JSON envelope contains both result and error"}
		}
		var rpcError struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(rawError, &rpcError) != nil || rpcError.Message == "" {
			return "", &TransportError{Code: ErrorMalformedResponse, HTTPStatus: response.StatusCode, Detail: "RPC error object is malformed"}
		}
		return "", &TransportError{Code: ErrorJSONRPC, HTTPStatus: response.StatusCode, RPCCode: rpcError.Code, Detail: fmt.Sprintf("RPC returned error %d: %s", rpcError.Code, rpcError.Message)}
	}
	var chainID string
	if _, ok := envelope["result"]; !ok || json.Unmarshal(envelope["result"], &chainID) != nil || !canonicalHexQuantity(chainID) {
		return "", &TransportError{Code: ErrorMalformedResponse, HTTPStatus: response.StatusCode, Detail: "RPC result is malformed"}
	}
	if chainID != YNXEVMChainID {
		return "", &TransportError{Code: ErrorWrongChain, HTTPStatus: response.StatusCode, Detail: fmt.Sprintf("RPC returned %q instead of %s", chainID, YNXEVMChainID)}
	}
	return chainID, nil
}

func canonicalHexQuantity(value string) bool {
	if value == "0x0" {
		return true
	}
	if len(value) < 3 || !strings.HasPrefix(value, "0x") || value[2] == '0' {
		return false
	}
	for _, character := range value[2:] {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
