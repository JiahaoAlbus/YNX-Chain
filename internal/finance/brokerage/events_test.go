package brokerage

import (
	"strings"
	"testing"
	"time"
)

const eventAccount = "01234567-89ab-4cde-8fab-0123456789ab"

func tradeEventFixture(id, account, event string) string {
	return "id: " + id + "\nevent: trade_updates\ndata: {\"account_id\":\"" + account + "\",\"event\":\"" + event + "\",\"event_id\":\"" + id + "\",\"at\":\"2022-04-19T14:12:30.656741Z\",\"timestamp\":\"2022-04-19T14:12:30.602193534Z\",\"provider_extension\":\"accepted\",\"order\":{\"id\":\"22222222-3333-4444-8555-666666666666\",\"client_order_id\":\"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\",\"asset_id\":\"11111111-2222-4333-8444-555555555555\",\"symbol\":\"ACME\",\"side\":\"buy\",\"qty\":\"1\",\"filled_qty\":\"1\",\"type\":\"limit\",\"limit_price\":\"10\",\"time_in_force\":\"day\",\"extended_hours\":false,\"status\":\"filled\",\"submitted_at\":\"2022-04-19T14:11:00Z\",\"created_at\":\"2022-04-19T14:10:00Z\",\"updated_at\":\"2022-04-19T14:12:30.602193534Z\",\"provider_order_extension\":true}}\n\n"
}

func TestParseTradeEventStreamIsBoundedAndTenantIsolated(t *testing.T) {
	events, cursor, err := ParseTradeEventStream(strings.NewReader(tradeEventFixture("event-1", eventAccount, "fill")), eventAccount, 10)
	if err != nil || cursor != "event-1" || len(events) != 1 || events[0].Order.ClientOrderID == "" {
		t.Fatalf("events=%+v cursor=%q err=%v", events, cursor, err)
	}
	for name, stream := range map[string]string{
		"wrong tenant":      tradeEventFixture("event-1", "11234567-89ab-4cde-8fab-0123456789ab", "fill"),
		"bad event":         tradeEventFixture("event-1", eventAccount, "money_moved"),
		"event id mismatch": strings.Replace(tradeEventFixture("event-1", eventAccount, "fill"), "\"event_id\":\"event-1\"", "\"event_id\":\"event-2\"", 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := ParseTradeEventStream(strings.NewReader(stream), eventAccount, 10); err == nil {
				t.Fatal("expected fail closed")
			}
		})
	}
}

func TestParseTradeEventStreamAcceptsAdditiveOfficialFieldsAndDistinctEnvelopeTimes(t *testing.T) {
	valid := tradeEventFixture("event-1", eventAccount, "fill")
	events, _, err := ParseTradeEventStream(strings.NewReader(valid), eventAccount, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := events[0].Timestamp.Format(time.RFC3339Nano); got != "2022-04-19T14:12:30.602193534Z" {
		t.Fatalf("occurrence time=%s", got)
	}
	invalidAt := strings.Replace(valid, "\"at\":\"2022-04-19T14:12:30.656741Z\"", "\"at\":\"not-a-time\"", 1)
	if _, _, err := ParseTradeEventStream(strings.NewReader(invalidAt), eventAccount, 1); err == nil {
		t.Fatal("invalid publication time accepted")
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
