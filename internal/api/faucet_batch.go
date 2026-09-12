package api

import (
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"time"
)

const faucetQueueCapacity = 128

var errFaucetQueueFull = errors.New("faucet durable checkpoint queue is full")

type faucetBatchJob struct {
	input chain.FaucetRequestInput
	done  chan chain.FaucetRequestResult
}

func (s *Server) submitFaucetRequest(input chain.FaucetRequestInput) (chain.Transaction, bool, error) {
	// Invalid requests never consume a queue slot or trigger a full-state write.
	if _, err := chain.FaucetRequestHash(s.networkConfig.ChainID, input.RequestID); err != nil {
		return chain.Transaction{}, false, err
	}
	if input.Amount <= 0 {
		return chain.Transaction{}, false, errors.New("amount must be positive")
	}
	job := &faucetBatchJob{input: input, done: make(chan chain.FaucetRequestResult, 1)}
	s.faucetBatchMu.Lock()
	if len(s.faucetBatchQueue) >= faucetQueueCapacity {
		s.faucetBatchMu.Unlock()
		return chain.Transaction{}, false, errFaucetQueueFull
	}
	s.faucetBatchQueue = append(s.faucetBatchQueue, job)
	if !s.faucetBatchRunning {
		s.faucetBatchRunning = true
		go s.runFaucetBatches()
	}
	s.faucetBatchMu.Unlock()
	// Keep the HTTP handler alive even if its client disconnects so graceful
	// server shutdown drains admitted work. No volatile queue acceptance is ACKed.
	result := <-job.done
	return result.Transaction, result.Replayed, result.Err
}
func (s *Server) runFaucetBatches() {
	time.Sleep(25 * time.Millisecond)
	for {
		s.faucetBatchMu.Lock()
		n := len(s.faucetBatchQueue)
		if n == 0 {
			s.faucetBatchRunning = false
			s.faucetBatchMu.Unlock()
			return
		}
		if n > chain.MaxFaucetBatchSize {
			n = chain.MaxFaucetBatchSize
		}
		jobs := append([]*faucetBatchJob(nil), s.faucetBatchQueue[:n]...)
		s.faucetBatchQueue = s.faucetBatchQueue[n:]
		s.faucetBatchMu.Unlock()
		inputs := make([]chain.FaucetRequestInput, n)
		for i, j := range jobs {
			inputs[i] = j.input
		}
		results := s.devnet.FaucetRequestsBatch(inputs)
		for i, j := range jobs {
			j.done <- results[i]
		}
	}
}
