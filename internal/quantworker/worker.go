package quantworker

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

type Job struct {
	Schema      int                      `json:"schema"`
	ID          string                   `json:"id"`
	PayloadHash string                   `json:"payloadHash"`
	Request     quantlab.BacktestRequest `json:"request"`
}

type Result struct {
	Schema     int                 `json:"schema"`
	JobID      string              `json:"jobId"`
	Status     string              `json:"status"`
	Source     string              `json:"source"`
	Version    string              `json:"version"`
	Experiment quantlab.Experiment `json:"experiment"`
}

type Worker struct {
	Inbox   string
	Outbox  string
	Service *quantlab.Service
}

var ErrNoJob = errors.New("no job")

func (w Worker) RunOne() (Result, error) {
	if w.Service == nil || strings.TrimSpace(w.Inbox) == "" || strings.TrimSpace(w.Outbox) == "" {
		return Result{}, quantlab.ErrInvalid
	}
	entries, err := os.ReadDir(w.Inbox)
	if err != nil {
		return Result{}, err
	}
	var selected string
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		selected = entry.Name()
		break
	}
	if selected == "" {
		return Result{}, ErrNoJob
	}
	inputPath := filepath.Join(w.Inbox, selected)
	data, err := os.ReadFile(inputPath)
	if err != nil {
		return Result{}, err
	}
	if len(data) > 16<<20 {
		return Result{}, quantlab.ErrInvalid
	}
	var job Job
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&job); err != nil || decoder.Decode(&struct{}{}) != io.EOF || job.Schema != 1 || !validID(job.ID) {
		return Result{}, quantlab.ErrInvalid
	}
	canonical, _ := json.Marshal(job.Request)
	digest := sha256.Sum256(canonical)
	if !strings.EqualFold(job.PayloadHash, hex.EncodeToString(digest[:])) {
		return Result{}, quantlab.ErrForbidden
	}
	experiment, err := w.Service.RunBacktest(job.Request)
	if err != nil {
		return Result{}, err
	}
	result := Result{Schema: 1, JobID: job.ID, Status: "completed", Source: "ynx-quant-worker-deterministic-built-in", Version: quantlab.Version, Experiment: experiment}
	encoded, _ := json.MarshalIndent(result, "", "  ")
	if err := os.MkdirAll(w.Outbox, 0700); err != nil {
		return Result{}, err
	}
	outputPath := filepath.Join(w.Outbox, job.ID+".result.json")
	temporary := outputPath + ".tmp"
	if err := os.WriteFile(temporary, encoded, 0600); err != nil {
		return Result{}, err
	}
	if err := os.Rename(temporary, outputPath); err != nil {
		return Result{}, err
	}
	processed := filepath.Join(w.Outbox, job.ID+".request.json")
	if err := os.Rename(inputPath, processed); err != nil {
		return Result{}, fmt.Errorf("result written but request archive failed: %w", err)
	}
	return result, nil
}

func validID(value string) bool {
	if len(value) < 3 || len(value) > 80 {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return false
		}
	}
	return true
}
