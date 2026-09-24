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
	market := catalog.Channels[1].TestMarket
	if market == nil || market.SourceCommit != "6663df43e2f973a90a591cc88fc120a540df7f4a" || market.DryRunManifestSHA256 != "efd4d0c8f372a6a5c94a8687c17321b02144c4b812602a5e672252469a585802" || market.ChainID != 6423 || !market.TestOnly || market.DeploymentVerified || market.ChainSubmissionEnabled || market.PublicAddresses != nil || market.SettlementContract != "TestDvP" {
		t.Fatalf("local-only TestDvP must not become a public market: %#v", market)
	}
	if len(market.Assets) != 2 || market.Assets[0] != "TEST-AAPL" || market.Assets[1] != "tUSD" {
		t.Fatalf("test asset directory changed: %#v", market.Assets)
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
