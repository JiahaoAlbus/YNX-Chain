package music

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// A dispatch admission is never a success receipt. Unknown transport outcomes
// stay durable and are never automatically resent, including after restart.
type MusicBusinessEffect struct {
	Actor          string          `json:"actor"`
	Kind           string          `json:"kind"`
	ObjectID       string          `json:"objectId"`
	WireDigest     string          `json:"wireDigest"`
	EndpointDigest string          `json:"endpointDigest"`
	Status         string          `json:"status"`
	AdmittedAt     time.Time       `json:"admittedAt"`
	Receipt        json.RawMessage `json:"receipt,omitempty"`
}

var errEffectExisting = errors.New("music effect already admitted")

func effectDigest(raw []byte) string          { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func effectKey(actor, kind, id string) string { return hashJSON([]string{actor, kind, id}) }
func effectObject(st *persistentState, actor, kind, id string) error {
	switch kind {
	case "trust":
		v, ok := st.Cases[id]
		if !ok {
			return ErrNotFound
		}
		if v.OpenedBy != actor {
			return ErrUnauthorized
		}
	case "ai":
		p, ok := st.AIProposals[id]
		if !ok {
			return ErrNotFound
		}
		if p.Owner != actor {
			return ErrUnauthorized
		}
	case "pay":
		v, ok := st.Settlements[id]
		if !ok {
			return ErrNotFound
		}
		if v.Creator != actor {
			return ErrUnauthorized
		}
		a, ok := st.Allocations[v.AllocationID]
		if !ok || a.Creator != actor || a.AmountMicros != v.AmountMicros {
			return ErrConflict
		}
	default:
		return ErrInvalid
	}
	return nil
}
func (s *Service) currentBusinessAuthority() error {
	if s.business == nil {
		return ErrUnauthorized
	}
	if err := s.business.check(s.cfg.Now); err != nil {
		return err
	}
	now := s.cfg.Now().UTC()
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.business.grant.ExpiresAt.After(now) || s.state.BusinessClock != nil && now.Before(*s.state.BusinessClock) {
		return ErrUnauthorized
	}
	return nil
}

// Only the original configured Pay/Trust contract is used; there is no guessed
// status/reconciliation route. A receipt may be replayed locally under fresh
// authority, while an admission without a receipt needs provider reconciliation.
func (s *Service) centralBusinessEffect(ctx context.Context, actor, kind, id, endpoint, key string, input, output any, validate func([]byte) error) error {
	if s.business == nil {
		return s.centralJSON(ctx, endpoint, key, input, output)
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || strings.TrimSpace(key) == "" {
		return fmt.Errorf("%w: central effect endpoint is not configured", ErrInvalid)
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return err
	}
	if len(raw) > 1<<20 {
		return ErrInvalid
	}
	wire, endpointHash := effectDigest(raw), effectDigest([]byte(endpoint))
	journalKey := effectKey(actor, kind, id)
	var existing MusicBusinessEffect
	err = s.mutate(actor, "business_effect_admitted", id, map[string]string{"kind": kind, "wireDigest": wire}, func(st *persistentState) error {
		if err := effectObject(st, actor, kind, id); err != nil {
			return err
		}
		if e, ok := st.BusinessEffects[journalKey]; ok {
			if e.Actor != actor || e.Kind != kind || e.ObjectID != id || e.WireDigest != wire || e.EndpointDigest != endpointHash {
				return ErrConflict
			}
			existing = e
			return errEffectExisting
		}
		if len(st.BusinessEffects) >= 2048 {
			return fmt.Errorf("%w: Music external effect capacity reached", ErrConflict)
		}
		if st.BusinessEffects == nil {
			st.BusinessEffects = map[string]MusicBusinessEffect{}
		}
		st.BusinessEffects[journalKey] = MusicBusinessEffect{Actor: actor, Kind: kind, ObjectID: id, WireDigest: wire, EndpointDigest: endpointHash, Status: "dispatch_admitted", AdmittedAt: s.cfg.Now().UTC()}
		return nil
	})
	if errors.Is(err, errEffectExisting) {
		if err := s.currentBusinessAuthority(); err != nil {
			return err
		}
		if existing.Status != "receipt" || len(existing.Receipt) == 0 {
			return fmt.Errorf("%w: external outcome requires reconciliation; request was not resent", ErrConflict)
		}
		if err := validate(existing.Receipt); err != nil {
			return err
		}
		return strictEffectJSON(existing.Receipt, output)
	}
	if err != nil {
		return err
	}
	// The lock is released before any network operation. Recheck the original
	// session/live actor after admission and immediately before actual dispatch.
	if err := s.currentBusinessAuthority(); err != nil {
		return err
	}
	callCtx, cancel := context.WithTimeout(s.business.ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("X-YNX-Product-Client", musicProductClient)
	client := *s.cfg.HTTPClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("external outcome is unknown; request was not resent: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		return errors.New("external outcome is unknown: invalid or oversized receipt")
	}
	mediaType, _, mediaErr := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || mediaErr != nil || mediaType != "application/json" {
		return errors.New("external outcome is unknown: central receipt was rejected")
	}
	if err := validate(body); err != nil {
		return err
	}
	// Receipt durability uses the same original authority and actor/object
	// checks as business writes. A late/cancelled response cannot link a result.
	err = s.mutate(actor, "business_effect_receipt", id, map[string]string{"kind": kind, "receiptDigest": effectDigest(body)}, func(st *persistentState) error {
		if err := effectObject(st, actor, kind, id); err != nil {
			return err
		}
		e, ok := st.BusinessEffects[journalKey]
		if !ok || e.Status != "dispatch_admitted" || e.WireDigest != wire || e.EndpointDigest != endpointHash {
			return ErrConflict
		}
		e.Status = "receipt"
		e.Receipt = append(json.RawMessage(nil), body...)
		st.BusinessEffects[journalKey] = e
		return nil
	})
	if err != nil {
		return err
	}
	return strictEffectJSON(body, output)
}
func strictEffectJSON(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return fmt.Errorf("invalid central receipt: %w", err)
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("invalid central receipt: trailing JSON")
	}
	return nil
}
func validateTrustReceipt(raw []byte) error {
	var v struct {
		ID string `json:"id"`
	}
	if err := strictEffectJSON(raw, &v); err != nil {
		return err
	}
	if v.ID == "" || v.ID != strings.TrimSpace(v.ID) || len(v.ID) > 256 {
		return ErrInvalid
	}
	return nil
}
func validatePayReceipt(raw []byte) error {
	var v struct {
		ID        string `json:"id"`
		ReviewURI string `json:"reviewUri"`
		Status    string `json:"status"`
	}
	if err := strictEffectJSON(raw, &v); err != nil {
		return err
	}
	u, err := url.Parse(v.ReviewURI)
	if v.ID == "" || v.ID != strings.TrimSpace(v.ID) || len(v.ID) > 256 || v.Status != "requires_wallet_review" || len(v.ReviewURI) > 4096 || err != nil || u.Scheme != "ynxpay" || u.Host != "settlement" || u.Path != "/review" || u.RawPath != "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return ErrInvalid
	}
	return nil
}
