//go:build !pay_securelink

package payproduct

import "errors"

// NewProductionHTTPPayAPI has no ordinary-TLS fallback on the protected edge.
// Legacy NewHTTPPayAPI remains available to inherited isolated integrations.
func NewProductionHTTPPayAPI(baseURL, apiKey, configPath string) (*HTTPPayAPI, error) {
	return nil, errors.New("Pay central transport unavailable: build with pay_securelink and qualified native securelink supply")
}
