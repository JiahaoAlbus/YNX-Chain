//go:build darwin || linux

package commerce

import (
	"context"
	"errors"
	"testing"

	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

func TestShopTaskOrderConsumerNormalFactoriesRetainAndDrainPartial(t *testing.T) {
	s, _, _, _ := invoiceRecoveryFixture(t)
	c, err := OpenOriginalShopTaskOrderConsumer(context.Background(), s, "/Volumes/西部数据/YNX-large-work/.p07-caller")
	if c == nil || err == nil || !errors.Is(err, native.ErrUnavailable) || c.endpoint != nil {
		t.Fatal("normal factory admitted missing Root registration", err)
	}
	if err := c.Close(); err != nil {
		t.Fatal("partial real original owners did not close", err)
	}
	if err := c.Close(); err != nil {
		t.Fatal("partial close not idempotent", err)
	}
}
