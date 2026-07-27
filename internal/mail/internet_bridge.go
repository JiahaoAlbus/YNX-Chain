package mail

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	stdmail "net/mail"
	"strconv"
	"strings"
	"time"
)

const (
	resendProviderName   = "resend"
	resendDefaultBaseURL = "https://api.resend.com"
	webhookTolerance     = 5 * time.Minute
)

// InternetBridgeStatus reports configuration capability only. It does not
// claim that a domain is verified, a message was delivered, or a recipient
// read a message.
type InternetBridgeStatus struct {
	Provider                      string `json:"provider"`
	SubmissionConfigured          bool   `json:"submission_configured"`
	WebhookVerificationConfigured bool   `json:"webhook_verification_configured"`
	SenderIdentityConfigured      bool   `json:"sender_identity_configured"`
}

type InternetMail struct {
	MessageID      string
	SenderHandle   string
	Recipient      string
	Subject        string
	Body           string
	Attachments    []Attachment
	IdempotencyKey string
}

type InternetSubmission struct {
	Provider          string
	ProviderMessageID string
	AcceptedAt        time.Time
}

// ProviderEvent is the bounded, provider-neutral event persisted by YNX Mail.
// It intentionally excludes message bodies, API credentials, and raw webhook
// payloads.
type ProviderEvent struct {
	EventID           string        `json:"event_id"`
	Provider          string        `json:"provider"`
	ProviderMessageID string        `json:"provider_message_id"`
	Type              string        `json:"type"`
	State             DeliveryState `json:"state,omitempty"`
	Reason            string        `json:"reason,omitempty"`
	OccurredAt        time.Time     `json:"occurred_at"`
	ReceivedAt        time.Time     `json:"received_at"`
	Ignored           bool          `json:"ignored,omitempty"`
}

type InternetBridge interface {
	Status() InternetBridgeStatus
	Submit(context.Context, InternetMail) (InternetSubmission, error)
	VerifyWebhook(http.Header, []byte, time.Time) (ProviderEvent, error)
}

// ResendBridge implements the official Resend HTTPS API boundary without
// embedding credentials in repository state. A successful POST means provider
// acceptance only; delivery is established exclusively by a verified webhook.
type ResendBridge struct {
	BaseURL       string
	APIKey        string
	From          string
	WebhookSecret string
	Client        *http.Client
}

func (b ResendBridge) Status() InternetBridgeStatus {
	apiKey := strings.TrimSpace(b.APIKey) != ""
	from := strings.TrimSpace(b.From) != ""
	return InternetBridgeStatus{
		Provider:                      resendProviderName,
		SubmissionConfigured:          apiKey && from,
		WebhookVerificationConfigured: strings.TrimSpace(b.WebhookSecret) != "",
		SenderIdentityConfigured:      from,
	}
}

func (b ResendBridge) Submit(ctx context.Context, message InternetMail) (InternetSubmission, error) {
	status := b.Status()
	if !status.SubmissionConfigured {
		return InternetSubmission{}, errors.New("Resend submission is not configured")
	}
	if message.MessageID == "" || message.IdempotencyKey == "" || len(message.IdempotencyKey) > 256 {
		return InternetSubmission{}, errors.New("internet message identity or idempotency key is invalid")
	}
	if _, err := parseInternetAddress(message.Recipient); err != nil {
		return InternetSubmission{}, err
	}
	if _, err := stdmail.ParseAddress(strings.TrimSpace(b.From)); err != nil {
		return InternetSubmission{}, errors.New("configured internet sender identity is invalid")
	}

	type resendAttachment struct {
		Filename string `json:"filename"`
		Content  string `json:"content"`
	}
	payload := struct {
		From        string              `json:"from"`
		To          []string            `json:"to"`
		Subject     string              `json:"subject"`
		Text        string              `json:"text"`
		Attachments []resendAttachment  `json:"attachments,omitempty"`
		Tags        []map[string]string `json:"tags,omitempty"`
	}{
		From:    strings.TrimSpace(b.From),
		To:      []string{message.Recipient},
		Subject: message.Subject,
		Text:    message.Body,
		Tags: []map[string]string{
			{"name": "product", "value": "ynx-mail"},
			{"name": "message_id", "value": safeProviderTag(message.MessageID)},
		},
	}
	for _, attachment := range message.Attachments {
		payload.Attachments = append(payload.Attachments, resendAttachment{Filename: attachment.Name, Content: attachment.ContentBase64})
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return InternetSubmission{}, err
	}
	baseURL := strings.TrimRight(strings.TrimSpace(b.BaseURL), "/")
	if baseURL == "" {
		baseURL = resendDefaultBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/emails", bytes.NewReader(body))
	if err != nil {
		return InternetSubmission{}, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(b.APIKey))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", message.IdempotencyKey)
	client := b.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return InternetSubmission{}, err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, (64<<10)+1))
	if err != nil || len(responseBody) > 64<<10 {
		return InternetSubmission{}, errors.New("Resend response exceeds limit")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return InternetSubmission{}, fmt.Errorf("Resend rejected submission with status %d", resp.StatusCode)
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(responseBody, &result); err != nil || strings.TrimSpace(result.ID) == "" {
		return InternetSubmission{}, errors.New("Resend response did not contain a message id")
	}
	return InternetSubmission{Provider: resendProviderName, ProviderMessageID: strings.TrimSpace(result.ID), AcceptedAt: time.Now().UTC()}, nil
}

