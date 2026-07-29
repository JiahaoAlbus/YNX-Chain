package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestResourceUIAccessibilityResponsiveAndBoundaryContract(t *testing.T) {
	html, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	css, err := os.ReadFile("web/styles.css")
	if err != nil {
		t.Fatal(err)
	}
	h, c := string(html), string(css)
	for _, want := range []string{`lang="en"`, `name="viewport"`, `href="#main"`, `aria-live="polite"`, `aria-label="Resource Market"`, `rel="canonical" href="/resource-market"`, `name="theme-color" content="#002FA7"`, `Bandwidth`, `Compute`, `AI Credits`, `Trust Credits`, `Pay Credits`, `Sponsorship transfers only limited resource capacity`, `A fee quote is not settlement`} {
		if !strings.Contains(h, want) {
			t.Errorf("missing UI contract %q", want)
		}
	}
	for _, want := range []string{"--brand: #002fa7", "--success: #287254", "@media (max-width: 700px)", "prefers-reduced-motion", "focus-visible", "prefers-color-scheme: dark", "grid-template-columns: repeat(5, 1fr)"} {
		if !strings.Contains(c, want) {
			t.Errorf("missing CSS contract %q", want)
		}
	}
	if strings.Contains(h, "Every conclusion needs evidence") || strings.Contains(h, "CASE LEDGER") {
		t.Fatal("Resource Market was merged with Trust Center")
	}
}

func TestCanonicalResourceMarketRouteServesProductIndexWithoutRedirect(t *testing.T) {
	h := canonicalAssets(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, r.URL.Path)
	}))
	for _, path := range []string{"/resource-market", "/resource-market/"} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusOK || w.Body.String() != "/" {
			t.Fatalf("canonical route %s status=%d body=%q", path, w.Code, w.Body.String())
		}
	}
}
