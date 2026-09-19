package faucet

import (
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestWalletFaucetOriginsDefaultAndDeploymentEnvironment(t *testing.T) {
	data, err := os.ReadFile("../../deploy/testnet-alias-only/faucet-cors.env")
	if err != nil {
		t.Fatal(err)
	}
	var environment string
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "YNX_FAUCET_ALLOWED_ORIGINS=") {
			environment = strings.TrimPrefix(line, "YNX_FAUCET_ALLOWED_ORIGINS=")
		}
	}
	if !reflect.DeepEqual(parseCSV(environment), defaultFaucetAllowedOrigins) {
		t.Fatal("operator environment drifted from default allowlist")
	}
	for _, mode := range []string{"default", "environment"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("YNX_FAUCET_ALLOWED_ORIGINS", "")
			if mode == "environment" {
				t.Setenv("YNX_FAUCET_ALLOWED_ORIGINS", environment)
			}
			handler := NewServer(nil).Handler()
			for _, origin := range defaultFaucetAllowedOrigins {
				for _, host := range []string{"faucet.ynxweb4.com", "faucet-testnet.ynxweb4.com"} {
					for _, method := range []string{http.MethodOptions, http.MethodGet} {
						endpoint := "/request"
						if method == http.MethodGet {
							endpoint = "/version"
						}
						r := httptest.NewRequest(method, "https://"+host+endpoint, nil)
						r.Header.Set("Origin", origin)
						r.Header.Set("Access-Control-Request-Method", "POST")
						r.Header.Set("Access-Control-Request-Headers", "content-type")
						w := httptest.NewRecorder()
						handler.ServeHTTP(w, r)
						want := 200
						if method == http.MethodOptions {
							want = 204
						}
						if w.Code != want || w.Header().Get("Access-Control-Allow-Origin") != origin || w.Header().Get("Vary") != "Origin" || w.Header().Get("Access-Control-Allow-Credentials") != "" {
							t.Fatalf("%s %s %s: %d %+v", mode, host, origin, w.Code, w.Header())
						}
					}
				}
			}
			for _, origin := range []string{"*", "null", "http://wallet.ynxweb4.com", "https://wallet.ynxweb4.com:444", "https://wallet.ynxweb4.com.evil.invalid", "https://evilwallet.ynxweb4.com", "https://finance.ynxweb4.com", "https://wallet.ynxweb4.com/path"} {
				r := httptest.NewRequest(http.MethodOptions, "/request", nil)
				r.Header.Set("Origin", origin)
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				if w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") != "" {
					t.Fatalf("unapproved origin allowed: %q", origin)
				}
			}
		})
	}
}

func TestWalletOriginDoesNotWidenExplicitPrivateAllowlist(t *testing.T) {
	t.Setenv("YNX_FAUCET_ALLOWED_ORIGINS", "https://www.ynxweb4.com")
	r := httptest.NewRequest(http.MethodOptions, "/request", nil)
	r.Header.Set("Origin", "https://wallet.ynxweb4.com")
	w := httptest.NewRecorder()
	NewServer(nil).Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("explicit policy was silently widened")
	}
}