func (b ResendBridge) VerifyWebhook(headers http.Header, raw []byte, now time.Time) (ProviderEvent, error) {
	if !b.Status().WebhookVerificationConfigured {
		return ProviderEvent{}, errors.New("Resend webhook verification is not configured")
	}
	eventID := firstHeader(headers, "Svix-Id", "Webhook-Id")
	timestampText := firstHeader(headers, "Svix-Timestamp", "Webhook-Timestamp")
	signatures := firstHeader(headers, "Svix-Signature", "Webhook-Signature")
	if eventID == "" || timestampText == "" || signatures == "" || len(raw) == 0 {
		return ProviderEvent{}, errors.New("Resend webhook signature headers or payload are missing")
	}
	timestamp, err := strconv.ParseInt(timestampText, 10, 64)
	if err != nil {
		return ProviderEvent{}, errors.New("Resend webhook timestamp is invalid")
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	attemptAt := time.Unix(timestamp, 0).UTC()
	if delta := now.Sub(attemptAt); delta > webhookTolerance || delta < -webhookTolerance {
		return ProviderEvent{}, errors.New("Resend webhook timestamp is outside tolerance")
	}
	key, err := decodeWebhookSecret(b.WebhookSecret)
	if err != nil {
		return ProviderEvent{}, err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(eventID + "." + timestampText + "."))
	_, _ = mac.Write(raw)
	expected := mac.Sum(nil)
	verified := false
	for _, item := range strings.Fields(signatures) {
		parts := strings.SplitN(item, ",", 2)
		if len(parts) != 2 || parts[0] != "v1" {
			continue
		}
		actual, decodeErr := decodeFlexibleBase64(parts[1])
		if decodeErr == nil && hmac.Equal(actual, expected) {
			verified = true
			break
		}
	}
	if !verified {
		return ProviderEvent{}, errors.New("Resend webhook signature mismatch")
	}

	var payload struct {
		Type      string `json:"type"`
		CreatedAt string `json:"created_at"`
		Data      struct {
			EmailID string `json:"email_id"`
			Bounce  struct {
				Message string `json:"message"`
			} `json:"bounce"`
			Failed struct {
				Reason string `json:"reason"`
			} `json:"failed"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ProviderEvent{}, errors.New("Resend webhook payload is invalid")
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, payload.CreatedAt)
	if err != nil || strings.TrimSpace(payload.Type) == "" || strings.TrimSpace(payload.Data.EmailID) == "" {
		return ProviderEvent{}, errors.New("Resend webhook event identity or timestamp is invalid")
	}
	event := ProviderEvent{
		EventID:           eventID,
		Provider:          resendProviderName,
		ProviderMessageID: strings.TrimSpace(payload.Data.EmailID),
		Type:              strings.TrimSpace(payload.Type),
		OccurredAt:        occurredAt.UTC(),
		ReceivedAt:        now.UTC(),
	}
	switch event.Type {
	case "email.scheduled":
		event.State = DeliveryQueued
	case "email.sent":
		event.State = DeliveryProviderAccepted
	case "email.delivery_delayed":
		event.State = DeliveryProviderDelayed
		event.Reason = "provider_delivery_delayed"
	case "email.delivered":
		event.State = DeliveryDelivered
	case "email.bounced":
		event.State = DeliveryBounced
		event.Reason = sanitizeProviderReason(payload.Data.Bounce.Message, "provider_bounced")
	case "email.complained":
		event.State = DeliveryComplained
		event.Reason = "recipient_complained"
	case "email.failed":
		event.State = DeliveryFailed
		event.Reason = sanitizeProviderReason(payload.Data.Failed.Reason, "provider_failed")
	case "email.suppressed":
		event.State = DeliveryFailed
		event.Reason = "provider_suppressed"
	case "email.opened", "email.clicked":
		// Engagement signals are not authoritative user-read state in YNX Mail.
		event.Ignored = true
	default:
		event.Ignored = true
	}
	return event, nil
}

func parseInternetAddress(value string) (string, error) {
	value = strings.TrimSpace(value)
	address, err := stdmail.ParseAddress(value)
	if err != nil || !strings.Contains(address.Address, "@") || strings.HasPrefix(value, "@") {
		return "", errors.New("invalid internet recipient address")
	}
	return strings.ToLower(address.Address), nil
}

func isInternetAddress(value string) bool {
	_, err := parseInternetAddress(value)
	return err == nil
}

func safeProviderTag(value string) string {
	var out strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			out.WriteRune(r)
		}
	}
	if out.Len() == 0 {
		return "unknown"
	}
	if out.Len() > 256 {
		return out.String()[:256]
	}
	return out.String()
}

func firstHeader(headers http.Header, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(headers.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

func decodeWebhookSecret(secret string) ([]byte, error) {
	secret = strings.TrimSpace(secret)
	if !strings.HasPrefix(secret, "whsec_") {
		return nil, errors.New("Resend webhook secret format is invalid")
	}
	decoded, err := decodeFlexibleBase64(strings.TrimPrefix(secret, "whsec_"))
	if err != nil || len(decoded) < 16 {
		return nil, errors.New("Resend webhook secret is invalid")
	}
	return decoded, nil
}

func decodeFlexibleBase64(value string) ([]byte, error) {
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil {
			return decoded, nil
		}
	}
	return nil, errors.New("invalid base64 value")
}

func sanitizeProviderReason(reason, fallback string) string {
	reason = strings.Join(strings.Fields(reason), " ")
	if reason == "" {
		return fallback
	}
	if len(reason) > 500 {
		return reason[:500]
	}
	return reason
}
