package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Collector bytes remain untrusted. Only the canonical verifier, with a host's
// independently authenticated snapshot, light anchor and target, can establish
// finality. Never manufacture those inputs from this response.
func collectPQCaseProof(ctx context.Context, client *http.Client, p pqWholeCase, gateway, path string, report *pqWholeCaseReport) {
	report.ProofCollectionStatus = "unavailable"
	start := time.Now()
	raw, err := pqCaseHTTPBound(ctx, client, http.MethodGet, strings.TrimRight(gateway, "/")+"/txs/"+p.outer+"/pq-finality-proof", nil, consensus.MaxPQTransactionProofRequestBytes+(64<<10))
	report.Phases.ProofCollectionHTTPNs = time.Since(start).Nanoseconds()
	if err != nil {
		report.ProofCollectionError = err.Error()
		return
	}
	// Preserve the original bounded response even when it is pending or invalid.
	// Exclusive creation and file + parent fsync prevent replacing prior evidence.
	start = time.Now()
	err = persistPQCaseProof(path, raw)
	report.Phases.ProofDurabilityNs = time.Since(start).Nanoseconds()
	if err != nil {
		report.ProofCollectionError = err.Error()
		return
	}
	hash := sha256.Sum256(raw)
	report.ProofEvidencePath, report.ProofEvidenceSHA256, report.ProofEvidenceBytes = path, hex.EncodeToString(hash[:]), len(raw)
	start = time.Now()
	var view bftgateway.PQFinalityView
	err = strictJSON(raw, &view)
	if err == nil {
		err = p.validateCollectedProof(view, report)
	}
	report.Phases.CollectorIdentityValidationNs = time.Since(start).Nanoseconds()
	if err != nil {
		report.ProofCollectionError = err.Error()
		return
	}
	report.ProofCollectionStatus = "collected_unverified"
}

func (p pqWholeCase) validateCollectedProof(v bftgateway.PQFinalityView, report *pqWholeCaseReport) error {
	status := "committed"
	if p.kind == consensus.PQWholeType {
		if report.EffectiveBusinessIncludedObserved <= 0 || report.RejectedMembers < 0 || report.EffectiveBusinessIncludedObserved+report.RejectedMembers != len(p.members) {
			return errors.New("Whole observation lacks complete original member counts")
		}
		if report.RejectedMembers > 0 {
			status = "partial"
		}
	}
	if (p.kind != consensus.PQTransferType && p.kind != consensus.PQInitialRegistrationType && p.kind != consensus.PQWholeType) || v.Version != "YNX-PQ-RPC-TRANSACTION-PROOF/v1" || v.Source != "configured-comet-rpc" || v.Status != "collected" || v.ObservedExecutionStatus != status || v.NativeTransactionHash != p.native || v.ABCITransactionHash != p.outer || v.ExecutionHeight != report.ExecutionHeight || v.CometIndex == nil || report.CometIndex == nil || *v.CometIndex != *report.CometIndex || v.IndependentFinality || v.ProofVerification != "not-performed" || v.Error != "" || v.Proof == nil || v.Proof.Version != consensus.PQTransactionProofVersion {
		return errors.New("original proof collector identity/status differs or proof remains unavailable")
	}
	return nil
}

func persistPQCaseProof(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(raw)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
