package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	payIDPattern   = regexp.MustCompile(`^[0-9a-f]{24}$`)
	payHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	payNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.:-]{2,127}$`)
)

type PayIntentPayload struct {
	Merchant       string `json:"merchant"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	CallbackURL    string `json:"callbackUrl,omitempty"`
	IdempotencyKey string `json:"idempotencyKey"`
	RequestHash    string `json:"requestHash"`
}

type PayInvoicePayload struct {
	Merchant       string `json:"merchant"`
	IntentID       string `json:"intentId"`
	DueInHours     int64  `json:"dueInHours"`
	IdempotencyKey string `json:"idempotencyKey"`
	RequestHash    string `json:"requestHash"`
}

type PayRefundPayload struct {
	Merchant       string `json:"merchant"`
	IntentID       string `json:"intentId"`
	Amount         int64  `json:"amount"`
	Reason         string `json:"reason,omitempty"`
	IdempotencyKey string `json:"idempotencyKey"`
	RequestHash    string `json:"requestHash"`
}

type PayWebhookPayload struct {
	Merchant       string    `json:"merchant"`
	IntentID       string    `json:"intentId"`
	EventType      string    `json:"eventType"`
	IdempotencyKey string    `json:"idempotencyKey"`
	EventID        string    `json:"eventId"`
	PayloadHash    string    `json:"payloadHash"`
	Signature      string    `json:"signature"`
	SignedAt       time.Time `json:"signedAt"`
	Algorithm      string    `json:"algorithm"`
	RequestHash    string    `json:"requestHash"`
}

type BFTPayIntent struct {
	ID             string    `json:"id"`
	Signer         string    `json:"signer"`
	Merchant       string    `json:"merchant"`
	Amount         int64     `json:"amount"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	CallbackURL    string    `json:"callbackUrl,omitempty"`
	IdempotencyKey string    `json:"idempotencyKey"`
	RequestHash    string    `json:"requestHash"`
	BlockHeight    int64     `json:"blockHeight"`
	TxHash         string    `json:"txHash"`
	AuditHash      string    `json:"auditHash"`
}

type BFTPayInvoice struct {
	ID             string    `json:"id"`
	Signer         string    `json:"signer"`
	IntentID       string    `json:"intentId"`
	Merchant       string    `json:"merchant"`
	Amount         int64     `json:"amount"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	DueAt          time.Time `json:"dueAt"`
	CreatedAt      time.Time `json:"createdAt"`
	PaymentLink    string    `json:"paymentLink"`
	IdempotencyKey string    `json:"idempotencyKey"`
	RequestHash    string    `json:"requestHash"`
	BlockHeight    int64     `json:"blockHeight"`
	TxHash         string    `json:"txHash"`
	AuditHash      string    `json:"auditHash"`
}

