package explorer

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPlanStreamRecovery(t *testing.T) {
	history := []streamEvent{
		{id: "41", event: "dashboard", payload: []byte(`{"height":41}`)},
		{id: "42", event: "dashboard", payload: []byte(`{"height":42}`)},
		{id: "43", event: "dashboard", payload: []byte(`{"height":43}`)},
	}
	replay := planStreamRecovery(history, "41")
	if replay.mode != "replay" || len(replay.replay) != 2 || replay.replay[0].id != "42" || replay.replay[1].id != "43" {
		t.Fatalf("known event ID did not produce ordered replay: %+v", replay)
	}
	for id, reason := range map[string]string{
		"40":  "history_expired",
		"44":  "future_last_event_id",
		"bad": "invalid_last_event_id",
	} {
		recovery := planStreamRecovery(history, id)
		if recovery.mode != "snapshot" || recovery.reason != reason {
			t.Fatalf("last event ID %q produced recovery %+v, want snapshot/%s", id, recovery, reason)
		}
	}
}

func TestBroadcastStreamDisconnectsSlowClientsForRecovery(t *testing.T) {
	server := NewServer(nil)
	client := make(chan streamEvent, 1)
	client <- streamEvent{id: "seed"}
	server.streamClients[client] = struct{}{}
	server.streamRunning = true

	if !server.broadcastStream(streamEvent{event: "dashboard", payload: []byte(`{"summary":{"rpcHeight":2}}`)}) {
		t.Fatal("broadcast unexpectedly stopped")
	}
	if _, exists := server.streamClients[client]; exists {
		t.Fatal("slow stream client was not disconnected for native Last-Event-ID recovery")
	}
	<-client
	if _, open := <-client; open {
		t.Fatal("slow stream client channel remained open")
	}
}

func TestExplorerStreamReplaysAndResetsGaps(t *testing.T) {
	server := NewServer(nil)
	server.streamHistory = []streamEvent{
		{id: "1", event: "dashboard", payload: []byte(`{"summary":{"rpcHeight":1}}`)},
		{id: "2", event: "dashboard", payload: []byte(`{"summary":{"rpcHeight":2}}`)},
	}
	server.streamNextID = 2
	server.streamRunning = true
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	replayResponse, replayCancel := openTestStream(t, httpServer.URL, "1")
	if got := replayResponse.Header.Get("X-YNX-Stream-Recovery"); got != "replay" {
		t.Fatalf("replay response mode=%q", got)
	}
	replayScanner := bufio.NewScanner(replayResponse.Body)
	if event, data := scanSSEEvent(t, replayScanner); event != "dashboard" || !strings.Contains(data, `"rpcHeight":2`) {
		t.Fatalf("unexpected replay event=%q data=%s", event, data)
	}
	replayCancel()
	_ = replayResponse.Body.Close()

	resetResponse, resetCancel := openTestStream(t, httpServer.URL, "99")
	if got := resetResponse.Header.Get("X-YNX-Stream-Recovery"); got != "snapshot" {
		t.Fatalf("reset response mode=%q", got)
	}
	resetScanner := bufio.NewScanner(resetResponse.Body)
	if event, data := scanSSEEvent(t, resetScanner); event != "stream-reset" || !strings.Contains(data, `"reason":"future_last_event_id"`) {
		t.Fatalf("unexpected reset event=%q data=%s", event, data)
	}
	go func() {
		time.Sleep(10 * time.Millisecond)
		server.broadcastStream(streamEvent{event: "dashboard", payload: []byte(`{"summary":{"rpcHeight":3}}`)})
	}()
	if event, data := scanSSEEvent(t, resetScanner); event != "dashboard" || !strings.Contains(data, `"rpcHeight":3`) {
		t.Fatalf("snapshot fallback did not arrive after reset: event=%q data=%s", event, data)
	}
	resetCancel()
	_ = resetResponse.Body.Close()
}

func openTestStream(t *testing.T, baseURL, lastEventID string) (*http.Response, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/stream", nil)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	request.Header.Set("Last-Event-ID", lastEventID)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	return response, cancel
}

func scanSSEEvent(t *testing.T, scanner *bufio.Scanner) (string, string) {
	t.Helper()
	event, data := "", ""
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		case line == "" && event != "":
			return event, data
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("stream ended before a complete event: %v", err)
	}
	t.Fatalf("stream ended before a complete event: event=%q data=%q", event, data)
	return "", ""
}
