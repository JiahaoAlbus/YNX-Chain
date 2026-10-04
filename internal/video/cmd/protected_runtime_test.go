//go:build ynx_canonical_media && ynx_media_combined_authority

package main

import (
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mediacomposition"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOriginalVideoBootstrapRefusesBeforeServiceAndDoesNotKeepOldInputs(t *testing.T) {
	oldBootstrap, oldInputs, oldPrepared := originalVideoBootstrap, originalVideoInputs, originalVideoPrepared
	t.Cleanup(func() {
		originalVideoBootstrap, originalVideoInputs, originalVideoPrepared = oldBootstrap, oldInputs, oldPrepared
	})
	originalVideoBootstrap = &originalVideoProtectedBootstrap{}
	originalVideoInputs = &mediacomposition.VideoInputs{}
	authority, current, err := prepareOriginalBusiness()
	if !errors.Is(err, mediacomposition.ErrOriginalMediaRuntimeUnavailable) || authority != nil || current != nil || originalVideoInputs != nil || originalVideoPrepared != nil {
		t.Fatal("missing trusted observer must refuse before protected IO and service construction")
	}
}

func TestOriginalVideoNilPreparedMountKeepsPublicRoutesAndClosesSSO(t *testing.T) {
	oldBootstrap, oldInputs, oldPrepared := originalVideoBootstrap, originalVideoInputs, originalVideoPrepared
	t.Cleanup(func() {
		originalVideoBootstrap, originalVideoInputs, originalVideoPrepared = oldBootstrap, oldInputs, oldPrepared
	})
	originalVideoBootstrap, originalVideoInputs, originalVideoPrepared = nil, nil, nil
	authority, current, err := prepareOriginalBusiness()
	if err != nil || authority != nil || current != nil {
		t.Fatal("original public-only preparation changed")
	}
	calls := 0
	handler := wrapOriginalBusiness(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(204) }))
	for _, path := range []string{"/sso/start", "/sso/callback", "/api/sso/account", "/api/sso/logout"} {
		request := httptest.NewRequest(http.MethodGet, "https://video.ynxweb4.com"+path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 503 || response.Header().Get("Cache-Control") != "no-store" || calls != 0 {
			t.Fatalf("unconfigured identity reached business route: %s (%d)", path, response.Code)
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "https://video.ynxweb4.com/v1/videos", nil))
	if response.Code != 204 || calls != 1 {
		t.Fatal("public catalog stopped routing to original handler")
	}
}
