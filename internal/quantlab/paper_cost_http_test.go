package quantlab

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestPaperHTTPCostModelStrictInputAndDurableReceipt(t *testing.T) {
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: adapterMarket{tick: MarketTick{Price: 1_000_000, Volume: 20_000_000, Source: "fixture://http-costs"}}}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	e, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(s)
	send := func(model string) *httptest.ResponseRecorder {
		body := fmt.Sprintf(`{"strategyHash":%q,"side":"buy","amount":1000000,"idempotencyKey":"http-cost-key","executionCosts":%s}`, e.Strategy.StrategyHash, model)
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/v1/paper/orders", strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:23456"
		r.Header.Set("X-YNX-Preview-Mode", "local-paper")
		handler.ServeHTTP(w, r)
		return w
	}
	for _, model := range []string{`null`, `{}`, `[]`, `{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":0}`, `{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":null,"slippageBPS":0}`, `{"policy":"","feeBPS":0,"slippageBPS":0}`, `{"policy":"unknown","feeBPS":0,"slippageBPS":0}`, `{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":-1,"slippageBPS":0}`, `{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":10,"slippageBPS":10000}`, `{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":10,"slippageBPS":5,"extra":1}`, `{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":10,"feeBPS":1,"slippageBPS":5}`} {
		before := hash(s.state)
		if w := send(model); w.Code != 400 {
			t.Fatalf("accepted malformed model %s: %d", model, w.Code)
		}
		if hash(s.state) != before {
			t.Fatal("invalid cost input changed state")
		}
	}
	w := send(`{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":10,"slippageBPS":5}`)
	if w.Code != 201 {
		t.Fatalf("%d: %s", w.Code, w.Body.String())
	}
	var first PaperOrder
	if err := json.Unmarshal(w.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.CostPolicy != PaperCostPolicyV1 || first.ExecutionPriceMicro != 1_000_500 || first.FeeMicro != 1001 {
		t.Fatalf("wrong cost receipt: %+v", first)
	}
	before := hash(s.state)
	if w := send(`{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":11,"slippageBPS":5}`); w.Code != 409 {
		t.Fatalf("changed cost: %d", w.Code)
	}
	if hash(s.state) != before {
		t.Fatal("conflicting cost input changed state")
	}
	cfg.MarketData = nil
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	handler = NewServer(reopened)
	w = send(`{"policy":"adverse_price_ceil_fee_micro_v1","feeBPS":10,"slippageBPS":5}`)
	var replay PaperOrder
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &replay) != nil || !reflect.DeepEqual(first, replay) || hash(reopened.state) != before {
		t.Fatal("HTTP offline restart recovery changed cost receipt/state")
	}
}
