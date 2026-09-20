package brokerage

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

// TradeEvent is the strict, tenant-bound subset of the Broker API trade SSE
// envelope that Finance can persist. It intentionally excludes provider
// account credentials and any opaque body.
type TradeEvent struct {
	Cursor            string    `json:"cursor"`
	ProviderAccountID string    `json:"providerAccountId"`
	Event             string    `json:"event"`
	Timestamp         time.Time `json:"timestamp"`
	Order             Order     `json:"order"`
}

// ParseTradeEventStream parses a bounded SSE response already obtained by an
// operator-controlled worker. It does not open a network connection. Every
// event must name the one account resolved for the authenticated YNX subject.
func ParseTradeEventStream(reader io.Reader, expectedAccountID string, maxEvents int) ([]TradeEvent, string, error) {
	if !uuid.MatchString(expectedAccountID) || maxEvents < 1 || maxEvents > 512 {
		return nil, "", errors.New("TRADE_EVENT_REQUEST_INVALID")
	}
	scanner := bufio.NewScanner(io.LimitReader(reader, 2<<20))
	scanner.Buffer(make([]byte, 4096), 256<<10)
	var id, eventName string
	var data bytes.Buffer
	result := make([]TradeEvent, 0)
	flush := func() error {
		if id == "" && eventName == "" && data.Len() == 0 {
			return nil
		}
		if !auditID.MatchString(id) || eventName != "trade_updates" || data.Len() == 0 {
			return errors.New("PROVIDER_PROTOCOL_ERROR")
		}
		var envelope struct {
			AccountID string        `json:"account_id"`
			Event     string        `json:"event"`
			Timestamp string        `json:"timestamp"`
			At        string        `json:"at"`
			EventID   string        `json:"event_id"`
			Order     providerOrder `json:"order"`
		}
		decoder := json.NewDecoder(bytes.NewReader(data.Bytes()))
		if err := decoder.Decode(&envelope); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
			return errors.New("PROVIDER_PROTOCOL_ERROR")
		}
		if envelope.AccountID != expectedAccountID || !validTradeEvent(envelope.Event) || (envelope.EventID != "" && envelope.EventID != id) {
			return errors.New("PROVIDER_PROTOCOL_ERROR")
		}
		order, err := normalizeProviderOrder(envelope.Order, "", false)
		if err != nil || !tradeEventStatusMatches(envelope.Event, order.Status) {
			return errors.New("PROVIDER_PROTOCOL_ERROR")
		}
		// Broker V2 defines timestamp as the trade update occurrence time and at
		// as the envelope publication time. They are independently valid and are
		// not expected to be identical. Persist occurrence time when available.
		if envelope.At != "" {
			if _, err := time.Parse(time.RFC3339Nano, envelope.At); err != nil {
				return errors.New("PROVIDER_PROTOCOL_ERROR")
			}
		}
		timestampText := envelope.Timestamp
		if timestampText == "" {
			timestampText = envelope.At
		}
		timestamp, err := time.Parse(time.RFC3339Nano, timestampText)
		if err != nil {
			return errors.New("PROVIDER_PROTOCOL_ERROR")
		}
		result = append(result, TradeEvent{Cursor: id, ProviderAccountID: envelope.AccountID, Event: envelope.Event, Timestamp: timestamp, Order: order})
		if len(result) > maxEvents {
			return errors.New("TRADE_EVENT_LIMIT_EXCEEDED")
		}
		id, eventName = "", ""
		data.Reset()
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := flush(); err != nil {
				return nil, "", err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			return nil, "", errors.New("PROVIDER_PROTOCOL_ERROR")
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "id":
			if id != "" {
				return nil, "", errors.New("PROVIDER_PROTOCOL_ERROR")
			}
			id = value
		case "event":
			eventName = value
		case "data":
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(value)
		default:
			return nil, "", fmt.Errorf("PROVIDER_PROTOCOL_ERROR")
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, "", errors.New("PROVIDER_PROTOCOL_ERROR")
	}
	if err := flush(); err != nil {
		return nil, "", err
	}
	if len(result) == 0 {
		return nil, "", errors.New("TRADE_EVENT_STREAM_EMPTY")
	}
	return result, result[len(result)-1].Cursor, nil
}

func tradeEventStatusMatches(event, status string) bool {
	expected := map[string]map[string]bool{
		"new":            {"new": true, "accepted": true, "pending_new": true, "accepted_for_bidding": true},
		"fill":           {"filled": true},
		"partial_fill":   {"partially_filled": true},
		"canceled":       {"canceled": true},
		"expired":        {"expired": true},
		"rejected":       {"rejected": true},
		"pending_cancel": {"pending_cancel": true},
		"replaced":       {"replaced": true},
	}
	return expected[event][status]
}

func validTradeEvent(value string) bool {
	switch value {
	case "new", "fill", "partial_fill", "canceled", "expired", "rejected", "pending_cancel", "replaced":
		return true
	default:
		return false
	}
}
