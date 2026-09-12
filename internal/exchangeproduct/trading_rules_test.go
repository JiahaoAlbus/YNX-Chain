package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
)

func TestGuestPreviewConsumesActualConfiguredEngineRulesOverHTTP(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js required for money-rule cross-runtime integration")
	}
	service, _, _ := newTestService(t)
	service.cfg.MakerFeeBPS, service.cfg.TakerFeeBPS = 17, 43
	server := httptest.NewServer(NewServer(service))
	defer server.Close()
	rules := service.TradingRules()
	if rules.MaxOrderNotionalMicro != strconv.FormatInt(service.cfg.MaxOrderNotionalMicro, 10) || rules.AdmissionMinimumQuote != "not_enforced_by_engine" {
		t.Fatal("rules do not describe current engine")
	}
	before := digest(service.state)
	type vector struct {
		Price    string            `json:"price"`
		Amount   string            `json:"amount"`
		Side     string            `json:"side"`
		Expected map[string]string `json:"expected"`
	}
	decimal := func(n int64) string { return fmt.Sprintf("%d.%06d", n/AmountScale, n%AmountScale) }
	vectors := []vector{}
	for _, pair := range [][2]int64{{2_000_001, 3_000_001}, {1, 1_000_000}, {1_000_000, 1}, {100 * AmountScale, 1000 * AmountScale}, {123_456, 789_012}} {
		for _, side := range []string{"buy", "sell"} {
			notional := mulDiv(pair[0], pair[1], AmountScale)
			reserve := pair[1]
			if side == "buy" {
				reserve = notional + fee(notional, 43)
			}
			vectors = append(vectors, vector{decimal(pair[0]), decimal(pair[1]), side, map[string]string{"notionalMicro": strconv.FormatInt(notional, 10), "makerFeeMicro": strconv.FormatInt(fee(notional, 17), 10), "takerFeeMicro": strconv.FormatInt(fee(notional, 43), 10), "initialReservationMicro": strconv.FormatInt(reserve, 10)}})
		}
	}
	payload, err := json.Marshal(vectors)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, filepath.Join("..", "..", "apps", "exchange", "tests", "http-order-preview.mjs"), server.URL)
	command.Stdin = bytes.NewReader(payload)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("cross-runtime rule preview: %v: %s", err, output)
	}
	if string(output) != "ENGINE_RULE_VECTORS=10\n" {
		t.Fatalf("unexpected receipt: %s", output)
	}
	if digest(service.state) != before {
		t.Fatal("guest preview mutated venue state")
	}
}
