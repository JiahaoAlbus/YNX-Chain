package main

import (
	"os"
	"strings"
	"testing"
)

func TestTrustUIAccessibilityResponsiveAndBoundaryContract(t *testing.T) {
	html, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	css, err := os.ReadFile("web/styles.css")
	if err != nil {
		t.Fatal(err)
	}
	h, c := string(html), string(css)
	for _, want := range []string{`lang="en"`, `name="viewport"`, `href="#main"`, `aria-live="polite"`, `aria-label="Trust Center sections"`, `Evidence · Procedure · Appeal`, `cannot freeze, seize, blacklist or transfer native YNXT`} {
		if !strings.Contains(h, want) {
			t.Errorf("missing UI contract %q", want)
		}
	}
	for _, want := range []string{"#002FA7", "@media(max-width:720px)", "prefers-reduced-motion", "focus-visible"} {
		if !strings.Contains(c, want) {
			t.Errorf("missing CSS contract %q", want)
		}
	}
	if strings.Contains(h, "Resource Market") || strings.Contains(h, "capacity market") {
		t.Fatal("Trust Center was merged with Resource Market")
	}
}
