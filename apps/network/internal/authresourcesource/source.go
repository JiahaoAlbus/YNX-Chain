// Package networkresourcesource is Auth's private normal Go→Native adapter.
// It is not a sandbox authorizer, Root constructor from DATA, or a worker.
package networkresourcesource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

var ErrNotSupplied = errors.New("NETWORK_RESOURCE_NATIVE_SOURCE_NOT_SUPPLIED")
var ErrRetired = errors.New("NETWORK_RESOURCE_SOURCE_RETIRED")
var ErrClaimNotSupplied = errors.New("NETWORK_RESOURCE_ORIGINAL_ONCE_EFFECT_BINDING_NOT_SUPPLIED")

type handle struct{ source, context uintptr }
type drain struct {
	complete bool
	err      error
}

// Private implementation only. No exported provider/setter or ctx.Value token.
type native interface {
	acquire() (handle, error)
	current(handle) error
	read(handle, uint32) ([]byte, error)
	verify(handle, uint32, []byte, []byte) error
	retire(handle) error
	join(handle) drain
	close(handle) drain
}
type Source struct {
	mu                                                   sync.Mutex
	abi                                                  native
	h                                                    handle
	active                                               sync.WaitGroup
	retired, joinSelected, joined, closeSelected, closed bool
	joinDone, closeDone                                  chan struct{}
	joinResult, closeResult                              drain
	first                                                error
}

