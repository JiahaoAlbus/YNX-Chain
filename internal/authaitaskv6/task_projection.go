package aitaskactionsource

import (
	"context"
	sdk "github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/taskactionv6"
	"sync/atomic"
)

// Build inputs belong to the normal process startup owner. This wrapper never
// accepts request-provided executables/paths/pins and never serializes E5 itself.
// It remains DATA: successful projection is not Source, session or ToolGrant.
type OriginalTaskV6DATAProjector struct {
	original *sdk.Bridge
	retired  atomic.Bool
}

func OpenOriginalTaskV6DATAProjector(inputs sdk.BuildInputs) (*OriginalTaskV6DATAProjector, error) {
	p := &OriginalTaskV6DATAProjector{}
	var err error
	p.original, err = sdk.OpenInstalledCLI(inputs)
	return p, err
}
func (p *OriginalTaskV6DATAProjector) ProjectOriginalRequestDATA(ctx context.Context, network, header string, actualBody []byte) (sdk.Projection, error) {
	if ctx == nil || p == nil || p.retired.Load() || p.original == nil {
		return sdk.Projection{}, ErrTaskStateUnavailable
	}
	if err := ctx.Err(); err != nil {
		return sdk.Projection{}, err
	}
	out, err := p.original.Project(ctx, sdk.Request{NetworkID: network, ProofHeader: header, BodyOriginal: append([]byte(nil), actualBody...)})
	if err != nil {
		return sdk.Projection{}, err
	}
	if p.retired.Load() {
		return sdk.Projection{}, ErrTaskStateUnavailable
	}
	return out, nil
}
func (p *OriginalTaskV6DATAProjector) Close() error {
	if p != nil {
		p.retired.Store(true)
	}
	return nil
}
