package finance

import (
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
	"net/http/httptest"
	"testing"
)

func TestBrokerStatusIsGuestSafeAndNeverEnablesSubmission(t *testing.T) {
	for _, enabled := range []string{"false", "true"} {
		s := &Server{cfg: ServerConfig{BrokerConfig: brokerage.LoadConfig(func(k string) string {
			if k == "FINANCE_TRADING_ENABLED" {
				return enabled
			}
			return ""
		})}}
		w := httptest.NewRecorder()
		s.brokerStatus(w, httptest.NewRequest("GET", "/api/broker/status", nil))
		var got struct {
			Schema string           `json:"schema"`
			Status brokerage.Status `json:"status"`
		}
		if json.Unmarshal(w.Body.Bytes(), &got) != nil || w.Code != 200 || got.Schema != "ynx-finance-broker-status-v1" || got.Status.SubmissionEnabled || got.Status.OfficialSandboxVerified || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(w.Body.String())
		}
	}
}
