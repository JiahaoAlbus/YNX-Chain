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
	checks := map[string]string{"skip link": "class=\"skip\"", "live status": "aria-live=\"polite\"", "audio engine": "<audio id=\"audio\"", "seek label": "for=\"seek\"", "standard wallet": "Connect YNX Wallet", "MetaMask fallback": "Use MetaMask", "wallet install": "ynxWalletDownload", "private boundary": "Private service status: unavailable"}
	for name, want := range checks {
		if !strings.Contains(string(html), want) {
			t.Errorf("%s missing", name)
		}
	}
	if !strings.Contains(string(css), "prefers-reduced-motion") || !strings.Contains(string(css), ":focus-visible") {
		t.Error("motion or keyboard focus accessibility CSS missing")
	}
	if !strings.Contains(string(js), "audio.currentTime") || !strings.Contains(string(js), "connectMusicWallet") || strings.Contains(string(js), "sessionStorage") || strings.Contains(string(js), "Authorization") {
		t.Error("read-only Web media or credential boundary is invalid")
	}
}
