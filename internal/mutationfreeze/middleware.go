package mutationfreeze

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
)

const EnvFile = "YNX_MUTATION_FREEZE_FILE"

var readOnlyEVMMethods = map[string]struct{}{
	"eth_chainId": {}, "net_version": {}, "eth_blockNumber": {},
	"eth_getBalance": {}, "eth_getTransactionCount": {}, "eth_getBlockByNumber": {}, "eth_getBlockByHash": {},
	"eth_getTransactionByHash": {}, "eth_getTransactionReceipt": {},
	"eth_estimateGas": {}, "eth_call": {}, "eth_getLogs": {},
}

// FromEnv adds a runtime mutation freeze when YNX_MUTATION_FREEZE_FILE is set.
// Creating or removing the marker changes behavior without restarting a service.
func FromEnv(next http.Handler) http.Handler {
	markerPath := strings.TrimSpace(os.Getenv(EnvFile))
	if markerPath == "" {
		return next
	}
	return Wrap(next, markerPath)
}

func Wrap(next http.Handler, markerPath string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		frozen, err := markerExists(markerPath)
		if err == nil && !frozen {
			next.ServeHTTP(w, r)
			return
		}
		if !isMutation(r) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "5")
		w.Header().Set("X-YNX-Mutation-Frozen", "true")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":  "public mutations are temporarily frozen for a verified chain transition",
			"status": "mutation_frozen",
		})
	})
}

func markerExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return true, err
}

func isMutation(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	case http.MethodPost:
		if r.URL.Path == "/v1/chat/completions" {
			return false
		}
		if r.URL.Path == "/evm" || r.URL.Path == "/" {
			return !isReadOnlyEVMRequest(r)
		}
	}
	return true
}

func isReadOnlyEVMRequest(r *http.Request) bool {
	const maxBody = 64 << 10
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	if len(body) > maxBody {
		return false
	}
	var request struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal(body, &request); err != nil {
		return false
	}
	_, ok := readOnlyEVMMethods[request.Method]
	return ok
}