type BFTPayRefund struct {
	ID             string    `json:"id"`
	Signer         string    `json:"signer"`
	Merchant       string    `json:"merchant"`
	IntentID       string    `json:"intentId"`
	Amount         int64     `json:"amount"`
	Currency       string    `json:"currency"`
	Reason         string    `json:"reason,omitempty"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	IdempotencyKey string    `json:"idempotencyKey"`
	RequestHash    string    `json:"requestHash"`
	BlockHeight    int64     `json:"blockHeight"`
	TxHash         string    `json:"txHash"`
	AuditHash      string    `json:"auditHash"`
}

type BFTPayWebhook struct {
	EventID        string    `json:"eventId"`
	Signer         string    `json:"signer"`
	Merchant       string    `json:"merchant"`
	IntentID       string    `json:"intentId"`
	EventType      string    `json:"eventType"`
	Signature      string    `json:"signature"`
	PayloadHash    string    `json:"payloadHash"`
	SignedAt       time.Time `json:"signedAt"`
	Algorithm      string    `json:"algorithm"`
	IdempotencyKey string    `json:"idempotencyKey"`
	ReplaySafe     bool      `json:"replaySafe"`
	RequestHash    string    `json:"requestHash"`
	BlockHeight    int64     `json:"blockHeight"`
	TxHash         string    `json:"txHash"`
	AuditHash      string    `json:"auditHash"`
}

type BFTPayEvent struct {
	ID             string    `json:"id"`
	Type           string    `json:"type"`
	IntentID       string    `json:"intentId"`
	ObjectID       string    `json:"objectId"`
	Signer         string    `json:"signer"`
	Merchant       string    `json:"merchant"`
	Amount         int64     `json:"amount,omitempty"`
	Currency       string    `json:"currency"`
	IdempotencyKey string    `json:"idempotencyKey"`
	BlockHeight    int64     `json:"blockHeight"`
	TxHash         string    `json:"txHash"`
	AuditHash      string    `json:"auditHash"`
	CreatedAt      time.Time `json:"createdAt"`
}

type BFTPayIdempotency struct {
	ID             string `json:"id"`
	Signer         string `json:"signer"`
	Merchant       string `json:"merchant"`
	IdempotencyKey string `json:"idempotencyKey"`
	Action         string `json:"action"`
	RequestHash    string `json:"requestHash"`
	ObjectType     string `json:"objectType"`
	ObjectID       string `json:"objectId"`
	TxHash         string `json:"txHash"`
}

func isPayAction(action string) bool {
	switch action {
	case ActionPayIntentCreate, ActionPayInvoiceCreate, ActionPayRefundCreate, ActionPayWebhookRecord:
		return true
	default:
		return false
	}
}

func PayRequestHash(action string, value any) (string, error) {
	payload, err := json.Marshal(struct {
		Domain string `json:"domain"`
		Action string `json:"action"`
		Value  any    `json:"value"`
	}{Domain: "YNX_PAY_REQUEST_V1", Action: action, Value: value})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func PayIntentRequestHash(merchant string, amount int64, currency, callbackURL, key string) string {
	doc := struct {
		Merchant       string `json:"merchant"`
		Amount         int64  `json:"amount"`
		Currency       string `json:"currency"`
		CallbackURL    string `json:"callbackUrl,omitempty"`
		IdempotencyKey string `json:"idempotencyKey"`
	}{merchant, amount, currency, callbackURL, key}
	hash, _ := PayRequestHash(ActionPayIntentCreate, doc)
	return hash
}
func PayInvoiceRequestHash(merchant, intentID string, due int64, key string) string {
	doc := struct {
		Merchant       string `json:"merchant"`
		IntentID       string `json:"intentId"`
		DueInHours     int64  `json:"dueInHours"`
		IdempotencyKey string `json:"idempotencyKey"`
	}{merchant, intentID, due, key}
	hash, _ := PayRequestHash(ActionPayInvoiceCreate, doc)
	return hash
}
func PayRefundRequestHash(merchant, intentID string, amount int64, reason, key string) string {
	doc := struct {
		Merchant       string `json:"merchant"`
		IntentID       string `json:"intentId"`
		Amount         int64  `json:"amount"`
		Reason         string `json:"reason,omitempty"`
		IdempotencyKey string `json:"idempotencyKey"`
	}{merchant, intentID, amount, reason, key}
	hash, _ := PayRequestHash(ActionPayRefundCreate, doc)
	return hash
}
func PayWebhookRequestHash(merchant, intentID, eventType, key string) string {
	doc := struct {
		Merchant       string `json:"merchant"`
		IntentID       string `json:"intentId"`
		EventType      string `json:"eventType"`
		IdempotencyKey string `json:"idempotencyKey"`
	}{merchant, intentID, eventType, key}
	hash, _ := PayRequestHash(ActionPayWebhookRecord, doc)
	return hash
}

func PayIdempotencyID(merchant, key string) string {
	sum := sha256.Sum256([]byte("YNX_PAY_IDEMPOTENCY_V1|" + merchant + "|" + key))
	return hex.EncodeToString(sum[:])[:24]
}

func PayWebhookMaterial(merchant, intentID, eventType, idempotencyKey string, signedAt time.Time) (eventID, payloadHash string, message []byte) {
	message = []byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", merchant, intentID, eventType, idempotencyKey, signedAt.UTC().Format(time.RFC3339Nano)}, "|"))
	sum := sha256.Sum256(message)
	payloadHash = hex.EncodeToString(sum[:])
	eventID = payloadHash[:24]
	return
}

func canonicalPayActionPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionPayIntentCreate:
		var p PayIntentPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Merchant, p.CallbackURL, p.IdempotencyKey = strings.TrimSpace(p.Merchant), strings.TrimSpace(p.CallbackURL), strings.TrimSpace(p.IdempotencyKey)
		p.Currency = strings.ToUpper(strings.TrimSpace(p.Currency))
		if err := validatePayIdentity(p.Merchant, p.IdempotencyKey); err != nil {
			return nil, err
		}
		if p.Amount <= 0 || p.Currency != "YNXT" {
			return nil, errors.New("Pay intent requires positive YNXT amount")
		}
		if len(p.CallbackURL) > 2048 {
			return nil, errors.New("Pay callback URL exceeds limit")
		}
		if p.CallbackURL != "" {
			parsed, err := url.Parse(p.CallbackURL)
			if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
				return nil, errors.New("Pay callback URL must be absolute HTTPS without userinfo")
			}
		}
		if p.RequestHash != PayIntentRequestHash(p.Merchant, p.Amount, p.Currency, p.CallbackURL, p.IdempotencyKey) {
			return nil, errors.New("Pay request hash mismatch")
		}
		return json.Marshal(p)
	case ActionPayInvoiceCreate:
		var p PayInvoicePayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Merchant, p.IntentID, p.IdempotencyKey = strings.TrimSpace(p.Merchant), strings.TrimSpace(p.IntentID), strings.TrimSpace(p.IdempotencyKey)
		if err := validatePayIdentity(p.Merchant, p.IdempotencyKey); err != nil {
			return nil, err
		}
		if !payIDPattern.MatchString(p.IntentID) || p.DueInHours < 1 || p.DueInHours > 8760 {
			return nil, errors.New("invalid Pay invoice intent or due hours")
		}
		if p.RequestHash != PayInvoiceRequestHash(p.Merchant, p.IntentID, p.DueInHours, p.IdempotencyKey) {
			return nil, errors.New("Pay request hash mismatch")
		}
		return json.Marshal(p)
	case ActionPayRefundCreate:
		var p PayRefundPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Merchant, p.IntentID, p.Reason, p.IdempotencyKey = strings.TrimSpace(p.Merchant), strings.TrimSpace(p.IntentID), strings.TrimSpace(p.Reason), strings.TrimSpace(p.IdempotencyKey)
		if err := validatePayIdentity(p.Merchant, p.IdempotencyKey); err != nil {
			return nil, err
		}
		if !payIDPattern.MatchString(p.IntentID) || p.Amount <= 0 || len(p.Reason) > 1024 {
			return nil, errors.New("invalid Pay refund payload")
		}
		if p.RequestHash != PayRefundRequestHash(p.Merchant, p.IntentID, p.Amount, p.Reason, p.IdempotencyKey) {
			return nil, errors.New("Pay request hash mismatch")
		}
		return json.Marshal(p)
	case ActionPayWebhookRecord:
		var p PayWebhookPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Merchant, p.IntentID, p.EventType, p.IdempotencyKey = strings.TrimSpace(p.Merchant), strings.TrimSpace(p.IntentID), strings.TrimSpace(p.EventType), strings.TrimSpace(p.IdempotencyKey)
		p.EventID, p.PayloadHash, p.Signature, p.Algorithm, p.RequestHash = strings.ToLower(strings.TrimSpace(p.EventID)), strings.ToLower(strings.TrimSpace(p.PayloadHash)), strings.ToLower(strings.TrimSpace(p.Signature)), strings.ToLower(strings.TrimSpace(p.Algorithm)), strings.ToLower(strings.TrimSpace(p.RequestHash))
		p.SignedAt = p.SignedAt.UTC()
		if err := validatePayIdentity(p.Merchant, p.IdempotencyKey); err != nil {
			return nil, err
		}
		if !payIDPattern.MatchString(p.IntentID) || !payNamePattern.MatchString(p.EventType) || p.SignedAt.IsZero() || p.Algorithm != "hmac-sha256" || !payHashPattern.MatchString(p.PayloadHash) || !payHashPattern.MatchString(p.Signature) {
			return nil, errors.New("invalid Pay webhook metadata")
		}
		eventID, payloadHash, _ := PayWebhookMaterial(p.Merchant, p.IntentID, p.EventType, p.IdempotencyKey, p.SignedAt)
		if p.EventID != eventID || p.PayloadHash != payloadHash {
			return nil, errors.New("Pay webhook event or payload hash mismatch")
		}
		if p.RequestHash != PayWebhookRequestHash(p.Merchant, p.IntentID, p.EventType, p.IdempotencyKey) {
			return nil, errors.New("Pay request hash mismatch")
		}
		return json.Marshal(p)
	default:
		return nil, fmt.Errorf("unsupported Pay action %q", action)
	}
}

func validatePayIdentity(merchant, key string) error {
	if !payNamePattern.MatchString(merchant) || len(key) < 3 || len(key) > 128 || strings.TrimSpace(key) != key {
		return errors.New("Pay mutation requires bounded merchant and idempotency key")
	}
	return nil
}
