package securelink_test

import (
	"context"
	"errors"
	"testing"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func TestProtectedMaterialRejectsFabricatedResponseAndHandle(t *testing.T) {
	response := link.WireResponse{Body: []byte(`{"ok":true}`), ContentType: "application/json", StatusCode: 200,
		Channel: link.AuthenticatedChannel{Exporter: make([]byte, 32)}}
	if _, err := link.ProtectedExchangeFromResponse(context.Background(), response); !errors.Is(err, link.ErrDenied) {
		t.Fatal("ordinary response/diagnostic channel obtained private material", err)
	}
	for _, material := range []*link.ProtectedExchange{nil, {}} {
		if _, err := material.Current(context.Background()); !errors.Is(err, link.ErrDenied) {
			t.Fatal("zero/caller-created handle became an exchange", err)
		}
	}
	cause := errors.New("original first cause")
	err := &link.DispatchError{Cause: cause, DispatchPossible: true, PartialResponseBytes: 7}
	if !errors.Is(err, cause) || err.Error() != cause.Error() {
		t.Fatal("dispatch uncertainty discarded original error")
	}
}
