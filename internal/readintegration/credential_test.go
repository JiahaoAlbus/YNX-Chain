package readintegration

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestCredentialBindsEveryFieldAndConsumesNonce(t *testing.T) {
	now := time.Date(2026, 8, 11, 8, 0, 0, 0, time.UTC)
	verifier, err := NewVerifier(strings.Repeat("k", 32), "finance", "exchange", func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(http.MethodGet, "https://exchange.example/v1/integrations/finance/account", nil)
	if err = Sign(req, strings.Repeat("k", 32), "finance", "exchange", "ynx1account", now); err != nil {
		t.Fatal(err)
	}
	if account, err := verifier.Verify(req, "/v1/integrations/finance/account"); err != nil || account != "ynx1account" {
		t.Fatalf("account=%q err=%v", account, err)
	}
	if _, err = verifier.Verify(req, "/v1/integrations/finance/account"); err == nil || !strings.Contains(err.Error(), "replayed") {
		t.Fatalf("replay=%v", err)
	}
}
func TestCredentialRejectsTamperExpiryAndWrongConfiguration(t *testing.T) {
	now := time.Date(2026, 8, 11, 8, 0, 0, 0, time.UTC)
	if _, err := NewVerifier("short", "finance", "exchange", nil); err == nil {
		t.Fatal("short key accepted")
	}
	for _, field := range []string{HeaderAccount, HeaderTimestamp, HeaderNonce, HeaderSignature, HeaderConsumer} {
		verifier, _ := NewVerifier(strings.Repeat("k", 32), "finance", "exchange", func() time.Time { return now })
		req, _ := http.NewRequest(http.MethodGet, "https://exchange.example/v1/integrations/finance/account", nil)
		_ = Sign(req, strings.Repeat("k", 32), "finance", "exchange", "ynx1account", now)
		req.Header.Set(field, req.Header.Get(field)+"x")
		if _, err := verifier.Verify(req, "/v1/integrations/finance/account"); err == nil {
			t.Fatalf("tampered %s accepted", field)
		}
	}
	verifier, _ := NewVerifier(strings.Repeat("k", 32), "finance", "exchange", func() time.Time { return now.Add(time.Minute) })
	req, _ := http.NewRequest(http.MethodGet, "https://exchange.example/v1/integrations/finance/account", nil)
	_ = Sign(req, strings.Repeat("k", 32), "finance", "exchange", "ynx1account", now)
	if _, err := verifier.Verify(req, "/v1/integrations/finance/account"); err == nil {
		t.Fatal("expired credential accepted")
	}
}
