//go:build !commerce_v2

package main

import (
	"context"
	"errors"
)

func prepareOriginalShopRuntime(ctx context.Context, f originalShopFiles) (originalShopRuntime, error) {
	if ctx == nil {
		return nil, errors.New("SHOP_PROTECTED_RUNTIME_UNAVAILABLE")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !f.empty() {
		return nil, errors.New("SHOP_PROTECTED_RUNTIME_UNAVAILABLE")
	}
	return closedOriginalShopRuntime{}, nil
}
