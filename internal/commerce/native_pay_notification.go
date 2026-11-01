package commerce

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// A receiver credential authenticates notification DATA only. It cannot borrow
// Buyer, Pay invoice, Source, signing, funds or receipt-consumption authority.
// The original host supplies its actual Pay merchant/Store registration and
// secret; there is deliberately no request, ENV or implicit credential fallback.
type NativePayNotificationReceiver struct {
	MerchantID, StoreID string
	SecretVersion       int
	Secret              []byte
}

type nativePayNotificationPayload struct {
	Event         string                          `json:"event"`
	ObjectID      string                          `json:"objectId"`
	MerchantID    string                          `json:"merchantId"`
	OccurredAt    time.Time                       `json:"occurredAt"`
	NativeInvoice *nativePayNotificationReference `json:"nativeInvoice,omitempty"`
}

// Exact P06 NativeWebhookReference DATA, distinct from its verified receipt.
type nativePayNotificationReference struct {
	Version       string `json:"version"`
	Genesis       string `json:"genesis"`
	NativeChainID string `json:"nativeChainId"`
	Merchant      string `json:"merchant"`
	InvoiceID     string `json:"invoiceId"`
	SessionID     string `json:"sessionId"`
	SourceOrder   string `json:"sourceOrder"`
	NativeHash    string `json:"nativeHash"`
	ABCIHash      string `json:"abciHash"`
	EventClaim    string `json:"eventClaim"`
}

func (r *nativePayNotificationReference) valid(hash string) bool {
	if r == nil {
		return true
	}
	chain, err := strconv.ParseUint(r.NativeChainID, 10, 64)
	return r.Version == "ynx.pay.native.webhook-reference/v1" && nativeReceiptHex(r.Genesis, false) && err == nil && chain > 0 && strconv.FormatUint(chain, 10) == r.NativeChainID && nativeShopPaySegment(r.Merchant) && invoiceRecoveryID.MatchString(r.InvoiceID) && nativeShopPaySegment(r.SessionID) && invoiceRecoveryID.MatchString(r.SourceOrder) && r.NativeHash == hash && nativeReceiptHex(r.ABCIHash, true) && nativeReceiptHex(r.EventClaim, false)
}
func (r *nativePayNotificationReference) matches(order Order, receipt nativeShopArchiveReceipt) bool {
	return r == nil || (r.SourceOrder == order.ID && r.Merchant == receipt.Merchant && r.InvoiceID == receipt.InvoiceID && r.SessionID == receipt.SessionID && r.Genesis == receipt.Genesis && r.NativeChainID == receipt.NativeChainID && r.NativeHash == receipt.NativeHash && r.ABCIHash == receipt.ABCIHash && r.EventClaim == receipt.EventClaim)
}

// Immutable original event bytes survive retry signature changes and restart.
// ObservedOrderID is set only by the existing qualified receipt consumer.
type NativePayNotification struct {
	EventID, MerchantID, StoreID, NativeHash, Kind, PayloadSHA256 string
	Payload                                                       []byte
	ReceivedAt                                                    time.Time
	ObservedOrderID                                               string `json:",omitempty"`
}

func cloneNativePayReceivers(in []NativePayNotificationReceiver) []NativePayNotificationReceiver {
	out := append([]NativePayNotificationReceiver(nil), in...)
	for i := range out {
		out[i].Secret = bytes.Clone(out[i].Secret)
	}
	return out
}

func nativePayNotificationKey(merchant, event string) string { return merchant + "/" + event }
func nativePayEventID(event string) bool {
	if len(event) != 24 || !strings.HasPrefix(event, "whd_") {
		return false
	}
	raw, err := hex.DecodeString(event[4:])
	return err == nil && len(raw) == 10 && hex.EncodeToString(raw) == event[4:]
}

func nativePayNotificationDecode(raw []byte) (p nativePayNotificationPayload, err error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&p); err != nil {
		return p, ErrInvalidState
	}
	if len(raw) > 8192 || decoder.Decode(new(any)) != io.EOF || !p.NativeInvoice.valid(p.ObjectID) || p.OccurredAt.IsZero() || !invoiceRecoveryID.MatchString(p.MerchantID) || !nativeReceiptHex(p.ObjectID, true) || (p.Event != "native.invoice.invoice_settle" && p.Event != "native.invoice.invoice_refund") {
		return p, ErrInvalidState
	}
	return p, nil
}

