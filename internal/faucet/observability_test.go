package faucet

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestRequestResultMetricsUseBoundedOutcomes(t *testing.T) {
	core := api.NewServerWithConfig(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{FaucetCoreAuthToken: faucetTestCoreToken})
	up := httptest.NewServer(core)
	defer up.Close()
	s := openTestFaucet(t, admissionTestConfig(t, up.URL))

	if _, status, err := s.Request(context.Background(), Request{Address: "bad"}, "192.0.2.1"); status != 400 || err == nil {
		t.Fatalf("expected rejected fixture: status=%d err=%v", status, err)
	}
	if _, status, err := s.Request(context.Background(), Request{Address: "ynx_observability_user", RequestID: admissionTestID}, "192.0.2.1"); status != 201 || err != nil {
		t.Fatalf("expected accepted fixture: status=%d err=%v", status, err)
	}
	metrics := s.Metrics()
	for _, want := range []string{
		`ynx_faucet_request_results_total{outcome="invalid_request"} 1`,
		`ynx_faucet_request_results_total{outcome="accepted"} 1`,
		`ynx_faucet_request_results_total{outcome="transaction_result_uncertain"} 0`,
		`ynx_faucet_admission_store_errors_total{operation="lookup"} 0`,
	} {
		if !strings.Contains(metrics, want) {
			t.Fatalf("missing %q in metrics:\n%s", want, metrics)
		}
	}
}
