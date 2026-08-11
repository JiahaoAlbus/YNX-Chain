package musicapp

import (
	"io/fs"
	"strings"
	"testing"
)

func TestWebAccessibilityAndMediaEngineContract(t *testing.T) {
	html, err := fs.ReadFile(Web(), "index.html")
	if err != nil {
		t.Fatal(err)
	}
	css, _ := fs.ReadFile(Web(), "styles.css")
	js, _ := fs.ReadFile(Web(), "app.js")
	wallet, _ := fs.ReadFile(Web(), "music-wallet-auth.js")
	checks := map[string]string{"skip link": "class=\"skip\"", "live status": "aria-live=\"polite\"", "audio engine": "<audio id=\"audio\"", "seek label": "for=\"seek\"", "real Wallet action": "Connect YNX Wallet", "Wallet install recovery": "id=\"installWallet\""}
	for name, want := range checks {
		if !strings.Contains(string(html), want) {
			t.Errorf("%s missing", name)
		}
	}
	if !strings.Contains(string(css), "prefers-reduced-motion") || !strings.Contains(string(css), ":focus-visible") {
		t.Error("motion or keyboard focus accessibility CSS missing")
	}
	if !strings.Contains(string(js), "audio.currentTime") || !strings.Contains(string(js), "/api/catalog") || strings.Contains(string(js), "Authorization") {
		t.Error("guest media or credential boundary is invalid")
	}
	if !strings.Contains(string(wallet), "YNX_PRODUCT_SESSION_HTTP_PROOF_V1") || !strings.Contains(string(wallet), "indexedDB") || strings.Contains(string(wallet), "sessionStorage") {
		t.Error("canonical Web Wallet proof, restart recovery or storage boundary is invalid")
	}
}
