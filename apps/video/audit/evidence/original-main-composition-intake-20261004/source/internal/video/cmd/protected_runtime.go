//go:build ynx_canonical_media && ynx_media_combined_authority

package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mediacomposition"
	"github.com/JiahaoAlbus/YNX-Chain/internal/video"
)

// Nil until a real original protected launcher supplies attested readers,
// source custody and current enrolled actor. ENV does not populate this slot.
var originalVideoInputs *mediacomposition.VideoInputs

func prepareOriginalBusiness() (video.VideoBusinessAuthority, func() error, error) {
	prepared, err := mediacomposition.PrepareOriginalVideo(context.Background(), originalVideoInputs)
	if err != nil {
		return nil, nil, err
	}
	if prepared == nil {
		return nil, nil, nil
	}
	return prepared.Authority(), prepared.AssertCurrent, nil
}
