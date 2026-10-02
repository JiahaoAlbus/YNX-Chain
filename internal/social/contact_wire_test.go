package social

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestContactHTTPRejectsRawInvalidUTF8WithoutStateOrReceipt(t *testing.T) {
	s, now := testService(t)
	s.cfg.RateLimitMax = 100
	a, b := newFixture(t, 142), newFixture(t, 143)
	login, err := s.Login(signedLogin(t, s, a, now))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(s, testResolver{account: b.account}).Handler())
	defer server.Close()
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	receipts := len(s.state.Idempotency)
	raw := append([]byte(`{"source":"handle","value":"bob_social","idempotencyKey":"wire-utf8","message":"hello `), 0xff)
	raw = append(raw, []byte(`"}`)...)
	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, raw)
	response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatalf("raw invalid UTF8 status=%d", response.StatusCode)
	}
	after, _ := os.ReadFile(s.cfg.StatePath)
	if !bytes.Equal(before, after) || len(s.state.Idempotency) != receipts || len(s.state.Requests) != 0 {
		t.Fatal("invalid wire created state or idempotency")
	}
	valid := []byte(`{"source":"handle","value":"bob_social","idempotencyKey":"wire-utf8","message":"hello"}`)
	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, valid)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal("invalid wire consumed original retry key")
	}
}

func TestContactHTTPUsesUnicodeCodepointBoundary(t *testing.T) {
	s, now := testService(t)
	s.cfg.RateLimitMax = 100
	a, b := newFixture(t, 144), newFixture(t, 145)
	login, err := s.Login(signedLogin(t, s, a, now))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(s, testResolver{account: b.account}).Handler())
	defer server.Close()
	for _, count := range []int{201, 200} {
		body := []byte(fmt.Sprintf(`{"source":"handle","value":"bob_social","idempotencyKey":"wire-emoji","message":%q}`, strings.Repeat("\U0001F642", count)))
		response := doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, body)
		response.Body.Close()
		want := 400
		if count == 200 {
			want = 201
		}
		if response.StatusCode != want {
			t.Fatalf("%d codepoints status=%d", count, response.StatusCode)
		}
	}
	if len(s.state.Requests) != 1 {
		t.Fatal("emoji boundary changed number of requests")
	}
	for _, request := range s.state.Requests {
		if len([]rune(request.Message)) != 200 {
			t.Fatal("emoji message was truncated or replaced")
		}
	}
}
