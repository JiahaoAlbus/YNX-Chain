package payproduct

import (
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	merchantOperationsSchemaVersion     = 1
	merchantOperationCursorVersion      = 1
	bulkWebhookRetryConfirmationVersion = 1
	merchantOperationCursorTTL          = 15 * time.Minute
	bulkWebhookRetryConfirmationTTL     = 5 * time.Minute
	maxMerchantOperationPageSize        = 100
	maxBulkWebhookRetryDeliveries       = 50
)

const (
	merchantOperationCursorDomain      = "YNX_MERCHANT_OPERATION_CURSOR_V1"
	bulkWebhookRetryConfirmationDomain = "YNX_MERCHANT_BULK_WEBHOOK_RETRY_CONFIRMATION_V1"
)

type MerchantOperationQuery struct {
	Kind   string     `json:"kind"`
	Status string     `json:"status,omitempty"`
	Search string     `json:"search,omitempty"`
	Limit  int        `json:"limit"`
	Cursor string     `json:"-"`
	From   *time.Time `json:"from,omitempty"`
	To     *time.Time `json:"to,omitempty"`
}

type MerchantOperationRecord struct {
	Kind            string     `json:"kind"`
	ID              string     `json:"id"`
	MerchantID      string     `json:"merchantId"`
	ObjectID        string     `json:"objectId,omitempty"`
	Reference       string     `json:"reference,omitempty"`
	TransactionHash string     `json:"transactionHash,omitempty"`
	Status          string     `json:"status"`
	Label           string     `json:"label,omitempty"`
	Amount          int64      `json:"amount,omitempty"`
	Asset           string     `json:"asset,omitempty"`
	Attempt         int        `json:"attempt,omitempty"`
	HTTPStatus      int        `json:"httpStatus,omitempty"`
	NextAttemptAt   *time.Time `json:"nextAttemptAt,omitempty"`
	OccurredAt      time.Time  `json:"occurredAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	Source          string     `json:"source"`
}

type MerchantOperationsPage struct {
	SchemaVersion int                       `json:"schemaVersion"`
	MerchantID    string                    `json:"merchantId"`
	Filters       MerchantOperationQuery    `json:"filters"`
	Items         []MerchantOperationRecord `json:"items"`
	TotalMatched  int                       `json:"totalMatched"`
	NextCursor    string                    `json:"nextCursor,omitempty"`
	AsOf          time.Time                 `json:"asOf"`
	Source        string                    `json:"source"`
}

type merchantOperationCursor struct {
	Version      int       `json:"version"`
	MerchantID   string    `json:"merchantId"`
	FilterDigest string    `json:"filterDigest"`
	OccurredAt   time.Time `json:"occurredAt"`
	Kind         string    `json:"kind"`
	ID           string    `json:"id"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type BulkWebhookRetryPreviewInput struct {
	DeliveryIDs []string `json:"deliveryIds"`
}

type BulkWebhookRetryInput struct {
	DeliveryIDs       []string `json:"deliveryIds"`
	ConfirmationToken string   `json:"confirmationToken"`
	IdempotencyKey    string   `json:"idempotencyKey"`
}

type BulkWebhookRetryItem struct {
	ID            string     `json:"id"`
	EventType     string     `json:"eventType"`
	ObjectID      string     `json:"objectId"`
	Status        string     `json:"status"`
	Attempt       int        `json:"attempt"`
	HTTPStatus    int        `json:"httpStatus,omitempty"`
	NextAttemptAt *time.Time `json:"nextAttemptAt,omitempty"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type BulkWebhookRetryPreview struct {
	SchemaVersion     int                    `json:"schemaVersion"`
	MerchantID        string                 `json:"merchantId"`
	Actor             string                 `json:"actor"`
	Items             []BulkWebhookRetryItem `json:"items"`
	StateDigest       string                 `json:"stateDigest"`
	ConfirmationToken string                 `json:"confirmationToken"`
	ExpiresAt         time.Time              `json:"expiresAt"`
	Source            string                 `json:"source"`
}

type bulkWebhookRetryConfirmation struct {
	Version     int       `json:"version"`
	MerchantID  string    `json:"merchantId"`
	Actor       string    `json:"actor"`
	DeliveryIDs []string  `json:"deliveryIds"`
	StateDigest string    `json:"stateDigest"`
	IssuedAt    time.Time `json:"issuedAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type BulkWebhookRetryResultItem struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Attempt    int    `json:"attempt"`
	HTTPStatus int    `json:"httpStatus,omitempty"`
	Error      string `json:"error,omitempty"`
	Skipped    bool   `json:"skipped,omitempty"`
}

type BulkWebhookRetryResult struct {
	SchemaVersion int                          `json:"schemaVersion"`
	OperationID   string                       `json:"operationId"`
	MerchantID    string                       `json:"merchantId"`
	Actor         string                       `json:"actor"`
	StateDigest   string                       `json:"stateDigest"`
	Status        string                       `json:"status"`
	Replayed      bool                         `json:"replayed"`
	Items         []BulkWebhookRetryResultItem `json:"items"`
	Attempted     int                          `json:"attempted"`
	Delivered     int                          `json:"delivered"`
	Retrying      int                          `json:"retrying"`
	Failed        int                          `json:"failed"`
	Skipped       int                          `json:"skipped"`
	StartedAt     time.Time                    `json:"startedAt"`
	CompletedAt   time.Time                    `json:"completedAt"`
	Source        string                       `json:"source"`
}

func (s *Service) MerchantOperations(merchantID string, query MerchantOperationQuery) (MerchantOperationsPage, error) {
	query, err := normalizeMerchantOperationQuery(query)
	if err != nil {
		return MerchantOperationsPage{}, err
	}
	now := s.now().UTC()
	filterDigest := merchantOperationFilterDigest(query)
	var cursor *merchantOperationCursor
	if query.Cursor != "" {
		var decoded merchantOperationCursor
		if err := s.verifyOpaqueToken(merchantOperationCursorDomain, query.Cursor, &decoded); err != nil {
			return MerchantOperationsPage{}, errors.New("invalid operations cursor")
		}
		if decoded.Version != merchantOperationCursorVersion || decoded.MerchantID != merchantID || decoded.FilterDigest != filterDigest || !decoded.ExpiresAt.After(now) {
			return MerchantOperationsPage{}, errors.New("invalid or expired operations cursor")
		}
		cursor = &decoded
	}

	items := make([]MerchantOperationRecord, 0)
	err = s.store.View(func(data Snapshot) error {
		items = merchantOperationRecords(data, merchantID)
		return nil
	})
	if err != nil {
		return MerchantOperationsPage{}, err
	}
	filtered := items[:0]
	for _, item := range items {
		if merchantOperationMatches(item, query) {
			filtered = append(filtered, item)
		}
	}
	items = filtered
	sort.Slice(items, func(i, j int) bool { return merchantOperationBefore(items[i], items[j]) })

	start := 0
	if cursor != nil {
		start = len(items)
		for i, item := range items {
			if merchantOperationAfterCursor(item, *cursor) {
				start = i
				break
			}
		}
	}
	end := min(start+query.Limit, len(items))
	pageItems := append([]MerchantOperationRecord(nil), items[start:end]...)
	var next string
	if end < len(items) && len(pageItems) > 0 {
		last := pageItems[len(pageItems)-1]
		next, err = s.signOpaqueToken(merchantOperationCursorDomain, merchantOperationCursor{
			Version: merchantOperationCursorVersion, MerchantID: merchantID, FilterDigest: filterDigest,
			OccurredAt: last.OccurredAt, Kind: last.Kind, ID: last.ID, ExpiresAt: now.Add(merchantOperationCursorTTL),
		})
		if err != nil {
			return MerchantOperationsPage{}, err
		}
	}
	query.Cursor = ""
	return MerchantOperationsPage{
		SchemaVersion: merchantOperationsSchemaVersion,
		MerchantID:    merchantID,
		Filters:       query,
		Items:         pageItems,
		TotalMatched:  len(items),
		NextCursor:    next,
		AsOf:          now,
		Source:        "direct-merchant-scoped-local-store-v1",
	}, nil
}

func normalizeMerchantOperationQuery(query MerchantOperationQuery) (MerchantOperationQuery, error) {
	query.Kind = strings.ToLower(strings.TrimSpace(query.Kind))
	if query.Kind == "" {
		query.Kind = "all"
	}
	switch query.Kind {
	case "all", "invoice", "refund", "dispute", "webhook":
	default:
		return MerchantOperationQuery{}, errors.New("operation kind must be all, invoice, refund, dispute or webhook")
	}
	query.Status = strings.ToLower(strings.TrimSpace(query.Status))
	if query.Status != "" && (len(query.Status) > 64 || !identifierRE.MatchString(query.Status)) {
		return MerchantOperationQuery{}, errors.New("operation status is invalid")
	}
	query.Search = strings.TrimSpace(query.Search)
	if len(query.Search) > 100 {
		return MerchantOperationQuery{}, errors.New("operation search must not exceed 100 characters")
	}
	if query.Limit == 0 {
		query.Limit = 25
	}
	if query.Limit < 1 || query.Limit > maxMerchantOperationPageSize {
		return MerchantOperationQuery{}, fmt.Errorf("operation limit must be between 1 and %d", maxMerchantOperationPageSize)
	}
	if query.From != nil {
		v := query.From.UTC()
		query.From = &v
	}
	if query.To != nil {
		v := query.To.UTC()
		query.To = &v
	}
	if query.From != nil && query.To != nil && query.From.After(*query.To) {
		return MerchantOperationQuery{}, errors.New("operation from time must not be after to time")
	}
	return query, nil
}

func merchantOperationFilterDigest(query MerchantOperationQuery) string {
	var from, to string
	if query.From != nil {
		from = query.From.UTC().Format(time.RFC3339Nano)
	}
	if query.To != nil {
		to = query.To.UTC().Format(time.RFC3339Nano)
	}
	return hashJSON(struct {
		Kind, Status, Search, From, To string
		Limit                          int
	}{query.Kind, query.Status, query.Search, from, to, query.Limit})
}

func merchantOperationRecords(data Snapshot, merchantID string) []MerchantOperationRecord {
	items := make([]MerchantOperationRecord, 0)
	for _, invoice := range data.Invoices {
		if invoice.MerchantID != merchantID {
			continue
		}
		updated := invoice.CreatedAt
		tx := ""
		if invoice.Settlement != nil {
			updated = invoice.Settlement.CommittedAt
			tx = invoice.Settlement.TransactionHash
		}
		items = append(items, MerchantOperationRecord{Kind: "invoice", ID: invoice.ID, MerchantID: merchantID, ObjectID: invoice.CentralID, Reference: invoice.IntentID, TransactionHash: tx, Status: invoice.Status, Label: invoice.Description, Amount: invoice.Amount, Asset: invoice.Asset, OccurredAt: invoice.CreatedAt.UTC(), UpdatedAt: updated.UTC(), Source: "merchant-invoice-and-authoritative-settlement-evidence"})
	}
	for _, refund := range data.Refunds {
		if refund.MerchantID != merchantID {
			continue
		}
		asset := NativeAsset
		if invoice, ok := data.Invoices[refund.InvoiceID]; ok && invoice.Asset != "" {
			asset = invoice.Asset
		}
		items = append(items, MerchantOperationRecord{Kind: "refund", ID: refund.ID, MerchantID: merchantID, ObjectID: refund.InvoiceID, Reference: refund.Payer, Status: refund.Status, Label: refund.Reason, Amount: refund.Amount, Asset: asset, OccurredAt: refund.CreatedAt.UTC(), UpdatedAt: refund.UpdatedAt.UTC(), Source: "merchant-refund-request-state"})
	}
	for _, dispute := range data.Disputes {
		if dispute.MerchantID != merchantID {
			continue
		}
		items = append(items, MerchantOperationRecord{Kind: "dispute", ID: dispute.ID, MerchantID: merchantID, ObjectID: dispute.InvoiceID, Reference: dispute.Payer, Status: dispute.Status, Label: dispute.Reason, OccurredAt: dispute.CreatedAt.UTC(), UpdatedAt: dispute.UpdatedAt.UTC(), Source: "merchant-dispute-request-and-trust-reference-state"})
	}
	for _, delivery := range data.Deliveries {
		if delivery.MerchantID != merchantID {
			continue
		}
		var next *time.Time
		if !delivery.NextAttemptAt.IsZero() {
			v := delivery.NextAttemptAt.UTC()
			next = &v
		}
		items = append(items, MerchantOperationRecord{Kind: "webhook", ID: delivery.ID, MerchantID: merchantID, ObjectID: delivery.ObjectID, Reference: delivery.EventType, Status: delivery.Status, Label: delivery.EventType, Attempt: delivery.Attempt, HTTPStatus: delivery.HTTPStatus, NextAttemptAt: next, OccurredAt: delivery.CreatedAt.UTC(), UpdatedAt: delivery.UpdatedAt.UTC(), Source: "merchant-webhook-delivery-state"})
	}
	return items
}

func merchantOperationMatches(item MerchantOperationRecord, query MerchantOperationQuery) bool {
	if query.Kind != "all" && item.Kind != query.Kind {
		return false
	}
	if query.Status != "" && strings.ToLower(item.Status) != query.Status {
		return false
	}
	if query.From != nil && item.OccurredAt.Before(*query.From) {
		return false
	}
	if query.To != nil && item.OccurredAt.After(*query.To) {
		return false
	}
	if query.Search != "" {
		needle := strings.ToLower(query.Search)
		haystack := strings.ToLower(strings.Join([]string{item.Kind, item.ID, item.ObjectID, item.Reference, item.TransactionHash, item.Status, item.Label, item.Asset, fmt.Sprint(item.Amount)}, "\n"))
		if !strings.Contains(haystack, needle) {
			return false
		}
	}
	return true
}

func merchantOperationBefore(a, b MerchantOperationRecord) bool {
	if !a.OccurredAt.Equal(b.OccurredAt) {
		return a.OccurredAt.After(b.OccurredAt)
	}
	if a.Kind != b.Kind {
		return a.Kind < b.Kind
	}
	return a.ID < b.ID
}

func merchantOperationAfterCursor(item MerchantOperationRecord, cursor merchantOperationCursor) bool {
	if !item.OccurredAt.Equal(cursor.OccurredAt) {
		return item.OccurredAt.Before(cursor.OccurredAt)
	}
	if item.Kind != cursor.Kind {
		return item.Kind > cursor.Kind
	}
	return item.ID > cursor.ID
}

func (s *Service) PreviewBulkWebhookRetry(principal MerchantPrincipal, deliveryIDs []string) (BulkWebhookRetryPreview, error) {
	ids, err := normalizeBulkWebhookRetryIDs(deliveryIDs)
	if err != nil {
		return BulkWebhookRetryPreview{}, err
	}
	var items []BulkWebhookRetryItem
	var digest string
	err = s.store.View(func(data Snapshot) error {
		var stateErr error
		items, digest, stateErr = bulkWebhookRetryState(data, principal.Merchant.ID, ids)
		return stateErr
	})
	if err != nil {
		return BulkWebhookRetryPreview{}, err
	}
	now := s.now().UTC()
	expires := now.Add(bulkWebhookRetryConfirmationTTL)
	payload := bulkWebhookRetryConfirmation{Version: bulkWebhookRetryConfirmationVersion, MerchantID: principal.Merchant.ID, Actor: principal.Account, DeliveryIDs: ids, StateDigest: digest, IssuedAt: now, ExpiresAt: expires}
	token, err := s.signOpaqueToken(bulkWebhookRetryConfirmationDomain, payload)
	if err != nil {
		return BulkWebhookRetryPreview{}, err
	}
	return BulkWebhookRetryPreview{SchemaVersion: 1, MerchantID: principal.Merchant.ID, Actor: principal.Account, Items: items, StateDigest: digest, ConfirmationToken: token, ExpiresAt: expires, Source: "direct-merchant-webhook-state-preview-v1"}, nil
}

func (s *Service) BulkRetryWebhooks(ctx context.Context, principal MerchantPrincipal, input BulkWebhookRetryInput) (BulkWebhookRetryResult, error) {
	ids, err := normalizeBulkWebhookRetryIDs(input.DeliveryIDs)
	if err != nil {
		return BulkWebhookRetryResult{}, err
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return BulkWebhookRetryResult{}, err
	}
	var confirmation bulkWebhookRetryConfirmation
	if err := s.verifyOpaqueToken(bulkWebhookRetryConfirmationDomain, input.ConfirmationToken, &confirmation); err != nil {
		return BulkWebhookRetryResult{}, errors.New("invalid bulk retry confirmation")
	}
	if confirmation.Version != bulkWebhookRetryConfirmationVersion || confirmation.MerchantID != principal.Merchant.ID || confirmation.Actor != principal.Account || !equalStrings(confirmation.DeliveryIDs, ids) {
		return BulkWebhookRetryResult{}, errors.New("bulk retry confirmation does not match merchant, actor or deliveries")
	}
	requestHash := hashJSON(struct {
		MerchantID, Actor, StateDigest string
		DeliveryIDs                    []string
	}{principal.Merchant.ID, principal.Account, confirmation.StateDigest, ids})
	mapKey := "webhook-bulk-retry:" + principal.Merchant.ID + ":" + key
	operationID := "bop_" + hashString(principal.Merchant.ID, principal.Account, key, requestHash)[:20]

	var existing IdempotencyRecord
	var found bool
	if err := s.store.View(func(data Snapshot) error {
		existing, found = data.Idempotency[mapKey]
		return nil
	}); err != nil {
		return BulkWebhookRetryResult{}, err
	}
	if found {
		if existing.RequestHash != requestHash {
			return BulkWebhookRetryResult{}, errors.New("idempotency key reused with different bulk retry request")
		}
		return s.replayBulkWebhookRetry(principal, existing, confirmation.StateDigest)
	}
	if !confirmation.ExpiresAt.After(s.now().UTC()) {
		return BulkWebhookRetryResult{}, errors.New("bulk retry confirmation expired")
	}

	replayed := false
	var reserved BulkWebhookRetryResult
	err = s.store.Update(func(data *Snapshot) error {
		if current, ok := data.Idempotency[mapKey]; ok {
			if current.RequestHash != requestHash {
				return errors.New("idempotency key reused with different bulk retry request")
			}
			existing = current
			replayed = true
			return nil
		}
		_, digest, stateErr := bulkWebhookRetryState(*data, principal.Merchant.ID, ids)
		if stateErr != nil {
			return stateErr
		}
		if digest != confirmation.StateDigest {
			return errors.New("bulk retry confirmation is stale; create a new preview")
		}
		started := s.now().UTC()
		data.Idempotency[mapKey] = IdempotencyRecord{Scope: "webhook-bulk-retry", Key: key, RequestHash: requestHash, ObjectID: operationID, CreatedAt: started}
		reserved = BulkWebhookRetryResult{SchemaVersion: 1, OperationID: operationID, MerchantID: principal.Merchant.ID, Actor: principal.Account, StateDigest: confirmation.StateDigest, Status: "in_progress", Items: []BulkWebhookRetryResultItem{}, StartedAt: started, Source: "explicit-confirmation-bound-webhook-retry-v1"}
		data.BulkOperations[operationID] = reserved
		appendAudit(data, principal.Merchant.ID, principal.Account, "webhook.bulk-retry.start", operationID, "accepted", fmt.Sprintf("count=%d stateDigest=%s", len(ids), confirmation.StateDigest), started)
		existing = data.Idempotency[mapKey]
		return nil
	})
	if err != nil {
		return BulkWebhookRetryResult{}, err
	}
	if replayed {
		return s.replayBulkWebhookRetry(principal, existing, confirmation.StateDigest)
	}

	result := reserved
	for index, id := range ids {
		if ctx.Err() != nil {
			for _, skippedID := range ids[index:] {
				result.Items = append(result.Items, BulkWebhookRetryResultItem{ID: skippedID, Status: "not-attempted", Skipped: true})
				result.Skipped++
			}
			result.Status = "partial"
			break
		}
		delivery, deliverErr := s.Deliver(ctx, id)
		item := BulkWebhookRetryResultItem{ID: id, Status: delivery.Status, Attempt: delivery.Attempt, HTTPStatus: delivery.HTTPStatus}
		if deliverErr != nil {
			item.Status = "unavailable"
			item.Error = "delivery state unavailable"
			result.Status = "partial"
		}
		result.Items = append(result.Items, item)
		result.Attempted++
		summarizeBulkWebhookRetry(&result)
		if err := s.persistBulkWebhookRetryProgress(result); err != nil {
			return result, err
		}
	}
	summarizeBulkWebhookRetry(&result)
	result.CompletedAt = s.now().UTC()
	if result.Attempted != len(ids) {
		result.Status = "partial"
	} else if result.Status == "in_progress" {
		result.Status = "completed"
	}
	finishErr := s.store.Update(func(data *Snapshot) error {
		data.BulkOperations[operationID] = result
		appendAudit(data, principal.Merchant.ID, principal.Account, "webhook.bulk-retry.finish", operationID, result.Status, fmt.Sprintf("attempted=%d delivered=%d retrying=%d failed=%d skipped=%d", result.Attempted, result.Delivered, result.Retrying, result.Failed, result.Skipped), result.CompletedAt)
		return nil
	})
	if finishErr != nil {
		return result, finishErr
	}
	return result, nil
}

func (s *Service) replayBulkWebhookRetry(principal MerchantPrincipal, record IdempotencyRecord, stateDigest string) (BulkWebhookRetryResult, error) {
	var result BulkWebhookRetryResult
	err := s.store.View(func(data Snapshot) error {
		operation, ok := data.BulkOperations[record.ObjectID]
		if !ok {
			return errors.New("bulk retry operation state unavailable")
		}
		if operation.MerchantID != principal.Merchant.ID || operation.Actor != principal.Account || operation.StateDigest != stateDigest {
			return errors.New("bulk retry operation state does not match merchant, actor or confirmation")
		}
		result = operation
		return nil
	})
	if err != nil {
		return BulkWebhookRetryResult{}, err
	}
	result.Replayed = true
	result.Source = "persisted-idempotent-webhook-retry-result-v1"
	return result, nil
}

func (s *Service) persistBulkWebhookRetryProgress(result BulkWebhookRetryResult) error {
	return s.store.Update(func(data *Snapshot) error {
		current, ok := data.BulkOperations[result.OperationID]
		if !ok || current.MerchantID != result.MerchantID || current.Actor != result.Actor || current.StateDigest != result.StateDigest {
			return errors.New("bulk retry operation state unavailable")
		}
		data.BulkOperations[result.OperationID] = result
		return nil
	})
}

func summarizeBulkWebhookRetry(result *BulkWebhookRetryResult) {
	result.Delivered = 0
	result.Retrying = 0
	result.Failed = 0
	for _, item := range result.Items {
		if item.Skipped {
			continue
		}
		switch item.Status {
		case "delivered":
			result.Delivered++
		case "retrying", "pending":
			result.Retrying++
		case "failed", "unavailable":
			result.Failed++
		}
	}
}

func normalizeBulkWebhookRetryIDs(values []string) ([]string, error) {
	if len(values) < 1 || len(values) > maxBulkWebhookRetryDeliveries {
		return nil, fmt.Errorf("bulk retry must contain 1 to %d delivery IDs", maxBulkWebhookRetryDeliveries)
	}
	seen := make(map[string]bool, len(values))
	ids := make([]string, 0, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if !identifierRE.MatchString(id) {
			return nil, errors.New("bulk retry contains an invalid delivery ID")
		}
		if seen[id] {
			return nil, errors.New("bulk retry delivery IDs must be unique")
		}
		seen[id] = true
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

func bulkWebhookRetryState(data Snapshot, merchantID string, ids []string) ([]BulkWebhookRetryItem, string, error) {
	items := make([]BulkWebhookRetryItem, 0, len(ids))
	fingerprints := make([]any, 0, len(ids))
	for _, id := range ids {
		delivery, ok := data.Deliveries[id]
		if !ok || delivery.MerchantID != merchantID {
			return nil, "", errors.New("webhook delivery not found")
		}
		switch delivery.Status {
		case "pending", "retrying", "failed":
		default:
			return nil, "", fmt.Errorf("webhook delivery %s is not retryable", id)
		}
		var next *time.Time
		if !delivery.NextAttemptAt.IsZero() {
			v := delivery.NextAttemptAt.UTC()
			next = &v
		}
		items = append(items, BulkWebhookRetryItem{ID: delivery.ID, EventType: delivery.EventType, ObjectID: delivery.ObjectID, Status: delivery.Status, Attempt: delivery.Attempt, HTTPStatus: delivery.HTTPStatus, NextAttemptAt: next, UpdatedAt: delivery.UpdatedAt.UTC()})
		fingerprints = append(fingerprints, struct {
			ID, MerchantID, EventType, ObjectID, Endpoint, PayloadHash, Signature, Status string
			SecretVersion, Attempt, HTTPStatus                                            int
			NextAttemptAt, CreatedAt, UpdatedAt                                           time.Time
		}{delivery.ID, delivery.MerchantID, delivery.EventType, delivery.ObjectID, delivery.Endpoint, delivery.PayloadHash, delivery.Signature, delivery.Status, delivery.SecretVersion, delivery.Attempt, delivery.HTTPStatus, delivery.NextAttemptAt.UTC(), delivery.CreatedAt.UTC(), delivery.UpdatedAt.UTC()})
	}
	return items, hashJSON(fingerprints), nil
}

func (s *Service) signOpaqueToken(domain string, payload any) (string, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	signature := hmacHex(s.key, []byte(domain+"."+encoded))
	return encoded + "." + signature, nil
}

func (s *Service) verifyOpaqueToken(domain, token string, out any) error {
	if len(token) == 0 || len(token) > 16384 {
		return errors.New("invalid token")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return errors.New("invalid token")
	}
	expected := hmacHex(s.key, []byte(domain+"."+parts[0]))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return errors.New("invalid token signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return errors.New("invalid token encoding")
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return errors.New("invalid token payload")
	}
	return nil
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
