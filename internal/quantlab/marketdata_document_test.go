package quantlab

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func actualResearchTapeBytes(t *testing.T) []byte {
	t.Helper()
	trades := make([]map[string]any, 0, len(bars()))
	for _, bar := range bars() {
		trades = append(trades, map[string]any{"priceMicro": bar.Close, "amountMicro": bar.Volume, "createdAt": bar.Time})
	}
	value, err := json.Marshal(map[string]any{"market": "YNXT-YUSD_TEST", "source": "persisted deterministic matching-engine fills only", "externalPrice": false, "trades": trades})
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func TestMarketTapeDocumentRejectionCannotPersistResearch(t *testing.T) {
	valid := actualResearchTapeBytes(t)
	cases := map[string][]byte{
		"second-document":             append(append([]byte(nil), valid...), []byte("\n{}")...),
		"trailing-garbage":            append(append([]byte(nil), valid...), []byte("corrupt")...),
		"oversize-after-valid-prefix": append(append([]byte(nil), valid...), []byte(strings.Repeat(" ", 4<<20))...),
		"external-price-null":         []byte(strings.Replace(string(valid), `"externalPrice":false`, `"externalPrice":null`, 1)),
		"external-price-omitted":      []byte(strings.Replace(string(valid), `"externalPrice":false,`, "", 1)),
		"duplicate-price-boundary":    []byte(strings.Replace(string(valid), `"externalPrice":false`, `"externalPrice":true,"externalPrice":false`, 1)),
		"folded-price-boundary":       []byte(strings.Replace(string(valid), `"externalPrice":false`, `"externalPrice":true,"ExternalPrice":false`, 1)),
		"duplicate-consumed-trade":    []byte(strings.Replace(string(valid), `"amountMicro":`, `"amountMicro":1,"AmountMicro":`, 1)),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(body)
			}))
			defer upstream.Close()
			path := filepath.Join(t.TempDir(), "state.json")
			s, err := New(Config{StatePath: path, MarketData: HTTPExchangeMarketData{BaseURL: upstream.URL, Client: upstream.Client()}})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if _, err := s.RunBacktest(request()); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			r := request()
			_, err = s.RunBacktestFromMarketOnce(r.Strategy, r.Assumptions, researchFixtureKey)
			after, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if !errors.Is(err, ErrUnavailable) || !reflect.DeepEqual(before, after) {
				t.Fatalf("unverified document accepted: error=%v changed=%v", err, !reflect.DeepEqual(before, after))
			}
		})
	}
}

func TestMarketTapeSingleDocumentRetainsAdditiveAuditFieldsAndWhitespace(t *testing.T) {
	valid := actualResearchTapeBytes(t)
	body := " \n" + strings.Replace(string(valid), `"externalPrice":false`, `"externalPrice":false,"audit":{"optional":null,"classification":"test-fixture"}`, 1) + "\n\t "
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
	defer upstream.Close()
	adapter := HTTPExchangeMarketData{BaseURL: upstream.URL, Client: upstream.Client()}
	got, source, err := adapter.History("YNXT-YUSD_TEST", 100)
	if err != nil || len(got) != len(bars()) || source != upstream.URL+"/v1/market-data/trades" {
		t.Fatalf("compatible complete tape rejected: rows=%d source=%s error=%v", len(got), source, err)
	}
	for i, bar := range got {
		if bar.Close != bars()[i].Close || bar.Volume != bars()[i].Volume || !bar.Time.Equal(bars()[i].Time) {
			t.Fatal("document validation changed source values")
		}
	}
	if unambiguousMarketTapeDocument([]byte(`{"externalPrice":false,"audit":` + strings.Repeat("[", 65) + "0" + strings.Repeat("]", 65) + "}")) {
		t.Fatal("unbounded audit nesting accepted")
	}
}