func (s *Server) nativePayNotification(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery || r.Header.Get("Content-Type") != "application/json" {
		fail(w, 400, ErrInvalidState)
		return
	}
	if len(s.cfg.NativePayNotificationReceivers) == 0 {
		fail(w, 503, ErrUnavailable)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil {
		fail(w, 400, ErrInvalidState)
		return
	}
	p, err := nativePayNotificationDecode(raw)
	if err != nil {
		fail(w, 400, err)
		return
	}
	for _, key := range []string{"Content-Type", "X-YNX-Event-ID", "X-YNX-Delivery-ID", "X-YNX-Timestamp", "X-YNX-Payload-SHA256", "X-YNX-Signature-Version", "X-YNX-Signature"} {
		if len(r.Header.Values(key)) != 1 {
			fail(w, 401, ErrUnauthorized)
			return
		}
	}
	event := r.Header.Get("X-YNX-Event-ID")
	if !nativePayEventID(event) || r.Header.Get("X-YNX-Delivery-ID") != event {
		// The Pay root delivery ID is the event ID, including manual retry children.
		fail(w, 401, ErrUnauthorized)
		return
	}
	digest := sha256.Sum256(raw)
	payloadHash := hex.EncodeToString(digest[:])
	stamp := r.Header.Get("X-YNX-Timestamp")
	signedAt, err := time.Parse(time.RFC3339Nano, stamp)
	now := s.store.now().UTC()
	if err != nil || signedAt.UTC().Format(time.RFC3339Nano) != stamp || now.Sub(signedAt) > 5*time.Minute || signedAt.Sub(now) > 30*time.Second || r.Header.Get("X-YNX-Payload-SHA256") != payloadHash {
		fail(w, 401, ErrUnauthorized)
		return
	}
	var selected *NativePayNotificationReceiver
	for i := range s.cfg.NativePayNotificationReceivers {
		c := &s.cfg.NativePayNotificationReceivers[i]
		if c.MerchantID == p.MerchantID {
			if selected != nil { // ambiguous registration is not a credential
				fail(w, 503, ErrUnavailable)
				return
			}
			selected = c
		}
	}
	if selected == nil || !invoiceRecoveryID.MatchString(selected.StoreID) || selected.SecretVersion < 1 || len(selected.Secret) < 32 || len(selected.Secret) > 1024 {
		fail(w, 503, ErrUnavailable)
		return
	}
	version := strconv.Itoa(selected.SecretVersion)
	mac := hmac.New(sha256.New, selected.Secret)
	_, _ = mac.Write([]byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", event, stamp, payloadHash}, "\n")))
	if r.Header.Get("X-YNX-Signature-Version") != version || !hmac.Equal([]byte(r.Header.Get("X-YNX-Signature")), []byte("v"+version+"="+hex.EncodeToString(mac.Sum(nil)))) {
		fail(w, 401, ErrUnauthorized)
		return
	}
	record := NativePayNotification{EventID: event, MerchantID: p.MerchantID, StoreID: selected.StoreID, NativeHash: p.ObjectID, Kind: strings.TrimPrefix(p.Event, "native.invoice."), PayloadSHA256: payloadHash, Payload: bytes.Clone(raw), ReceivedAt: now}
	if err := s.store.stageNativePayNotification(record); err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 202, map[string]bool{"received": true, "queryOnly": true, "fundsVerified": false})
}

func (s *Store) stageNativePayNotification(record NativePayNotification) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := nativePayNotificationDecode(record.Payload)
	if err != nil {
		return err
	}
	if ref := p.NativeInvoice; ref != nil {
		order, ok := s.s.Orders[ref.SourceOrder]
		if !ok {
			return ErrNotFound
		}
		if order.StoreID != record.StoreID || order.InvoiceID != ref.InvoiceID || order.PayMerchant != ref.Merchant || !strings.HasPrefix(order.PayIntentID, "npi_") {
			return ErrConflict
		}
	}
	key := nativePayNotificationKey(record.MerchantID, record.EventID)
	if old, ok := s.s.NativePayNotifications[key]; ok {
		if old.StoreID != record.StoreID || old.PayloadSHA256 != record.PayloadSHA256 || !bytes.Equal(old.Payload, record.Payload) {
			return ErrConflict
		}
		return nil
	}
	if len(s.s.NativePayNotifications) >= 10000 {
		return ErrUnavailable // preserve the queue rather than silently evicting it
	}
	if s.s.NativePayNotifications == nil {
		s.s.NativePayNotifications = map[string]NativePayNotification{}
	}
	record.Payload = bytes.Clone(record.Payload)
	s.s.NativePayNotifications[key] = record
	if err := s.persistLocked(); err != nil {
		delete(s.s.NativePayNotifications, key)
		return err
	}
	return nil
}

// Called only from applyNativePaymentReceipt, after its existing independent
// Pay receipt verification. No callback endpoint calls this or applies money.
func (s *Store) observeNativePayNotificationsLocked(order Order, payment NativeShopPaymentRecord) bool {
	changed := false
	for key, notification := range s.s.NativePayNotifications {
		if notification.StoreID != order.StoreID || notification.ObservedOrderID != "" {
			continue
		}
		payload, err := nativePayNotificationDecode(notification.Payload)
		if err != nil {
			continue
		}
		for _, receipt := range payment.Receipts {
			if payload.NativeInvoice.matches(order, receipt) && receipt.NativeHash == notification.NativeHash && receipt.Kind == notification.Kind {
				notification.ObservedOrderID = order.ID
				s.s.NativePayNotifications[key] = notification
				changed = true
				break
			}
		}
	}
	return changed
}

func validateNativePayNotifications(snapshot Snapshot) error {
	if len(snapshot.NativePayNotifications) > 10000 {
		return fmt.Errorf("%w: native notification inbox bound", ErrInvalidState)
	}
	for key, record := range snapshot.NativePayNotifications {
		p, err := nativePayNotificationDecode(record.Payload)
		hash := sha256.Sum256(record.Payload)
		if err != nil || key != nativePayNotificationKey(record.MerchantID, record.EventID) || !nativePayEventID(record.EventID) || !invoiceRecoveryID.MatchString(record.StoreID) || record.MerchantID != p.MerchantID || record.NativeHash != p.ObjectID || record.Kind != strings.TrimPrefix(p.Event, "native.invoice.") || record.PayloadSHA256 != hex.EncodeToString(hash[:]) || record.ReceivedAt.IsZero() {
			return fmt.Errorf("%w: original native notification changed", ErrInvalidState)
		}
		if record.ObservedOrderID != "" {
			order, ok := snapshot.Orders[record.ObservedOrderID]
			matched := false
			if ok && order.StoreID == record.StoreID && order.NativePayment != nil {
				for _, receipt := range order.NativePayment.Receipts {
					matched = matched || (p.NativeInvoice.matches(order, receipt) && receipt.NativeHash == record.NativeHash && receipt.Kind == record.Kind)
				}
			}
			if !matched {
				return fmt.Errorf("%w: notification lacks original receipt observation", ErrInvalidState)
			}
		}
	}
	return nil
}
