package mail

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	CanonicalMailEventSchemaVersion = "1.0.0"
	CanonicalMailEventOwner         = "25-mail"
	maxPendingCanonicalMailEvents   = 10000
	maxCanonicalMailEventBatch      = 1000

	EventMailSendApproved                 = "mail.send.approved"
	EventMailNativeDelivered              = "mail.native.delivered"
	EventMailInternetSubmissionFailed     = "mail.internet.submission_failed"
	EventMailInternetProviderAccepted     = "mail.internet.provider_accepted"
	EventMailInternetProviderDelayed      = "mail.internet.provider_delayed"
	EventMailInternetDelivered            = "mail.internet.delivered"
	EventMailInternetBounced              = "mail.internet.bounced"
	EventMailInternetComplained           = "mail.internet.complained"
	EventMailInternetFailed               = "mail.internet.failed"
	EventMailInternetProviderEventIgnored = "mail.internet.provider_event_ignored"
)

type canonicalEventInput struct {
	Type                   string
	MessageID              string
	ThreadIDHash           string
	ActorIDHash            string
	RecipientHash          string
	RecipientCount         int
	NativeRecipientCount   int
	InternetRecipientCount int
	Channel                string
	State                  DeliveryState
	ReasonCode             string
	Provider               string
	ProviderMessageID      string
	ProviderEventIDHash    string
	ProviderEventType      string
	Attempt                int
	Authority              string
	Source                 string
	Coverage               string
	Applied                bool
	MailServerDelivered    bool
	OccurredAt             time.Time
}

// DataFabricAdapter exposes a bounded pull/ack interface over the Mail-owned
// transactional outbox. It deliberately has no public HTTP route: transport
// authentication and central ingestion remain owned by 26-data-fabric,
// 29-integration and 30-security-sre.
type DataFabricAdapter struct {
	store *Store
}

func NewDataFabricAdapter(store *Store) (*DataFabricAdapter, error) {
	if store == nil {
		return nil, errors.New("mail store is required for Data Fabric adapter")
	}
	return &DataFabricAdapter{store: store}, nil
}

func (a *DataFabricAdapter) ReadBatch(limit int) (CanonicalMailEventBatch, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > maxCanonicalMailEventBatch {
		return CanonicalMailEventBatch{}, fmt.Errorf("canonical Mail event batch exceeds %d", maxCanonicalMailEventBatch)
	}
	out := CanonicalMailEventBatch{
		SchemaVersion: CanonicalMailEventSchemaVersion,
		Product:       ProductID,
		Events:        []CanonicalMailEvent{},
	}
	err := a.store.view(func(st State) error {
		out.Acknowledged = st.DataFabricAck
		pending := 0
		for _, event := range st.DataFabricEvents {
			if event.Sequence <= st.DataFabricAck {
				continue
			}
			pending++
			if len(out.Events) < limit {
				out.Events = append(out.Events, event)
				out.Through = event.Sequence
			}
		}
		out.PendingAfter = pending - len(out.Events)
		if len(out.Events) == 0 {
			out.Through = st.DataFabricAck
		}
		return nil
	})
	return out, err
}

func (a *DataFabricAdapter) Acknowledge(through uint64) error {
	return a.store.update(func(st *State) error {
		if through < st.DataFabricAck {
			return errors.New("canonical Mail event acknowledgement cannot move backwards")
		}
		lastEmitted := uint64(0)
		if st.NextDataFabricSequence > 0 {
			lastEmitted = st.NextDataFabricSequence - 1
		}
		if through > lastEmitted {
			return errors.New("canonical Mail event acknowledgement exceeds emitted sequence")
		}
		st.DataFabricAck = through
		kept := make([]CanonicalMailEvent, 0, len(st.DataFabricEvents))
		for _, event := range st.DataFabricEvents {
			if event.Sequence > through {
				kept = append(kept, event)
			}
		}
		st.DataFabricEvents = kept
		return nil
	})
}

func (s *Service) emitSendApprovedEvent(st *State, message Message, occurredAt time.Time) error {
	nativeCount := 0
	internetCount := 0
	for _, delivery := range message.Deliveries {
		switch delivery.Channel {
		case "ynx_native":
			nativeCount++
		case "internet_provider":
			internetCount++
		}
	}
	return s.emitCanonicalEvent(st, canonicalEventInput{
		Type:                   EventMailSendApproved,
		MessageID:              message.ID,
		ThreadIDHash:           digest(message.ThreadID),
		ActorIDHash:            digest(message.SenderID),
		RecipientCount:         len(message.Deliveries),
		NativeRecipientCount:   nativeCount,
		InternetRecipientCount: internetCount,
		Authority:              "ynx_mail_state",
		Source:                 ProductID,
		Coverage:               "approved_send_envelope",
		Applied:                true,
		OccurredAt:             occurredAt,
	})
}

