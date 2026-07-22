package main

import (
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantworker"
)

func main() {
	state := env("YNX_QUANT_STATE_PATH", ".ynx/quant-worker/state.json")
	service, err := quantlab.New(quantlab.Config{StatePath: state})
	if err != nil {
		slog.Error("worker state unavailable", "error", err)
		os.Exit(1)
	}
	worker := quantworker.Worker{Inbox: env("YNX_QUANT_JOB_INBOX", ".ynx/quant-worker/inbox"), Outbox: env("YNX_QUANT_JOB_OUTBOX", ".ynx/quant-worker/outbox"), Service: service}
	if err := os.MkdirAll(worker.Inbox, 0700); err != nil {
		slog.Error("worker inbox unavailable", "error", err)
		os.Exit(1)
	}
	for {
		result, err := worker.RunOne()
		if err == nil {
			slog.Info("quant job completed", "jobId", result.JobID, "experimentId", result.Experiment.ID)
			continue
		}
		if !errors.Is(err, quantworker.ErrNoJob) {
			slog.Error("quant job rejected", "error", err)
		}
		time.Sleep(time.Second)
	}
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
