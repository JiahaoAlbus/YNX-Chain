package mail

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

func (s *Service) submitInternetDelivery(ctx context.Context, message Message, recipient string) (Message, error) {
	if s.bridge == nil || !s.bridge.Status().SubmissionConfigured {
		return s.updateInternetSubmission(message.ID, recipient, InternetSubmission{}, errors.New("internet provider is not configured"))
	}
	attempt := 1
	for _, delivery := range message.Deliveries {
		if delivery.Recipient == recipient && delivery.Channel == "internet_provider" {
			if delivery.Attempt > 0 {
				attempt = delivery.Attempt
			}
			break
		}
	}
	submission, err := s.bridge.Submit(ctx, InternetMail{
		MessageID:      message.ID,
		SenderHandle:   message.SenderHandle,
		Recipient:      recipient,
		Subject:        message.Subject,
		Body:           message.Body,
		Attachments:    append([]Attachment{}, message.Attachments...),
		IdempotencyKey: "ynx-mail/" + safeProviderTag(message.ID) + "/" + digest(strings.ToLower(strings.TrimSpace(recipient)))[:24] + "/" + strconv.Itoa(attempt),
	})
	return s.updateInternetSubmission(message.ID, recipient, submission, err)
}

func (s *Service) updateInternetSubmission(messageID, recipient string, submission InternetSubmission, submissionErr error) (Message, error) {
	var out Message
	err := s.store.update(func(st *State) error {
		message, ok := st.Messages[messageID]
		if !ok {
			return errors.New("internet submission message not found")
		}
		index := -1
		for i, delivery := range message.Deliveries {
			if delivery.Recipient == recipient && delivery.Channel == "internet_provider" {
				index = i
				break
			}
		}
		if index < 0 {
			return errors.New("internet submission delivery not found")
		}
		now := s.now().UTC()
		delivery := message.Deliveries[index]
		if submissionErr != nil {
			delivery.State = DeliveryFailed
			delivery.Reason = providerSubmissionReason(submissionErr)
			delivery.UpdatedAt = now
			s.audit(st, message.SenderID, "internet_provider_submission_failed", message.ID, map[string]any{
				"recipient_hash": digest(strings.ToLower(strings.TrimSpace(recipient))),
				"provider":       delivery.Provider,
				"reason":         delivery.Reason,
				"attempt":        delivery.Attempt,
			})
		} else {
			acceptedAt := submission.AcceptedAt.UTC()
			if acceptedAt.IsZero() {
				acceptedAt = now
			}
			delivery.State = DeliveryProviderAccepted
			delivery.Reason = ""
			delivery.Provider = submission.Provider
			delivery.ProviderMessageID = submission.ProviderMessageID
			delivery.ProviderEventAt = acceptedAt
			delivery.LastProviderEvent = "api.accepted"
			delivery.UpdatedAt = now
			s.audit(st, message.SenderID, "internet_provider_accepted", message.ID, map[string]any{
				"recipient_hash":        digest(strings.ToLower(strings.TrimSpace(recipient))),
				"provider":              submission.Provider,
				"provider_message_id":   submission.ProviderMessageID,
				"provider_state":        delivery.State,
				"attempt":               delivery.Attempt,
				"user_read_claimed":     false,
				"mail_server_delivered": false,
			})
		}
		message.Deliveries[index] = delivery
		st.Messages[message.ID] = message
		out = message
		return nil
	})
	return out, err
}

func (s *Service) HandleInternetWebhook(headers http.Header, raw []byte) (duplicate, matched bool, event ProviderEvent, err error) {
	if s.bridge == nil {
		return false, false, ProviderEvent{}, errors.New("internet provider is not configured")
	}
	event, err = s.bridge.VerifyWebhook(headers, raw, s.now().UTC())
	if err != nil {
		return false, false, ProviderEvent{}, err
	}
	err = s.store.update(func(st *State) error {
		if _, exists := st.ProviderEvents[event.EventID]; exists {
			duplicate = true
			return nil
		}
		st.ProviderEvents[event.EventID] = event
		for messageID, message := range st.Messages {
			for i, delivery := range message.Deliveries {
				if delivery.Provider != event.Provider || delivery.ProviderMessageID != event.ProviderMessageID {
					continue
				}
				matched = true
				applied := false
				if shouldApplyProviderEvent(delivery, event) {
					delivery.State = event.State
					delivery.Reason = event.Reason
					delivery.ProviderEventAt = event.OccurredAt
					delivery.LastProviderEvent = event.Type
					delivery.UpdatedAt = event.ReceivedAt
					message.Deliveries[i] = delivery
					st.Messages[messageID] = message
					applied = true
				}
				s.audit(st, message.SenderID, "internet_provider_webhook", message.ID, map[string]any{
					"event_id":              event.EventID,
					"event_type":            event.Type,
					"provider":              event.Provider,
					"provider_message_id":   event.ProviderMessageID,
					"state":                 event.State,
					"applied":               applied,
					"ignored":               event.Ignored,
					"user_read_claimed":     false,
					"mail_server_delivered": event.State == DeliveryDelivered,
				})
				return nil
			}
		}
		return nil
	})
	return duplicate, matched, event, err
}

func shouldApplyProviderEvent(current Delivery, event ProviderEvent) bool {
	if event.Ignored || event.State == "" {
		return false
	}
	if !current.ProviderEventAt.IsZero() && event.OccurredAt.Before(current.ProviderEventAt) {
		return false
	}
	return deliveryStateRank(event.State) >= deliveryStateRank(current.State)
}

func deliveryStateRank(state DeliveryState) int {
	switch state {
	case DeliveryQueued:
		return 1
	case DeliveryProviderAccepted, DeliveryProviderDelayed:
		return 2
	case DeliveryDelivered:
		return 3
	case DeliveryBounced, DeliveryComplained, DeliveryFailed:
		return 4
	default:
		return 0
	}
}

func providerSubmissionReason(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "provider_submission_cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		return "provider_submission_timeout"
	case strings.Contains(strings.ToLower(err.Error()), "status 429"):
		return "provider_rate_limited"
	case strings.Contains(strings.ToLower(err.Error()), "status 401"), strings.Contains(strings.ToLower(err.Error()), "status 403"):
		return "provider_authorization_failed"
	case strings.Contains(strings.ToLower(err.Error()), "not configured"):
		return "internet_provider_not_configured"
	default:
		return "provider_submission_failed"
	}
}
