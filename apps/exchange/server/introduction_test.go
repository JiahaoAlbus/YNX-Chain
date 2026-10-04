package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIntroductionPreservesExplicitAppAndCallbackRoutes(t *testing.T) {
	for _, tc := range []struct {
		route string
		intro bool
	}{
		{"/", true}, {"/introduction.html", true}, {"/app", false}, {"/index.html", false},
		{"/wallet-auth/callback?requestId=retained", false},
		{"/wallet-action/callback", false}, {"/?requestId=retained", false},
		{"/legacy-share", false},
	} {
		w := httptest.NewRecorder()
		securityHeaders(spa(http.Dir("../web"))).ServeHTTP(w, httptest.NewRequest("GET", tc.route, nil))
		if w.Code != 200 {
			t.Fatalf("%s status=%d", tc.route, w.Code)
		}
		got := strings.Contains(w.Body.String(), "introduction-language")
		if got != tc.intro {
			t.Fatalf("%s intro=%v", tc.route, got)
		}
		if !tc.intro && !strings.Contains(w.Body.String(), "wallet-dialog") {
			t.Fatalf("%s lost original app", tc.route)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s cached HTML", tc.route)
		}
		if tc.intro && (strings.Contains(w.Body.String(), "wallet-connect.js") || strings.Contains(w.Body.String(), "private-session.js")) {
			t.Fatal("introduction loaded Wallet authority")
		}
	}
}
