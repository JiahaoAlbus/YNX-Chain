//go:build ynx_canonical_media && ynx_media_combined_authority

package main

import (
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mediacomposition"
	"testing"
)

func TestOriginalMusicBootstrapRefusesBeforeStateAndDoesNotKeepOldInputs(t *testing.T) {
	oldBootstrap, oldInputs := originalMusicBootstrap, originalMusicInputs
	t.Cleanup(func() { originalMusicBootstrap, originalMusicInputs = oldBootstrap, oldInputs })
	originalMusicBootstrap = &originalMusicProtectedBootstrap{}
	originalMusicInputs = &mediacomposition.MusicInputs{}
	authority, current, err := prepareOriginalBusiness()
	if !errors.Is(err, mediacomposition.ErrOriginalMediaRuntimeUnavailable) || authority != nil || current != nil || originalMusicInputs != nil {
		t.Fatal("missing trusted observer must refuse before protected IO and state construction")
	}
}
