//go:build pay_pq

package payproduct

import (
	"context"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
)

// These are references to the original independently proven CORE effects.
// No callback signature/secret, balance, client approval or new wire is added.
type NativeInvoiceEvent struct {
	EventID                string `json:"eventId"`
	Genesis                string `json:"genesis"`
	Merchant               string `json:"merchant"`
	InvoiceID              string `json:"invoiceId"`
	SessionID              string `json:"sessionId"`
	SourceOrder            string `json:"sourceOrder"`
	NativeHash             string `json:"nativeHash"`
	ABCIHash               string `json:"abciHash"`
	Member                 string `json:"memberIndex"`
	Event                  string `json:"eventIndex"`
	Height                 string `json:"executionHeight"`
	Kind                   string `json:"kind"`
	EffectHash             string `json:"effectHash"`
	OriginalWebhookEventID string `json:"originalWebhookEventId,omitempty"`
}
type NativeInvoiceEventFeed struct {
	Merchant  string               `json:"merchant"`
	InvoiceID string               `json:"invoiceId"`
	Events    []NativeInvoiceEvent `json:"events"`
	Authority string               `json:"authority"`
}

func (n *NativePayService) InvoiceEvents(ctx context.Context, merchant, id string) (NativeInvoiceEventFeed, error) {
	state, err := n.Read(ctx, merchant, id)
	if err != nil {
		return NativeInvoiceEventFeed{}, err
	}
	feed := NativeInvoiceEventFeed{Merchant: merchant, InvoiceID: id, Events: []NativeInvoiceEvent{}, Authority: "original-core-effect-claims/private-source"}
	for _, op := range state.Operations {
		if op.Status != "confirmed" || op.Effect == nil {
			continue
		}
		effect := *op.Effect
		if effect.Genesis != hex.EncodeToString(n.cfg.Genesis) || effect.NativeChainID != n.cfg.NativeChainID || effect.Kind != op.Kind || effect.SessionID != state.SessionID || effect.TermsHash != state.TermsHash || effect.Merchant != merchant || effect.InvoiceID != id || effect.NativeHash != op.NativeHash || effect.ABCIHash != op.ABCIHash {
			return NativeInvoiceEventFeed{}, errors.New("original native event journal requires recovery")
		}
		feed.Events = append(feed.Events, NativeInvoiceEvent{EventID: nativeEventClaim(effect), Genesis: effect.Genesis, Merchant: merchant, InvoiceID: id, SessionID: effect.SessionID, SourceOrder: state.SourceOrder, NativeHash: op.NativeHash, ABCIHash: op.ABCIHash, Member: strconv.FormatUint(uint64(effect.Member), 10), Event: strconv.FormatUint(uint64(effect.Event), 10), Height: strconv.FormatInt(effect.Height, 10), Kind: op.Kind, EffectHash: hashJSON(effect)})
	}
	if len(feed.Events) > 1024 {
		return NativeInvoiceEventFeed{}, errors.New("bounded original native event feed exceeded")
	}
	// Reuse the actual retained original outbox identity where one was supplied.
	// Manual replay children cannot manufacture a new funds event or feed entry.
	err = n.parent.store.View(func(data Snapshot) error {
		for i, event := range feed.Events {
			for _, d := range data.Deliveries {
				if d.ParentDeliveryID == "" && d.MerchantID == state.ProductMerchantID && d.ObjectID == event.NativeHash && d.EventType == "native.invoice."+event.Kind {
					if feed.Events[i].OriginalWebhookEventID != "" && feed.Events[i].OriginalWebhookEventID != d.ID {
						return errors.New("original webhook event identity conflicts")
					}
					feed.Events[i].OriginalWebhookEventID = d.ID
				}
			}
		}
		return nil
	})
	if err != nil {
		return NativeInvoiceEventFeed{}, err
	}
	sort.Slice(feed.Events, func(i, j int) bool {
		a, _ := strconv.ParseInt(feed.Events[i].Height, 10, 64)
		b, _ := strconv.ParseInt(feed.Events[j].Height, 10, 64)
		if a != b {
			return a < b
		}
		return feed.Events[i].EventID < feed.Events[j].EventID
	})
	// Late revocation may keep public archival facts, but cannot return a private
	// feed to an obsolete caller. Read obtains the original current Source again.
	if _, err = n.Read(ctx, merchant, id); err != nil {
		return NativeInvoiceEventFeed{}, err
	}
	return feed, nil
}
