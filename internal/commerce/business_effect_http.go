package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

type effectDispatchKey struct{}
type effectDispatch struct {
	store    *Store
	id       string
	verified *verifiedBusinessRequest
	actor    string
	check    func(*Store, string, BusinessEffect) error
}

func effectSendContext(ctx context.Context, store *Store, id string, verified *verifiedBusinessRequest, actor string, check func(*Store, string, BusinessEffect) error) context.Context {
	return context.WithValue(ctx, effectDispatchKey{}, effectDispatch{store, id, verified, actor, check})
}

type effectHTTPTransport struct{ base http.RoundTripper }

func guardedEffectHTTPClient(original *http.Client, timeout time.Duration) *http.Client {
	client := http.Client{Timeout: timeout}
	if original != nil {
		client = *original
	}
	base := client.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	client.Transport = effectHTTPTransport{base}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}

// Each actual HTTP dispatch gets a fresh private-authority check and a durable
// journal entry. Credentials are never journaled. Network I/O holds no Store lock.
func (t effectHTTPTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	d, ok := r.Context().Value(effectDispatchKey{}).(effectDispatch)
	if !ok || d.verified == nil {
		return nil, ErrUnauthorized
	}
	if err := d.verified.revalidate(r.Context()); err != nil {
		return nil, err
	}
	check := func() error {
		if err := d.verified.current(r.Context()); err != nil {
			return err
		}
		if !d.verified.proof.ExpiresAt.After(time.Now()) {
			return ErrUnauthorized
		}
		return nil
	}
	if err := check(); err != nil {
		return nil, err
	}
	var body []byte
	if r.Body != nil {
		var err error
		body, err = io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
		if err != nil {
			return nil, err
		}
		if len(body) > 1<<20 || (len(body) > 0 && !json.Valid(body)) {
			return nil, ErrInvalidState
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
	}
	step := BusinessEffectStep{Method: r.Method, Origin: r.URL.Scheme + "://" + r.URL.Host, Path: r.URL.EscapedPath(), RequestDigest: effectDigest(string(body)), Request: body, Phase: "dispatching"}
	index, err := d.store.appendEffectStep(r.Context(), d, step)
	if err != nil {
		return nil, err
	}
	if err := check(); err != nil {
		if saveErr := d.store.finishEffectStep(d.id, index, "not_sent", 0, nil); saveErr != nil {
			return nil, saveErr
		}
		return nil, err
	}
	response, err := t.base.RoundTrip(r)
	if err != nil {
		if saveErr := d.store.finishEffectStep(d.id, index, "unknown", 0, nil); saveErr != nil {
			return nil, saveErr
		}
		return nil, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	response.Body.Close()
	if readErr != nil || len(raw) > 1<<20 || !json.Valid(raw) {
		if saveErr := d.store.finishEffectStep(d.id, index, "response_unusable", response.StatusCode, nil); saveErr != nil {
			return nil, saveErr
		}
		return nil, ErrInvalidState
	}
	if err := d.store.finishEffectStep(d.id, index, "received", response.StatusCode, raw); err != nil {
		return nil, err
	}
	response.Body = io.NopCloser(bytes.NewReader(raw))
	return response, nil
}

func (s *Store) appendEffectStep(ctx context.Context, d effectDispatch, step BusinessEffectStep) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, verified := d.id, d.verified
	record, ok := s.s.BusinessEffects[id]
	if !ok || record.Phase != "dispatching" || record.Admission != businessNonceDigest(verified.proof.SessionBinding, verified.proof.Nonce) {
		return 0, ErrConflict
	}
	if readBusinessEffect(record.Kind) && step.Method != http.MethodGet {
		return 0, ErrInvalidState
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return 0, err
	}
	if err := verified.current(ctx); err != nil {
		return 0, err
	}
	if !verified.proof.ExpiresAt.After(s.now()) || d.check == nil {
		return 0, ErrUnauthorized
	}
	staged := &Store{s: before, now: s.now}
	if err := d.check(staged, d.actor, record); err != nil {
		return 0, err
	}
	if err := verified.current(ctx); err != nil {
		return 0, err
	}
	index := len(record.Steps)
	record.Steps = append(record.Steps, step)
	record.UpdatedAt = s.now()
	s.s.BusinessEffects[id] = record
	if err := s.persistLocked(); err != nil {
		s.s = before
		return 0, err
	}
	return index, nil
}
func (s *Store) finishEffectStep(id string, index int, phase string, status int, response json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.s.BusinessEffects[id]
	if !ok || record.Phase != "dispatching" || index < 0 || index >= len(record.Steps) || record.Steps[index].Phase != "dispatching" {
		return ErrConflict
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return err
	}
	record.Steps[index].Phase = phase
	record.Steps[index].Status = status
	record.Steps[index].Response = append(json.RawMessage(nil), response...)
	record.UpdatedAt = s.now()
	s.s.BusinessEffects[id] = record
	if err := s.persistLocked(); err != nil {
		s.s = before
		return err
	}
	return nil
}
