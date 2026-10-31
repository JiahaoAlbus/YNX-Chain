package normalconsumer

import (
	"context"
	"errors"
	"testing"
	authgrant "ynx.local/authgrantpolicy"
)

type nilVerifier struct{}

func (*nilVerifier) OpenTaskGrantSource(context.Context, authgrant.TaskEffectBinding, authgrant.Proof, authgrant.Proof) (authgrant.HeldTaskGrantSource, error) {
	panic("nil verifier must never be invoked")
}
func TestNormalDefaultImportRefusesMissingProtectedVerifier(t *testing.T) {
	var typedNil *nilVerifier
	for _, v := range []authgrant.OriginalTaskGrantVerifier{nil, typedNil} {
		held, err := authgrant.OpenTaskGrantAtEffect(context.Background(), v, authgrant.TaskEffectBinding{}, authgrant.Proof{}, authgrant.Proof{})
		if held != nil {
			defer held.Close()
			t.Fatal("missing verifier yielded a held grant")
		}
		var p *authgrant.PolicyError
		if !errors.As(err, &p) || p.Code != authgrant.Unavailable {
			t.Fatalf("missing protected verifier must remain UNAVAILABLE, got %v", err)
		}
	}
}
