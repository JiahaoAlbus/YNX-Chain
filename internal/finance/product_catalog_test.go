package finance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFinanceProductCatalogKeepsFourChannelsSeparate(t *testing.T) {
	catalog := financeProductCatalog()
	if catalog.SchemaVersion != financeCatalogVersion || catalog.AggregationPolicy != "never-merge-balances-cost-basis-pnl-or-performance-across-channels" || catalog.DefaultLocale != "en" {
		t.Fatalf("unexpected catalog contract: %#v", catalog)
	}
	want := []string{"ynxt-indexed", "ynx-evm-test", "broker-sandbox", "future-live"}
	if len(catalog.Channels) != len(want) {
		t.Fatalf("expected %d channels, got %d", len(want), len(catalog.Channels))
	}
	for index, id := range want {
		channel := catalog.Channels[index]
		if channel.ID != id || channel.Unit == "" || channel.Settlement == "" || channel.RiskNotice == "" || len(channel.RequiredEvidence) == 0 {
			t.Fatalf("channel %d is incomplete: %#v", index, channel)
		}
	}
	live := catalog.Channels[len(catalog.Channels)-1]
	if live.Availability != "disabled" || live.Settlement != "disabled" || len(live.Capabilities) != 0 {
		t.Fatalf("future live products must fail closed: %#v", live)
	}
}

func TestFinanceProductCatalogIsPublicAndVersioned(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/product-catalog", nil)
	(&Server{}).productCatalog(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "public, max-age=60" {
		t.Fatalf("unexpected catalog response: status=%d cache=%q", recorder.Code, recorder.Header().Get("Cache-Control"))
	}
	var catalog FinanceProductCatalog
	if err := json.Unmarshal(recorder.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if catalog.SchemaVersion != financeCatalogVersion || len(catalog.Channels) != 4 {
		t.Fatalf("unexpected public catalog: %#v", catalog)
	}
}
