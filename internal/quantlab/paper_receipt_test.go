package quantlab

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSavedPaperReceiptReadIsDurableHaltSafeAndNeverMutatesState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path, MarketData: quantBrowserQAMarket{}})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	key := "quant-native-paper-11111111-1111-4111-8111-111111111111"
	order, err := s.SubmitPaperSignalWithCostsFromMarket(experiment.Strategy.StrategyHash, "buy", 1000000, key, PaperExecutionCosts{Policy: PaperCostPolicyV1, FeeBPS: 10, SlippageBPS: 5})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.submitPaperRisk("kill", "fixture-halt-receipt-read", "Confirmed receipt fixture halt", 0, 0); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// Cold-start without a market client or the caller's current strategy.
	restarted, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/v1/wallet/paper/order-receipt?key="+key, nil)
	for range 3 {
		result, err := restarted.savedPaperOrderReceipt(r)
		if err != nil || !reflect.DeepEqual(result, order) {
			t.Fatal("saved receipt changed/re-executed", err)
		}
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("read changed durable state")
	}
	if !restarted.state.Paper.KillSwitch || len(restarted.state.Paper.Orders) != 1 {
		t.Fatal("read resumed/duplicated order")
	}
	if _, err = s.SubmitPaperSignalWithCostsFromMarket(experiment.Strategy.StrategyHash, "buy", 1000000, "new-forbidden-after-halt", PaperExecutionCosts{}); err != ErrForbidden {
		t.Fatal("halt was bypassed")
	}
	for _, suffix := range []string{"", "?key=invalid", "?key=" + key + "&key=" + key, "?key=" + key + "&account=foreign", "?key=" + key + "&tenant=foreign"} {
		if _, err = restarted.savedPaperOrderReceipt(httptest.NewRequest("GET", "/v1/wallet/paper/order-receipt"+suffix, nil)); err != ErrInvalid {
			t.Fatal("unsafe selector accepted", suffix, err)
		}
	}
	foreign, err := New(Config{StatePath: filepath.Join(t.TempDir(), "other.json")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = foreign.savedPaperOrderReceipt(r); err != ErrUnavailable {
		t.Fatal("missing/foreign receipt claimed resolved", err)
	}
	// Corrupt duplicates are ambiguous, never whichever row happens to be first.
	restarted.state.Paper.Orders = append(restarted.state.Paper.Orders, order)
	if err = restarted.save(); err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.savedPaperOrderReceipt(r); err != ErrConflict {
		t.Fatal("ambiguous receipt accepted", err)
	}
}
