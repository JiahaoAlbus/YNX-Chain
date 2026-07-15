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
	checks := map[string]string{"skip link": "class=\"skip\"", "live status": "aria-live=\"polite\"", "audio engine": "<audio id=\"audio\"", "seek label": "for=\"seek\"", "dialog label": "Sign in with YNX Wallet"}
	for name, want := range checks {
		if !strings.Contains(string(html), want) {
			t.Errorf("%s missing", name)
		}
	}
	if !strings.Contains(string(css), "prefers-reduced-motion") || !strings.Contains(string(css), ":focus-visible") {
		t.Error("motion or keyboard focus accessibility CSS missing")
	}
	if !strings.Contains(string(js), "audio.currentTime") || !strings.Contains(string(js), "playback/") {
		t.Error("media playback and position recovery code missing")
	}
}
