package productreadsource

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"os"
	"path/filepath"
	"runtime"
)

// Independent reviewed client-side transport registration. The original
// service resource's PeerUID/PID authorizes its CALLER, not the remote server.
// These two records must never be interchanged, even when PUBLIC tests happen
// to run both ends under one PID. No public constructor/row/config setter.
type originalShopClientTransportRelease struct {
	sourceRootDigest, sourceProfileDigest, protectedResourceRef string
	transportOriginal                                           originalPin
	// Independently reviewed SERVER process registration, not the service
	// resource's allowed CALLER or an observed/TOFU process.
	expectedServer securelink.LocalCallerExpectedProcess
}

var originalShopClientTransportReleases = []originalShopClientTransportRelease{}

// The qualified original LINK owned exchange consumes these independent Root
// expectations on its SAME actual socket. The ordinary Call is not used here.

func (c *ShopPrivateClient) captureOriginalClientTransport(ctx context.Context) error {
	if c == nil || c.source == nil || ctx == nil {
		return ErrDenied
	}
	a := c.source
	var selected *originalShopClientTransportRelease
	for i := range originalShopClientTransportReleases {
		r := &originalShopClientTransportReleases[i]
		if r.sourceRootDigest == a.release.root.SHA256 && r.sourceProfileDigest == a.release.profile.SHA256 && r.protectedResourceRef == c.capture.Scope.ProtectedResourceRef {
			if selected != nil {
				return ErrDenied
			}
			selected = r
		}
	}
	if selected == nil {
		return ErrNotSupplied
	}
	// Same held Source/current and original FD set; this reads only the literal
	// Root-selected public record, never a path/ref derived from received JSON.
	if err := a.Current(ctx); err != nil {
		return err
	}
	a.mu.Lock()
	raw, err := a.load(selected.transportOriginal)
	a.mu.Unlock()
	if err != nil {
		return err
	}
	var record resourceOriginal
	if decode(raw, &record) != nil {
		return ErrDenied
	}
	if err = c.validateOriginalClientTransport(record); err != nil {
		return err
	}
	if err = a.Current(ctx); err != nil {
		return err
	}
	if err = c.captureIndependentServerExpected(selected.expectedServer); err != nil {
		return err
	}
	return a.Current(ctx)
}

func (c *ShopPrivateClient) captureIndependentServerExpected(p securelink.LocalCallerExpectedProcess) error {
	if p.UID == 0 || p.PID <= 0 || p.PID > 1<<31-1 || p.UID != c.transport.PeerUID || p.PID != c.transport.PeerPID || p.StartA == 0 || p.ImageBytes == 0 || p.ImageBytes > 128<<20 || p.ImageSHA256 == ([32]byte{}) || !filepath.IsAbs(p.ImagePath) || filepath.Clean(p.ImagePath) != p.ImagePath || len(p.ImagePath) > 4096 {
		return ErrDenied
	}
	if runtime.GOOS == "darwin" {
		if p.StartKind != securelink.LocalCallerDarwinProcessStart || p.StartB >= 1000000 {
			return ErrDenied
		}
	} else if runtime.GOOS == "linux" {
		if p.StartKind != securelink.LocalCallerLinuxProcessStart || p.StartB != 0 {
			return ErrDenied
		}
	} else {
		return ErrNotSupplied
	}
	c.expectedPeer = p
	return nil
}
func (c *ShopPrivateClient) validateOriginalClientTransport(record resourceOriginal) error {
	s, p := c.capture.Scope, c.capture.Profile
	// Actual allowed caller is this runtime, independently of target server PID.
	if p.PeerUID != uint32(os.Geteuid()) || p.PeerPID != os.Getpid() || validateResource(record, s) != nil || record.PeerUID == 0 || record.PeerPID <= 0 || record.Socket != p.Socket || record.Service != p.Service || record.Realm != p.Realm || record.Tenant != p.Tenant || record.Epoch != p.Epoch || len(record.Orders) != len(p.Orders) || len(record.Bindings) != len(c.capture.Selections) {
		return ErrDenied
	}
	for i, o := range record.Orders {
		if o != p.Orders[i] {
			return ErrDenied
		}
	}
	for i, b := range record.Bindings {
		r := c.capture.Selections[i]
		if b.ProductID != r.ProductID || b.SourceOrder != r.SourceOrder || b.Actor != r.Actor || b.Role != r.Role || b.StoreID != r.StoreID {
			return ErrDenied
		}
	}
	c.transport = record
	return nil
}
