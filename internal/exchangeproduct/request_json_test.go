package exchangeproduct

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBusinessRequestRejectsDuplicateJSONFieldsBeforeDecode(t *testing.T) {
	for _, body := range []string{
		`{"message":"reviewed","message":"not reviewed"}`,
		`{"message":"reviewed","Message":"not reviewed"}`,
		`{"message":"reviewed","\u006dessage":"not reviewed"}`,
		`{"message":"reviewed","me\u017fsage":"not reviewed"}`,
		`{"params":{"amount":1,"amount":2}}`,
		`{"rows":[{"amount":1,"amount":2}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			var value map[string]any
			response := httptest.NewRecorder()
			if decode(response, httptest.NewRequest(http.MethodPost, "/v1/support", strings.NewReader(body)), &value) || response.Code != http.StatusBadRequest {
				t.Fatalf("ambiguous JSON was accepted: status=%d", response.Code)
			}
			if value != nil {
				t.Fatal("rejected body was decoded into business inputs")
			}
		})
	}
}

func TestBusinessRequestKeepsUnambiguousJSONAndExistingBounds(t *testing.T) {
	for _, body := range []string{`{"message":"exact <img> text","params":{"amount":0}}`, `{"rows":[{"amount":1},{"amount":2}]}`} {
		var value map[string]any
		if !decode(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)), &value) {
			t.Fatal("unambiguous JSON was rejected")
		}
	}
	for _, body := range []string{`{"message":"one"} {"message":"two"}`, `{"message":`, strings.Repeat(" ", 64<<10) + `{}`, strings.Repeat("[", 130) + `0` + strings.Repeat("]", 130)} {
		var value map[string]any
		if decode(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)), &value) {
			t.Fatal("malformed or over-limit request was accepted")
		}
	}
	var value struct{ Message string }
	if decode(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"message":"exact","unknown":1}`)), &value) {
		t.Fatal("unknown field policy was widened")
	}
}

func TestSupportHTTPRejectsAmbiguousIntentWithoutPersistingCase(t *testing.T) {
	service, _, _ := newTestService(t)
	owner := accountSession(t, service, alice, "ambiguous-support", "exchange:read")
	service.cfg.Gateway = supportPostgresFixtureGateway{owner.token: owner.session}
	service.cfg.GatewayClientID, service.cfg.GatewayBundleID = "ynx-exchange-v1", "com.ynxweb4.exchange"
	server := httptest.NewServer(NewServer(service))
	t.Cleanup(server.Close)
	for _, message := range []string{`"message":"Please inspect my account","message":"Different issue"`, `"message":"Please inspect my account","Message":"Different issue"`} {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/support", strings.NewReader(`{"category":"account",`+message+`,"idempotencyKey":"support-json-ambiguity"}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-YNX-Product-Session-Proof", owner.token)
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("status=%d", response.StatusCode)
		}
		if len(service.state.Support) != 0 {
			t.Fatal("ambiguous intent persisted a support case")
		}
	}
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/support", strings.NewReader(`{"category":"account","message":"Please inspect my account","idempotencyKey":"support-json-ambiguity"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Product-Session-Proof", owner.token)
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusCreated || len(service.state.Support) != 1 {
		t.Fatal("rejected ambiguity consumed the valid intent key")
	}
}
