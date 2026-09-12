package api

import (
	"errors"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"sync"
	"testing"
)

func TestFaucetQueueBackpressureAndConcurrentFunding(t *testing.T) {
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := newServerWithConfig(d, ServerConfig{})
	s.faucetBatchRunning = true
	s.faucetBatchQueue = make([]*faucetBatchJob, faucetQueueCapacity)
	input := chain.FaucetRequestInput{Address: "0x1111111111111111111111111111111111111111", Amount: 100, RequestID: fmt.Sprintf("batch_%032d", 99)}
	if _, _, err = s.submitFaucetRequest(input); !errors.Is(err, errFaucetQueueFull) {
		t.Fatal("unbounded queue admission")
	}
	if _, found := d.Account(input.Address); found {
		t.Fatal("backpressure changed ledger")
	}
	s.faucetBatchRunning = false
	s.faucetBatchQueue = nil
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make(chan error, 50)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, _, err := s.submitFaucetRequest(chain.FaucetRequestInput{Address: fmt.Sprintf("0x%040x", i+200), Amount: 100, RequestID: fmt.Sprintf("batch_%032d", i)})
			results <- err
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 50; i++ {
		a, found := d.Account(fmt.Sprintf("0x%040x", i+200))
		if !found || a.Balance != 100 {
			t.Fatal("concurrent request missing or duplicated")
		}
	}
}
