//go:build ynx_canonical_media && ynx_media_combined_authority

package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mediacomposition"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/video"
	"net/http"
)

// Nil until a real original protected launcher supplies attested readers,
// source custody and current enrolled actor. ENV does not populate this slot.
var originalVideoInputs *mediacomposition.VideoInputs

// Supplied by the original protected launcher, never reconstructed from ENV
// or an HTTP actor. Nil retains the original public-only startup.
type originalVideoProtectedBootstrap struct {
	Configuration productsessionv2.MediaProtectedConfiguration
	Transport     http.RoundTripper
	Registration  productsessionv2.OriginalMediaRegistration
	Current       productsessionv2.OriginalSourceCurrent
	Observer      mediacomposition.OriginalMediaActorObserver
}

var originalVideoBootstrap *originalVideoProtectedBootstrap
var originalVideoPrepared *mediacomposition.PreparedVideo

func prepareOriginalBusiness() (video.VideoBusinessAuthority, func() error, error) {
	originalVideoPrepared = nil
	if originalVideoBootstrap != nil {
		bootstrap := *originalVideoBootstrap
		originalVideoInputs = nil
		inputs, _, err := mediacomposition.LoadOriginalProtectedMediaInputs(context.Background(), bootstrap.Configuration, bootstrap.Transport, bootstrap.Registration, bootstrap.Current, bootstrap.Observer)
		if err != nil {
			return nil, nil, err
		}
		originalVideoInputs = inputs
	}
	prepared, err := mediacomposition.PrepareOriginalVideo(context.Background(), originalVideoInputs)
	if err != nil {
		return nil, nil, err
	}
	if prepared == nil {
		return nil, nil, nil
	}
	originalVideoPrepared = prepared
	return prepared.Authority(), prepared.AssertCurrent, nil
}

func wrapOriginalBusiness(next http.Handler) http.Handler {
	return originalVideoPrepared.WrapOriginalVideoHandler(next)
}
