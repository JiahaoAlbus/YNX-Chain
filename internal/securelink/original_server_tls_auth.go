//go:build securelink_openssl && cgo && securelink_reviewed_server_tls && (darwin || linux)

package securelink

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/authservertls"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

// This is the ONE normal zero-input issuer entry. The concrete Auth leaf owns
// reviewed selection/Root resources; no config, path, URL, key or provider is
// accepted. The explicit tag requires the matching original Auth source supply.
// It does not qualify that supply or any V4 Principal/Root business permission.
func OpenOriginalServerTLS(ctx context.Context) (*OriginalServerTLS, error) {
	lease, e := authservertls.OpenOriginalServerTLSLease(ctx)
	var adapter *originalAuthServerTLSCredential
	if lease != nil {
		adapter = &originalAuthServerTLSCredential{lease: lease}
	}
	var listener net.Listener
	var actual *native.Context
	fail := func(cause error) (*OriginalServerTLS, error) {
		var base *HTTPServer
		if actual != nil {
			base = &HTTPServer{tls: actual}
		}
		out, err := newOriginalServerTLS(ctx, base, listener, adapter, cause)
		var unknown *native.ServerContextFDCleanupError
		if errors.As(cause, &unknown) {
			out.state.mu.Lock()
			out.state.cleanupUnknown = true
			out.state.notifyLocked()
			out.state.mu.Unlock()
		}
		return out, err
	}
	if e != nil {
		return fail(e)
	}
	if lease == nil {
		return fail(ErrUnavailable)
	}
	adapter.borrow, e = lease.BorrowOriginal(ctx)
	if e != nil {
		return fail(e)
	}
	if adapter.borrow == nil {
		return fail(ErrUnavailable)
	}
	originals, e := adapter.borrow.OriginalCredentials(ctx)
	if e != nil {
		return fail(e)
	}
	listener, e = adapter.borrow.OriginalListener(ctx)
	if e != nil {
		return fail(e)
	}
	if listener == nil {
		return fail(ErrUnavailable)
	}
	actual, e = native.NewServerContextFromFDs(originals.CertificateFD, originals.PrivateKeyFD, originals.CAFD, originals.PeerSAN, originals.CertificateSHA256)
	if e != nil {
		return fail(e)
	}
	return newOriginalServerTLS(ctx, &HTTPServer{tls: actual}, listener, adapter, nil)
}

// No public interface setter or arbitrary vtable is involved. Only the actual
// Auth concrete lease/borrow from the fixed factory above populate this adapter.
// OriginalServerTLS serializes cleanup; normal Current calls may be concurrent,
// as the Auth concrete body independently locks its SAME resources.
type originalAuthServerTLSCredential struct {
	lease                                     *authservertls.ReviewedServerTLSLease
	borrow                                    *authservertls.ServerTLSBorrow
	releaseSelected, released, releaseUnknown bool
	closeUnknown, closed                      bool
	firstCleanup                              error
}

func (a *originalAuthServerTLSCredential) originalServerTLSBorrowHeld() bool {
	return a != nil && a.borrow != nil && !a.released
}

func (a *originalAuthServerTLSCredential) currentOriginalServerTLSCredential(ctx context.Context) error {
	if a == nil || a.lease == nil || a.borrow == nil {
		return ErrUnavailable
	}
	if e := a.lease.Current(ctx); e != nil {
		return e
	}
	return a.borrow.Current(ctx)
}
func (a *originalAuthServerTLSCredential) originalServerTLSProfile(ctx context.Context) (originalServerTLSProfile, error) {
	if a == nil || a.borrow == nil {
		return originalServerTLSProfile{}, ErrUnavailable
	}
	o, e := a.borrow.OriginalCredentials(ctx)
	if e != nil {
		return originalServerTLSProfile{}, e
	}
	epoch, e := strconv.ParseUint(o.CredentialEpoch, 10, 64)
	if e != nil || epoch == 0 || strconv.FormatUint(epoch, 10) != o.CredentialEpoch {
		return originalServerTLSProfile{}, ErrDenied
	}
	return originalServerTLSProfile{sourceID: o.SourceID, instanceID: o.InstanceID, issuerRef: o.IssuerRef, credentialRef: o.CredentialRef, targetOrigin: o.TargetOrigin, serverName: o.ServerName, peerSAN: o.PeerSAN, listenNetwork: "tcp", listenAddress: o.ListenAddress, certificateSHA256: o.CertificateSHA256, spkiSHA256: o.SPKISHA256, credentialEpoch: epoch, credentialFrom: time.UnixMilli(o.NotBeforeMS), credentialUntil: time.UnixMilli(o.ExpiresMS)}, nil
}
func (a *originalAuthServerTLSCredential) retireOriginalServerTLSCredential() {
	if a != nil && a.lease != nil {
		a.lease.Retire()
	}
}
func (a *originalAuthServerTLSCredential) releaseOriginalServerTLSCredential(context.Context) (released, closed bool, err error) {
	if a == nil || a.lease == nil {
		return true, true, nil
	}
	if a.releaseUnknown || a.closeUnknown {
		return a.released, false, a.firstCleanup
	}
	if a.closed {
		return a.released, true, a.firstCleanup
	}
	if !a.releaseSelected {
		a.releaseSelected = true
		if a.borrow == nil {
			a.released = true
		} else {
			var e error
			a.released, e = a.borrow.Release()
			if !a.released {
				a.releaseUnknown = true
				if e == nil {
					e = authservertls.ErrUnknown
				}
				a.firstCleanup = e
				return false, false, e
			}
			if e != nil && a.firstCleanup == nil {
				a.firstCleanup = e
			}
		}
	}
	// Explicit bounded cleanup probe, never a detached business/Source context.
	// If another original borrow still exists, retain the parent and let a later
	// Close probe retry ONLY this known pending join/close phase, never Release.
	probe, cancel := context.WithCancel(context.Background())
	cancel()
	if e := a.lease.Join(probe); e != nil {
		return a.released, false, fmt.Errorf("%w: %w", errOriginalServerTLSPending, e)
	}
	done, e := a.lease.Close()
	if !done {
		if errors.Is(e, authservertls.ErrPending) {
			return a.released, false, fmt.Errorf("%w: %w", errOriginalServerTLSPending, e)
		}
		a.closeUnknown = true
		if e == nil {
			e = authservertls.ErrUnknown
		}
		if a.firstCleanup == nil {
			a.firstCleanup = e
		}
		return a.released, false, a.firstCleanup
	}
	a.closed = true
	if e != nil && a.firstCleanup == nil {
		a.firstCleanup = e
	}
	return a.released, true, a.firstCleanup
}
