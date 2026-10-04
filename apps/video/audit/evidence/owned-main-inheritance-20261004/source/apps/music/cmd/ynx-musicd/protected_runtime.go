//go:build ynx_canonical_media && ynx_media_combined_authority

package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mediacomposition"
	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
)

// Nil until a real original protected launcher supplies attested readers,
// source custody and current enrolled actor. ENV does not populate this slot.
var originalMusicInputs *mediacomposition.MusicInputs

func prepareOriginalBusiness() (music.MusicBusinessAuthority, func() error, error) {
	prepared, err := mediacomposition.PrepareOriginalMusic(context.Background(), originalMusicInputs)
	if err != nil {
		return nil, nil, err
	}
	if prepared == nil {
		return nil, nil, nil
	}
	return prepared.Authority(), prepared.AssertCurrent, nil
}
