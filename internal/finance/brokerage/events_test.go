package brokerage

import (
	"strings"
	"testing"
)

const eventAccount = "01234567-89ab-4cde-8fab-0123456789ab"

func tradeEventFixture(id, account, event string) string {
	return "id: " + id + "\nevent: trade_updates\ndata: {\"account_id\":\"" + account + "\",\"event\":\"" + event + "\",\"timestamp\":\"2026-09-19T09:00:00Z\",\"order\":{\"providerOrderId\":\"22222222-3333-4444-8555-666666666666\",\"clientOrderId\":\"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\",\"assetId\":\"11111111-2222-4333-8444-555555555555\",\"symbol\":\"ACME\",\"side\":\"buy\",\"qty\":\"1\",\"filledQty\":\"1\",\"type\":\"limit\",\"limitPrice\":\"10\",\"timeInForce\":\"day\",\"providerStatus\":\"filled\",\"submittedAt\":\"2026-09-19T08:59:00Z\"}}\n\n"
}

func TestParseTradeEventStreamIsBoundedAndTenantIsolated(t *testing.T) {
	events, cursor, err := ParseTradeEventStream(strings.NewReader(tradeEventFixture("event-1", eventAccount, "fill")), eventAccount, 10)
	if err != nil || cursor != "event-1" || len(events) != 1 || events[0].Order.ClientOrderID == "" {
		t.Fatalf("events=%+v cursor=%q err=%v", events, cursor, err)
	}
	for name, stream := range map[string]string{
		"wrong tenant":  tradeEventFixture("event-1", "11234567-89ab-4cde-8fab-0123456789ab", "fill"),
		"bad event":     tradeEventFixture("event-1", eventAccount, "money_moved"),
		"unknown field": strings.Replace(tradeEventFixture("event-1", eventAccount, "fill"), "\"event\":\"fill\"", "\"event\":\"fill\",\"secret\":\"no\"", 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := ParseTradeEventStream(strings.NewReader(stream), eventAccount, 10); err == nil {
				t.Fatal("expected fail closed")
			}
		})
	}
}

func TestParseTradeEventStreamRejectsTruncationDuplicatesAndLimit(t *testing.T) {
	valid := tradeEventFixture("event-1", eventAccount, "fill")
	for _, stream := range []string{
		strings.TrimSuffix(valid, "\n\n")[:40],
		"id: event-1\nid: event-2\nevent: trade_updates\ndata: {}\n\n",
		valid + tradeEventFixture("event-2", eventAccount, "fill"),
	} {
		max := 10
		if strings.Contains(stream, "event-2") && strings.HasPrefix(stream, "id: event-1\nevent") {
			max = 1
		}
		if _, _, err := ParseTradeEventStream(strings.NewReader(stream), eventAccount, max); err == nil {
			t.Fatal("expected fail closed")
		}
	}
}
