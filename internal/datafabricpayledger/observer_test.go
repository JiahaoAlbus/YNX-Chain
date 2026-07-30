package datafabricpayledger

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	chainapi "github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestHTTPChainObserverIndependentlyVerifiesCommittedRefundTransfer(t *testing.T) {
	merchant := "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	payer := "0xcccccccccccccccccccccccccccccccccccccccc"
	merchantNative, _ := accountaddress.Encode(merchant)
	payerNative, _ := accountaddress.Encode(payer)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(merchant, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	transaction, err := devnet.Transfer(merchant, payer, 5)
	if err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	commit, release := strings.Repeat("d", 40), "chain-observer-test"
	devnet.SetNodeIdentityConfig(chain.NodeIdentityConfig{Build: chain.BuildInfo{Commit: commit, Release: release, BuildTime: "2026-07-27T08:00:00Z"}})
	server := httptest.NewServer(chainapi.NewServer(devnet))
	defer server.Close()
	observer, err := NewHTTPChainObserver(HTTPChainObserverConfig{
		Origin: server.URL, SourceCommit: commit, SourceRelease: release, ChainID: 6423,
	})
	if err != nil {
		t.Fatal(err)
	}
	authority := TransferAuthority{
		From: merchantNative, To: payerNative, TransactionHash: transaction.Hash,
		AmountMinor: 5, Currency: "YNXT", EffectiveAt: time.Now().UTC().Add(time.Second),
	}
	observation, err := observer.ObserveTransfer(context.Background(), authority)
	if err != nil {
		t.Fatal(err)
	}
	if observation.Source != "chain" || observation.ReferenceID != transaction.Hash || observation.AmountMinor != 5 || observation.Metadata.Status != "authoritative" || len(observation.EvidenceHash) != 64 {
		t.Fatalf("independent chain observation is incomplete: %+v", observation)
	}
	authority.AmountMinor = 4
	if _, err := observer.ObserveTransfer(context.Background(), authority); err == nil || !strings.Contains(err.Error(), "contradicts") {
		t.Fatalf("mismatched chain transaction was accepted: %v", err)
	}
}