func (s *Service) emitDeliveryEvent(st *State, eventType string, message Message, delivery Delivery, authority string, occurredAt time.Time, providerEventID, providerEventType string, applied bool) error {
	source := ProductID
	if strings.TrimSpace(delivery.Provider) != "" && authority != "ynx_mail_state" {
		source = delivery.Provider
	}
	return s.emitCanonicalEvent(st, canonicalEventInput{
		Type:                eventType,
		MessageID:           message.ID,
		ThreadIDHash:        digest(message.ThreadID),
		ActorIDHash:         digest(message.SenderID),
		RecipientHash:       digest(strings.ToLower(strings.TrimSpace(delivery.Recipient))),
		Channel:             delivery.Channel,
		State:               delivery.State,
		ReasonCode:          canonicalReasonCode(delivery),
		Provider:            delivery.Provider,
		ProviderMessageID:   delivery.ProviderMessageID,
		ProviderEventIDHash: hashOptional(providerEventID),
		ProviderEventType:   providerEventType,
		Attempt:             delivery.Attempt,
		Authority:           authority,
		Source:              source,
		Coverage:            "single_delivery_transition",
		Applied:             applied,
		MailServerDelivered: delivery.State == DeliveryDelivered && delivery.Channel == "internet_provider",
		OccurredAt:          occurredAt,
	})
}

func (s *Service) emitCanonicalEvent(st *State, input canonicalEventInput) error {
	if len(st.DataFabricEvents) >= maxPendingCanonicalMailEvents {
		return errors.New("canonical Mail event outbox is full; refusing to drop delivery evidence")
	}
	if strings.TrimSpace(input.Type) == "" || strings.TrimSpace(input.Authority) == "" {
		return errors.New("canonical Mail event type and authority are required")
	}
	now := s.now().UTC()
	occurredAt := input.OccurredAt.UTC()
	if occurredAt.IsZero() {
		occurredAt = now
	}
	sequence := st.NextDataFabricSequence
	if sequence == 0 {
		sequence = 1
	}
	event := CanonicalMailEvent{
		ID:                     s.id("mail-event"),
		SchemaVersion:          CanonicalMailEventSchemaVersion,
		Type:                   input.Type,
		Product:                ProductID,
		Owner:                  CanonicalMailEventOwner,
		SourceCommit:           s.sourceCommit,
		Sequence:               sequence,
		MessageID:              input.MessageID,
		ThreadIDHash:           input.ThreadIDHash,
		ActorIDHash:            input.ActorIDHash,
		RecipientHash:          input.RecipientHash,
		RecipientCount:         input.RecipientCount,
		NativeRecipientCount:   input.NativeRecipientCount,
		InternetRecipientCount: input.InternetRecipientCount,
		Channel:                input.Channel,
		State:                  input.State,
		ReasonCode:             input.ReasonCode,
		Provider:               input.Provider,
		ProviderMessageID:      input.ProviderMessageID,
		ProviderEventIDHash:    input.ProviderEventIDHash,
		ProviderEventType:      input.ProviderEventType,
		Attempt:                input.Attempt,
		Authority:              input.Authority,
		Source:                 input.Source,
		Coverage:               input.Coverage,
		PrivacyClass:           "operational_metadata",
		Applied:                input.Applied,
		MailServerDelivered:    input.MailServerDelivered,
		UserReadClaimed:        false,
		OccurredAt:             occurredAt,
		AsOf:                   occurredAt,
		RecordedAt:             now,
	}
	if event.Source == "" {
		event.Source = ProductID
	}
	if event.Coverage == "" {
		event.Coverage = "single_transition"
	}
	st.DataFabricEvents = append(st.DataFabricEvents, event)
	st.NextDataFabricSequence = sequence + 1
	return nil
}

func canonicalProviderEventType(state DeliveryState) string {
	switch state {
	case DeliveryProviderAccepted:
		return EventMailInternetProviderAccepted
	case DeliveryProviderDelayed:
		return EventMailInternetProviderDelayed
	case DeliveryDelivered:
		return EventMailInternetDelivered
	case DeliveryBounced:
		return EventMailInternetBounced
	case DeliveryComplained:
		return EventMailInternetComplained
	case DeliveryFailed:
		return EventMailInternetFailed
	default:
		return EventMailInternetProviderEventIgnored
	}
}

func canonicalReasonCode(delivery Delivery) string {
	reason := strings.TrimSpace(delivery.Reason)
	if reason != "" {
		switch reason {
		case "internet_provider_not_configured", "provider_submission_cancelled", "provider_submission_timeout", "provider_rate_limited", "provider_authorization_failed", "provider_submission_failed", "recipient_suppressed", "provider_delivery_delayed", "provider_bounced", "recipient_complained", "provider_suppressed", "invalid_recipient", "unknown_ynx_recipient", "recipient_blocked_sender":
			return reason
		}
	}
	switch delivery.State {
	case DeliveryBounced:
		return "provider_bounced"
	case DeliveryComplained:
		return "recipient_complained"
	case DeliveryProviderDelayed:
		return "provider_delivery_delayed"
	case DeliveryFailed:
		return "provider_delivery_failed"
	default:
		return ""
	}
}

func hashOptional(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return digest(value)
}
