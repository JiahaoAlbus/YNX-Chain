//go:build ynx_canonical_media && ynx_media_combined_authority

package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mediacomposition"
	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
)

// Nil until a real original protected launcher supplies attested readers,
// source custody and current enrolled actor. ENV does not populate this slot.
var originalMusicInputs *mediacomposition.MusicInputs

// The original protected launcher supplies these real sources. Configuration
// alone is insufficient; missing observer/current/registration stays closed.
type originalMusicProtectedBootstrap struct {
	Configuration productsessionv2.MediaProtectedConfiguration
	Transport     http.RoundTripper
	Registration  productsessionv2.OriginalMediaRegistration
	Current       productsessionv2.OriginalSourceCurrent
	Observer      mediacomposition.OriginalMediaActorObserver
}

var originalMusicBootstrap *originalMusicProtectedBootstrap

func prepareOriginalBusiness() (music.MusicBusinessAuthority, func() error, error) {
	if originalMusicBootstrap != nil {
		bootstrap := *originalMusicBootstrap
		originalMusicInputs = nil
		_, inputs, err := mediacomposition.LoadOriginalProtectedMediaInputs(context.Background(), bootstrap.Configuration, bootstrap.Transport, bootstrap.Registration, bootstrap.Current, bootstrap.Observer)
		if err != nil {
			return nil, nil, err
		}
		originalMusicInputs = inputs
	}
	prepared, err := mediacomposition.PrepareOriginalMusic(context.Background(), originalMusicInputs)
	if err != nil {
		return nil, nil, err
	}
	if prepared == nil {
		return nil, nil, nil
	}
	return prepared.Authority(), prepared.AssertCurrent, nil
}
