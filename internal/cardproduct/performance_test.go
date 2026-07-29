package cardproduct

import (
	"bytes"
	"context"
	"testing"
	"time"
)

func benchmarkService(b *testing.B) *Service {
	b.Helper()
	now := time.Date(2026, 7, 29, 8, 0, 0, 0, time.UTC)
	service, err := New(Config{
		StorePath:        b.TempDir() + "/card-state.json",
		IntegrityKey:     bytes.Repeat([]byte{0x17}, 32),
		GatewayKey:       bytes.Repeat([]byte{0x32}, 32),
		ProviderEventKey: bytes.Repeat([]byte{0x61}, 32),
		Provider:         NewSandboxProvider(func() time.Time { return now }),
		AI:               fixedAI{},
		Now:              func() time.Time { return now },
	})
	if err != nil {
		b.Fatal(err)
	}
	if _, err := service.Apply(context.Background(), testAccount, ApplyInput{
		EligibilityReference: "kyc_sandbox_verified_01",
		LegalConsentVersion:  "card-testnet-v1",
		IdempotencyKey:       "benchmark-application-01",
	}); err != nil {
		b.Fatal(err)
	}
	state, err := service.State(testAccount)
	if err != nil || len(state.Cards) != 1 {
		b.Fatalf("benchmark sandbox card setup failed: cards=%d err=%v", len(state.Cards), err)
	}
	if _, err := service.Transition(context.Background(), testAccount, state.Cards[0].ID, "activate", "benchmark-activate-01"); err != nil {
		b.Fatal(err)
	}
	return service
}

func BenchmarkCardStateRead(b *testing.B) {
	service := benchmarkService(b)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := service.State(testAccount); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkAccountExport(b *testing.B) {
	service := benchmarkService(b)
	ctx := context.Background()
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := service.ExportAccount(ctx, testAccount); err != nil {
			b.Fatal(err)
		}
	}
}
