package datafabricconsole

import (
	"io/fs"
	"strings"
	"testing"
)

func TestConsoleAssetsCoverAccessibilityStatesLanguagesAndSecurityBoundary(t *testing.T) {
	index, err := fs.ReadFile(assets, "assets/index.html")
	if err != nil {
		t.Fatal(err)
	}
	app, err := fs.ReadFile(assets, "assets/app.js")
	if err != nil {
		t.Fatal(err)
	}
	locales, err := fs.ReadFile(assets, "assets/locales.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"aria-live", "role=\"status\"", "role=\"tab\"", "<caption", "viewport-fit=cover"} {
		if !strings.Contains(string(index), required) {
			t.Fatalf("operator console is missing accessibility contract %q", required)
		}
	}
	for _, required := range []string{"loading", "success", "empty", "failure", "offline", "permission", "expired", "recovery", "credentials:\"omit\"", "requestBoundHeaders", "contentSha256"} {
		if !strings.Contains(string(app), required) {
			t.Fatalf("operator console is missing runtime state or authority %q", required)
		}
	}
	for _, locale := range []string{"en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"} {
		if !strings.Contains(string(locales), locale+":") && !strings.Contains(string(locales), `"`+locale+`":`) {
			t.Fatalf("operator console is missing locale %s", locale)
		}
	}
	if !strings.Contains(string(app), `language==="ar"?"rtl":"ltr"`) {
		t.Fatal("Arabic locale does not enable RTL")
	}
}
