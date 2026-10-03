package video

import (
	"net/http"
	"time"
)

// Introspection proofs are addressed to the configured gateway only. A supplied
// transport can route isolated tests, but cannot opt into redirecting credentials
// or cookie persistence. Keep a finite upper bound even on a zero-timeout client.
func (a CentralProductSessionAuth) gatewayClient() *http.Client {
	timeout := 5 * time.Second
	var transport http.RoundTripper
	if a.Client != nil {
		transport = a.Client.Transport
		if a.Client.Timeout > 0 && a.Client.Timeout < timeout {
			timeout = a.Client.Timeout
		}
	}
	return &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
