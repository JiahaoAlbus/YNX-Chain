package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestNativeTransferMetadataNormalRESTAndRequestBoundary(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	h := NewServer(d)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/node/native-transfer-metadata", nil))
	var got struct {
		Metadata            chain.NativeTransferMetadata
		Source              string
		IndependentFinality bool
	}
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || w.Header().Get("Cache-Control") != "no-store" || got.Source != "native-ledger-config-and-genesis" || got.IndependentFinality {
		t.Fatal("metadata normal path or truth flags", w.Code, w.Body.String())
	}
	expected, err := d.NativeTransferMetadata()
	if err != nil || got.Metadata != expected {
		t.Fatal("REST differs from original ledger", got, err)
	}
	for _, target := range []string{"/node/native-transfer-metadata?genesis=other", "/node/native-transfer-metadata?unitVersion=2"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
		if w.Code != http.StatusBadRequest {
			t.Fatal("caller-selected metadata admitted", target, w.Code)
		}
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/node/native-transfer-metadata", strings.NewReader("{}")))
	if w.Code != http.StatusBadRequest {
		t.Fatal("body-selected metadata admitted", w.Code)
	}
}