func Open(ctx context.Context) (*Source, error) { return openNative(ctx, normalNative()) }
func openNative(ctx context.Context, abi native) (*Source, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	h, err := abi.acquire()
	if h.source == 0 {
		return nil, errors.Join(ErrNotSupplied, err)
	}
	s := &Source{abi: abi, h: h, first: err}
	if err != nil {
		return s, err
	}
	if err = ctx.Err(); err == nil {
		err = s.Current(ctx)
	}
	if err != nil {
		_ = s.Retire()
		s.first = err
		return s, err
	}
	return s, nil
}
func (s *Source) enter(ctx context.Context) (func(), error) {
	if s == nil {
		return nil, ErrNotSupplied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.retired || s.closed {
		return nil, ErrRetired
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.active.Add(1)
	return s.active.Done, nil
}
func (s *Source) post(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.retired || s.closed {
		return ErrRetired
	}
	return nil
}
func (s *Source) Current(ctx context.Context) error {
	done, err := s.enter(ctx)
	if err != nil {
		return err
	}
	defer done()
	if err = s.abi.current(s.h); err != nil {
		return err
	}
	return s.post(ctx)
}
func (s *Source) read(ctx context.Context, kind uint32) ([]byte, error) {
	done, err := s.enter(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	if err = s.abi.current(s.h); err != nil {
		return nil, err
	}
	raw, err := s.abi.read(s.h, kind)
	owned := bytes.Clone(raw)
	if err != nil {
		return nil, err
	}
	if err = s.abi.current(s.h); err != nil {
		return nil, err
	}
	if err = s.post(ctx); err != nil {
		return nil, err
	}
	return owned, nil
}
func (s *Source) ReadOriginalManifest(ctx context.Context) ([]byte, error) { return s.read(ctx, 1) }
func (s *Source) ReadOriginalConsent(ctx context.Context) ([]byte, error)  { return s.read(ctx, 2) }
func (s *Source) ReadOriginalInput(ctx context.Context) ([]byte, error)    { return s.read(ctx, 3) }
func (s *Source) verify(ctx context.Context, direction uint32, text string, payload, signature []byte) error {
	done, err := s.enter(ctx)
	if err != nil {
		return err
	}
	defer done()
	if err = s.abi.current(s.h); err != nil {
		return err
	}
	kind, key := uint32(4), "canonicalIssuer"
	if direction == 2 {
		kind, key = 5, "principal"
	}
	raw, err := s.abi.read(s.h, kind)
	if err != nil {
		return err
	}
	var mapping map[string]json.RawMessage
	if err = json.Unmarshal(raw, &mapping); err != nil {
		return fmt.Errorf("NETWORK_RESOURCE_PROTECTED_MAPPING: %w", err)
	}
	var original string
	if err = json.Unmarshal(mapping[key], &original); err != nil || text != original {
		return errors.New("NETWORK_RESOURCE_MAPPING_TEXT_MISMATCH")
	}
	expected, err := s.abi.read(s.h, direction)
	if err != nil {
		return err
	}
	if !bytes.Equal(payload, expected) {
		return errors.New("NETWORK_RESOURCE_ORIGINAL_PAYLOAD_MISMATCH")
	}
	if err = s.abi.verify(s.h, direction, bytes.Clone(payload), bytes.Clone(signature)); err != nil {
		return err
	}
	if err = s.abi.current(s.h); err != nil {
		return err
	}
	return s.post(ctx)
}

// Same P09 Authorizer signature, but exact canonical originals, not legacy
// SANDBOX wrappers. These verify credentials only; they do not claim/dispatch.
func (s *Source) VerifyManifest(ctx context.Context, issuer string, payload, signature []byte) error {
	return s.verify(ctx, 1, issuer, payload, signature)
}
func (s *Source) VerifyConsent(ctx context.Context, principal string, payload, signature []byte) error {
	return s.verify(ctx, 2, principal, payload, signature)
}

// No check-only callback pretending to settle P09's original Store transaction.
// Native physical OnceClaim and original Runner nonce/UNKNOWN fence must be
// composed before an execution API can exist; no public effect callback here.
func (s *Source) ClaimOriginalExecution(context.Context) error { return ErrClaimNotSupplied }
func (s *Source) Retire() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if s.retired {
		s.mu.Unlock()
		return nil
	}
	s.retired = true
	s.mu.Unlock()
	err := s.abi.retire(s.h)
	s.mu.Lock()
	if s.first == nil {
		s.first = err
	}
	s.mu.Unlock()
	return err
}

// FirstCause preserves an acquisition/retirement/drain cause independently of
// physical completion. A successful later drain never makes UNKNOWN success.
func (s *Source) FirstCause() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.first
}
func (s *Source) Join(ctx context.Context) (bool, error) {
	if s == nil {
		return true, nil
	}
	s.mu.Lock()
	if !s.retired {
		s.mu.Unlock()
		return false, errors.New("NETWORK_RESOURCE_RETIRE_REQUIRED")
	}
	if s.joinSelected {
		select {
		case <-s.joinDone:
			if !s.joinResult.complete {
				s.joinSelected = false
			}
		default:
		}
	}
	if !s.joinSelected {
		s.joinSelected = true
		s.joinDone = make(chan struct{})
		go func() {
			s.active.Wait()
			result := s.abi.join(s.h)
			s.mu.Lock()
			s.joinResult = result
			if s.first == nil {
				s.first = result.err
			}
			s.joined = result.complete
			close(s.joinDone)
			s.mu.Unlock()
		}()
	}
	wait := s.joinDone
	s.mu.Unlock()
	select {
	case <-wait:
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.joinResult.complete, s.joinResult.err
	case <-ctx.Done():
		return false, ctx.Err()
	}
}
func (s *Source) Close(ctx context.Context) (bool, error) {
	if s == nil {
		return true, nil
	}
	s.mu.Lock()
	if !s.joined {
		s.mu.Unlock()
		return false, errors.New("NETWORK_RESOURCE_NATIVE_JOIN_PENDING")
	}
	if s.closeSelected {
		select {
		case <-s.closeDone:
			if !s.closeResult.complete {
				s.closeSelected = false
			}
		default:
		}
	}
	if !s.closeSelected {
		s.closeSelected = true
		s.closeDone = make(chan struct{})
		go func() {
			r := s.abi.close(s.h)
			s.mu.Lock()
			s.closeResult = r
			if s.first == nil {
				s.first = r.err
			}
			s.closed = r.complete
			close(s.closeDone)
			s.mu.Unlock()
		}()
	}
	wait := s.closeDone
	s.mu.Unlock()
	select {
	case <-wait:
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.closeResult.complete, s.closeResult.err
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

// Caller MUST retain nonnil Source when Join/Close says false, including error.
// There is no finalizer, auto reopen, second Source or UNKNOWN dispatch retry.
