package main

import (
	"context"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

// originalResourceCurrentConfig is private trusted host composition after the
// real Auth/LINK native owner captures its Root-selected reference and caller.
// It supplies no registration/fence/NAPI of its own. Normal absent selection is
// nil: never initialize a Runner or derive the expected owner from wire JSON.
func originalResourceCurrentConfig(ctx context.Context, runner *contribution.Runner, selected contribution.ResourceIdentity, caller localipc.ProcessIdentity) (*localipc.ResourceCurrentConfig, error) {
	if ctx == nil || runner == nil || selected.SourceID == "" || selected.InstanceID == "" || selected.ResourceKey == "" {
		return nil, contribution.ErrResourceCurrent
	}
	if err := localipc.CheckProcessIdentity(ctx, caller); err != nil {
		return nil, err
	}
	data, err := runner.ReadCurrentResourceDATA(ctx)
	if err != nil {
		return nil, err
	}
	if data.SourceID != selected.SourceID || data.InstanceID != selected.InstanceID || data.ResourceKey != selected.ResourceKey {
		return nil, contribution.ErrResourceCurrent
	}
	return &localipc.ResourceCurrentConfig{Runner: runner, SelectedResource: selected, ExpectedClient: caller}, nil
}
