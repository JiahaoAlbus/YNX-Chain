package paygateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

var ErrMerchantObjectForbidden = errors.New("Pay object does not belong to the authenticated merchant")

// Merchant identity comes only from operator configuration and the original
// Core object. Caller-provided merchant fields never establish ownership.
func (s *Service) requireMerchantObject(ctx context.Context, path string, body []byte, requestID string) error {
	var collection, id string
	switch {
	case path == "/pay/invoices" || path == "/pay/refunds":
		var payload struct {
			IntentID string `json:"intentId"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return ErrMerchantObjectForbidden
		}
		collection, id = "intents", strings.TrimSpace(payload.IntentID)
	case strings.HasPrefix(path, "/pay/invoices/") && strings.HasSuffix(path, "/settle"):
		collection, id = "invoices", strings.TrimSuffix(strings.TrimPrefix(path, "/pay/invoices/"), "/settle")
	default:
		return nil
	}
	if !merchantObjectID(id) {
		return ErrMerchantObjectForbidden
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+"/pay/"+collection+"/"+id, nil)
	if err != nil {
		return errors.New("unable to read original Pay object")
	}
	request.Header.Set("X-YNX-Pay-Gateway-Upstream-Key", s.cfg.UpstreamKey)
	request.Header.Set("X-Request-ID", requestID)
	// Never forward the service credential to a redirected origin.
	client := *s.httpClient
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return errors.New("original Pay object unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return ErrMerchantObjectForbidden
	}
	if response.StatusCode != http.StatusOK {
		return errors.New("original Pay object unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(raw) > 64*1024 {
		return errors.New("invalid original Pay object")
	}
	var original struct {
		ID       string `json:"id"`
		Merchant string `json:"merchant"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if decoder.Decode(&original) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("invalid original Pay object")
	}
	if original.ID != id || original.Merchant == "" || original.Merchant != s.cfg.MerchantID {
		return ErrMerchantObjectForbidden
	}
	return nil
}

func merchantObjectID(id string) bool {
	if len(id) == 0 || len(id) > 128 {
		return false
	}
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
