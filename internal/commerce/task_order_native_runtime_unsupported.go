//go:build !darwin && !linux

package commerce

import (
	"context"

	authgrant "ynx.local/authgrantpolicy"
)

func OpenOriginalShopTaskOrders(context.Context, OriginalShopTaskOrderCodec, OriginalShopTaskOrderResponseAuthority, authgrant.Sink, string) (*PreparedOriginalShopTaskOrders, error) {
	return nil, ErrUnavailable
}
