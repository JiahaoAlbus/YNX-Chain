package commerce

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type TrustGateway interface {
	Available() bool
	SubmitDispute(context.Context, Order, string) (TrustCaseEvidence, error)
}

type HTTPTrustGateway struct {
	BaseURL, APIKey, PublicBaseURL string
	Client                         *http.Client
}

func (g HTTPTrustGateway) Available() bool { return g.BaseURL != "" && g.APIKey != "" }

func (g HTTPTrustGateway) SubmitDispute(ctx context.Context, order Order, idempotencyKey string) (TrustCaseEvidence, error) {
	if !g.Available() {
		return TrustCaseEvidence{}, fmt.Errorf("%w: Trust case service is not configured", ErrUnavailable)
	}
	if order.Status != "disputed" || order.Resolution == nil || order.Resolution.Reason == "" || len(idempotencyKey) < 8 {
		return TrustCaseEvidence{}, ErrInvalidState
	}
	privateDigest := sha256.Sum256([]byte(strings.Join([]string{order.ID, order.Buyer, order.StoreID, order.Resolution.Reason, order.Resolution.Explanation}, "\x00")))
	payload := map[string]any{
		"type": "submit_case", "idempotencyKey": "shop-dispute-" + idempotencyKey,
		"subject": order.ID, "purpose": "Review one YNX Shop order dispute",
		"requestScope": "single commerce order and its submitted resolution record", "requestedAction": "review",
		"evidence": []map[string]string{{"source": "ynx-shop-order-v1", "digest": "sha256:" + hex.EncodeToString(privateDigest[:]), "summary": "Buyer submitted a dispute for an owned order; private address and payment history are excluded."}},
	}
	body, _ := json.Marshal(payload)
	base, err := url.Parse(strings.TrimRight(g.BaseURL, "/"))
	if err != nil || (base.Scheme != "https" && base.Hostname() != "127.0.0.1" && base.Hostname() != "localhost") {
		return TrustCaseEvidence{}, fmt.Errorf("%w: Trust URL must use HTTPS", ErrUnavailable)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String()+"/api/actions", bytes.NewReader(body))
	if err != nil {
		return TrustCaseEvidence{}, err
	}
	req.Header.Set("Authorization", "Bearer "+g.APIKey)
	req.Header.Set("X-YNX-Actor", order.Buyer)
	req.Header.Set("X-YNX-Role", "user")
	req.Header.Set("Content-Type", "application/json")
	client := g.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return TrustCaseEvidence{}, fmt.Errorf("%w: Trust case request failed", ErrUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusConflict {
		return TrustCaseEvidence{}, ErrConflict
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return TrustCaseEvidence{}, fmt.Errorf("%w: Trust case service returned %d", ErrUnavailable, resp.StatusCode)
	}
	var result struct {
		Case struct {
			ID, Status string
			CreatedAt  time.Time
		} `json:"case"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil || result.Case.ID == "" || result.Case.Status == "" {
		return TrustCaseEvidence{}, errors.New("invalid Trust case response")
	}
	public := strings.TrimRight(g.PublicBaseURL, "/")
	evidenceURL, appealURL := "", ""
	if public != "" {
		evidenceURL = public + "/cases/" + url.PathEscape(result.Case.ID)
		appealURL = evidenceURL + "/appeal"
	}
	return TrustCaseEvidence{CaseID: result.Case.ID, Status: result.Case.Status, EvidenceURL: evidenceURL, AppealURL: appealURL, Source: "ynx-trust-center-api", SubmittedAt: result.Case.CreatedAt}, nil
}

func (s *Store) BindTrustCase(actor, orderID string, evidence *TrustCaseEvidence, unavailable bool) (Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	order, ok := s.s.Orders[orderID]
	if !ok {
		return Order{}, ErrNotFound
	}
	if order.Buyer != actor || order.Status != "disputed" {
		return Order{}, ErrUnauthorized
	}
	if unavailable {
		order.TrustStatus = "unavailable_no_trust_gateway"
	} else {
		if evidence == nil || evidence.CaseID == "" || evidence.Source != "ynx-trust-center-api" {
			return Order{}, errors.New("invalid Trust case evidence")
		}
		order.TrustStatus = evidence.Status
		order.TrustCase = evidence
	}
	order.UpdatedAt = s.now()
	s.s.Orders[order.ID] = order
	s.auditLocked(actor, "buyer", "trust_case_handoff", "order", order.ID, order.TrustStatus, "Trust cannot decide payment or move YNXT")
	if err := s.persistLocked(); err != nil {
		return Order{}, err
	}
	return order, nil
}
