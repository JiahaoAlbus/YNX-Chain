package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

// Only the QA builder supplies this pin. Neither HTTP, native requests, task
// packets nor runtime flags can choose the native producer executable.
var nativeConsentSHA256 string
var nativeConsentInfoSHA256 string

// Identity is checked for every explicit effect request, under the original
// producer's three-second bound. A cold system-library load must not disable
// consent for the rest of a helper session or delay its read-only startup.
type nativeConsentSession struct {
	mu       sync.Mutex
	producer interface {
		ReadIdentity(context.Context) (nativeconsent.Identity, error)
		Confirm(context.Context, ownednode.Intent, string) error
		Close() error
	}
	closed bool
	done   chan struct{}
	cancel context.CancelFunc
}

func (s *nativeConsentSession) Confirm(ctx context.Context, intent ownednode.Intent, mode string) error {
	if ctx == nil {
		return nativeconsent.ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nativeconsent.ErrUnavailable
	}
	if s.done != nil {
		s.mu.Unlock()
		return nativeconsent.ErrBusy
	}
	call, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	s.done, s.cancel = done, cancel
	s.mu.Unlock()
	defer func() {
		cancel()
		s.mu.Lock()
		s.done, s.cancel = nil, nil
		close(done)
		s.mu.Unlock()
	}()
	if _, err := s.producer.ReadIdentity(call); err != nil {
		return err
	}
	if err := call.Err(); err != nil {
		return err
	}
	if err := s.producer.Confirm(call, intent, mode); err != nil {
		return err
	}
	return call.Err()
}

func (s *nativeConsentSession) Close() error {
	s.mu.Lock()
	s.closed = true
	done, cancel := s.done, s.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
	return s.producer.Close()
}

func openNativeConsent(locale, theme string) (*nativeConsentSession, error) {
	if nativeConsentSHA256 == "" {
		return nil, nil
	}
	if runtime.GOOS != "darwin" {
		return nil, nativeconsent.ErrUnavailable
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return nil, err
	}
	producer, err := nativeconsent.NewBundled(filepath.Join(filepath.Dir(exe), nativeconsent.BundleName, "Contents", "MacOS", "ynx-network-native-consent"), nativeConsentSHA256, nativeConsentInfoSHA256, locale, theme)
	if err != nil {
		return nil, err
	}
	return &nativeConsentSession{producer: producer}, nil
}
