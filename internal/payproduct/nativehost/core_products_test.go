//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"context"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestCoreAttachmentFailedConstructionRetainsCleanupAndCause(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	for _, ctx := range []context.Context{nil, canceled, context.Background()} {
		host, cause := OpenBFTPrivateProducts(ctx, nil, nil, BFTPrivateProductsConfig{}, buildinfo.Info{}, nil)
		if host == nil || cause == nil || host.CoreReleased() || host.Err() != cause {
			t.Fatal("failed original attachment lost partial or first cause", cause)
		}
		if err := host.Shutdown(context.Background()); err != cause || !host.CoreReleased() {
			t.Fatal("partial cleanup confused retained failure with borrowed debt", err)
		}
		if err := host.Shutdown(context.Background()); err != cause || !host.CoreReleased() {
			t.Fatal("cleanup replay erased original failure", err)
		}
	}
}
