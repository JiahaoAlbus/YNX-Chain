//go:build darwin || linux

package commerce

import (
	"context"
	"errors"
	"sync"

	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	authgrant "ynx.local/authgrantpolicy"
)

// OpenOriginalShopTaskOrders uses the sole original zero-input Source factory.
// Registered target/kind and the SDK/response operands are deployment inputs,
// never request data. No environment enrollment or alternate Source is tried.
// The original caller must Close the returned prepared runtime after serving.
func OpenOriginalShopTaskOrders(ctx context.Context, codec OriginalShopTaskOrderCodec, responses OriginalShopTaskOrderResponseAuthority, target authgrant.Sink, orderKind string) (prepared *PreparedOriginalShopTaskOrders, err error) {
	if ctx == nil {
		return nil, ErrUnavailable
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	owner, err := native.OpenOriginalGrantRuntime()
	// Adopt partial ownership before inspecting the factory error. Retirement
	// invalidates current checks; Close releases the original held files. The
	// serving owner must drain requests before closing a successful composition.
	var once sync.Once
	var closeErr error
	closeOwner := func() error {
		once.Do(func() {
			if owner != nil {
				closeErr = errors.Join(owner.Retire(), owner.Close())
			}
		})
		return closeErr
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, closeOwner())
			prepared = nil
		}
	}()
	if err != nil {
		return nil, err
	}
	if owner == nil {
		return nil, ErrUnavailable
	}
	profile, err := owner.TaskAuthorityProfile(ctx)
	if err != nil {
		return nil, err
	}
	if target.Tenant != profile.Tenant {
		return nil, ErrUnauthorized
	}
	prepared, err = PrepareOriginalShopTaskOrders(owner, codec, responses, ShopOrderReadToolDescriptor(), target, orderKind, owner.Current)
	if err != nil {
		return nil, err
	}
	if err = owner.Current(ctx); err != nil {
		return nil, err
	}
	prepared.close = closeOwner
	return prepared, nil
}
