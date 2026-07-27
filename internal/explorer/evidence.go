package explorer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const publicEvidenceSchemaVersion = "explorer.public-evidence.v1"

type EvidenceSource struct {
	Authority        string `json:"authority"`
	System           string `json:"system"`
	Version          string `json:"version"`
	TransportOwner   string `json:"transportOwner"`
	Transport        string `json:"transport"`
	TransportVersion string `json:"transportVersion"`
	Path             string `json:"path"`
	UpstreamPath     string `json:"upstreamPath"`
	Derivation       string `json:"derivation"`
}

type EvidenceFreshness struct {
	State         string `json:"state"`
	Stale         bool   `json:"stale"`
	Offline       bool   `json:"offline"`
	Partial       bool   `json:"partial"`
	Reason        string `json:"reason,omitempty"`
	RPCHeight     uint64 `json:"rpcHeight,omitempty"`
	IndexedHeight uint64 `json:"indexedHeight,omitempty"`
	LagBlocks     uint64 `json:"lagBlocks,omitempty"`
}

type EvidenceCoverage struct {
	Status  string   `json:"status"`
	Scope   string   `json:"scope"`
	Missing []string `json:"missing,omitempty"`
	Note    string   `json:"note,omitempty"`
}

type EvidenceCorrection struct {
	Status   string `json:"status"`
	Replaces string `json:"replaces,omitempty"`
}

type EvidenceIntegrity struct {
	Algorithm string `json:"algorithm"`
	Digest    string `json:"digest"`
}

type EvidenceError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type PublicEvidenceEnvelope struct {
	SchemaVersion string             `json:"schemaVersion"`
	EvidenceID    string             `json:"evidenceId"`
	Kind          string             `json:"kind"`
	Subject       string             `json:"subject"`
	Source        EvidenceSource     `json:"source"`
	ObservedAt    time.Time          `json:"observedAt"`
	AsOf          time.Time          `json:"asOf"`
	AsOfBasis     string             `json:"asOfBasis"`
	Freshness     EvidenceFreshness  `json:"freshness"`
	Coverage      EvidenceCoverage   `json:"coverage"`
	Correction    EvidenceCorrection `json:"correction"`
	Integrity     *EvidenceIntegrity `json:"integrity,omitempty"`
	Payload       any                `json:"payload,omitempty"`
	Error         *EvidenceError     `json:"error,omitempty"`
}

type evidenceDescriptor struct {
	Kind         string
	Subject      string
	Authority    string
	System       string
	Transport    string
	Path         string
	UpstreamPath string
	Derivation   string
	AsOfBasis    string
}

type evidenceRequestError struct {
	status  int
	code    string
	message string
	cause   error
}

func (e *evidenceRequestError) Error() string {
	if e.cause != nil {
		return e.cause.Error()
	}
	return e.message
}

func requestEvidenceError(status int, code, message string, cause error) error {
	return &evidenceRequestError{status: status, code: code, message: message, cause: cause}
}

func (s *Server) publicEvidence(ctx context.Context, kind, subject string) (PublicEvidenceEnvelope, int) {
	observedAt := time.Now().UTC()
	descriptor, payload, asOf, err := s.fetchEvidence(ctx, kind, subject)
	if err != nil {
		status, code, message := classifyEvidenceError(err)
		state := "unavailable"
		offline := false
		if status >= http.StatusInternalServerError {
			state = "offline"
			offline = true
		}
		return PublicEvidenceEnvelope{
			SchemaVersion: publicEvidenceSchemaVersion,
			EvidenceID:    requestEvidenceID(descriptor.Kind, descriptor.Subject, descriptor.Path, code),
			Kind:          descriptor.Kind,
			Subject:       descriptor.Subject,
			Source:        s.evidenceSource(descriptor),
			ObservedAt:    observedAt,
			AsOf:          observedAt,
			AsOfBasis:     "explorer-observed-at",
			Freshness: EvidenceFreshness{
				State:   state,
				Offline: offline,
				Reason:  message,
			},
			Coverage: EvidenceCoverage{
				Status: "unavailable",
				Scope:  "requested-record",
				Note:   "No payload is included because the authoritative source did not return the requested evidence.",
			},
			Correction: EvidenceCorrection{Status: "not-declared-by-source"},
			Error: &EvidenceError{
				Code:      code,
				Message:   message,
				Retryable: status >= http.StatusInternalServerError,
			},
		}, status
	}

	if asOf.IsZero() {
		asOf = observedAt
		descriptor.AsOfBasis = "explorer-observed-at"
	}
	freshness := EvidenceFreshness{State: "current"}
	coverage := EvidenceCoverage{
		Status: "complete-for-explorer-schema",
		Scope:  "requested-record",
		Note:   "Coverage is limited to the versioned Explorer view and does not imply that every upstream domain field exists.",
	}
	if summary, summaryErr := s.service.Summary(ctx); summaryErr != nil {
		freshness.State = "unknown"
		freshness.Partial = true
		freshness.Reason = "Source record was returned, but cross-source freshness could not be verified."
		coverage.Status = "partial"
		coverage.Missing = []string{"cross-source-freshness"}
	} else {
		freshness.RPCHeight = summary.RPCHeight
		freshness.IndexedHeight = summary.IndexedHeight
		freshness.LagBlocks = summary.SyncLagBlocks
		if descriptor.Transport == "ynx-indexer" && summary.SyncLagBlocks > 0 {
			freshness.State = "partial"
			freshness.Partial = true
			freshness.Reason = fmt.Sprintf("Indexer is %d block(s) behind the RPC source.", summary.SyncLagBlocks)
			coverage.Status = "partial"
			coverage.Missing = []string{"records-after-indexed-height"}
		}
	}

	integrity, evidenceID, integrityErr := payloadIntegrity(descriptor, payload)
	if integrityErr != nil {
		return PublicEvidenceEnvelope{
			SchemaVersion: publicEvidenceSchemaVersion,
			EvidenceID:    requestEvidenceID(descriptor.Kind, descriptor.Subject, descriptor.Path, "encoding_failed"),
			Kind:          descriptor.Kind,
			Subject:       descriptor.Subject,
			Source:        s.evidenceSource(descriptor),
			ObservedAt:    observedAt,
			AsOf:          asOf,
			AsOfBasis:     descriptor.AsOfBasis,
			Freshness: EvidenceFreshness{
				State:   "unavailable",
				Partial: true,
				Reason:  "Evidence payload could not be encoded for integrity verification.",
			},
			Coverage:   EvidenceCoverage{Status: "unavailable", Scope: "requested-record"},
			Correction: EvidenceCorrection{Status: "not-declared-by-source"},
			Error: &EvidenceError{
				Code:      "evidence_encoding_failed",
				Message:   "Evidence payload could not be encoded.",
				Retryable: false,
			},
		}, http.StatusInternalServerError
	}

	return PublicEvidenceEnvelope{
		SchemaVersion: publicEvidenceSchemaVersion,
		EvidenceID:    evidenceID,
		Kind:          descriptor.Kind,
		Subject:       descriptor.Subject,
		Source:        s.evidenceSource(descriptor),
		ObservedAt:    observedAt,
		AsOf:          asOf,
		AsOfBasis:     descriptor.AsOfBasis,
		Freshness:     freshness,
		Coverage:      coverage,
		Correction:    EvidenceCorrection{Status: "not-declared-by-source"},
		Integrity:     &integrity,
		Payload:       payload,
	}, http.StatusOK
}

func (s *Server) evidenceSource(descriptor evidenceDescriptor) EvidenceSource {
	transportVersion := strings.TrimSpace(s.build.Release)
	if transportVersion == "" {
		transportVersion = "not-declared"
	}
	return EvidenceSource{
		Authority:        descriptor.Authority,
		System:           descriptor.System,
		Version:          "not-declared-by-source",
		TransportOwner:   "12-explorer",
		Transport:        descriptor.Transport,
		TransportVersion: transportVersion,
		Path:             descriptor.Path,
		UpstreamPath:     descriptor.UpstreamPath,
		Derivation:       descriptor.Derivation,
	}
}

func (s *Server) fetchEvidence(ctx context.Context, kind, subject string) (evidenceDescriptor, any, time.Time, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	subject = strings.TrimSpace(subject)
	descriptor := evidenceDescriptor{
		Kind:       kind,
		Subject:    subject,
		Authority:  "unassigned",
		System:     "unknown",
		Transport:  "ynx-explorerd",
		Path:       "/api/evidence/" + url.PathEscape(kind) + "/" + url.PathEscape(subject),
		Derivation: "none",
		AsOfBasis:  "explorer-observed-at",
	}
	if kind == "" || subject == "" {
		return descriptor, nil, time.Time{}, requestEvidenceError(http.StatusBadRequest, "invalid_evidence_request", "Evidence kind and subject are required.", nil)
	}

	switch kind {
	case "block":
		if _, err := strconv.ParseUint(subject, 10, 64); err != nil {
			return descriptor, nil, time.Time{}, requestEvidenceError(http.StatusBadRequest, "invalid_block_height", "Block height must be an unsigned integer.", err)
		}
		descriptor.Authority = "01-chain-core"
		descriptor.System = "ynx-chain"
		descriptor.Transport = "ynx-indexer"
		descriptor.Path = "/api/blocks/" + url.PathEscape(subject)
		descriptor.UpstreamPath = "/blocks/" + url.PathEscape(subject)
		block, err := s.service.Block(ctx, subject)
		if err != nil {
			return descriptor, nil, time.Time{}, err
		}
		descriptor.Subject = strconv.FormatUint(block.Height, 10)
		descriptor.AsOfBasis = "source-event-time"
		return descriptor, block, block.Time, nil
	case "transaction":
		descriptor.Authority = "01-chain-core"
		descriptor.System = "ynx-chain"
		descriptor.Transport = "ynx-indexer"
		descriptor.Path = "/api/txs/" + url.PathEscape(subject)
		descriptor.UpstreamPath = "/txs/" + url.PathEscape(subject)
		tx, err := s.service.Transaction(ctx, subject)
		if err != nil {
			return descriptor, nil, time.Time{}, err
		}
		descriptor.Subject = tx.Hash
		descriptor.AsOfBasis = "source-event-time"
		return descriptor, tx, tx.Timestamp, nil
	case "account":
		normalized, err := normalizeExplorerAddress(subject)
		if err != nil {
			return descriptor, nil, time.Time{}, requestEvidenceError(http.StatusBadRequest, "invalid_account_address", "Account address is invalid.", err)
		}
		descriptor.Subject = normalized
		descriptor.Authority = "01-chain-core"
		descriptor.System = "ynx-chain"
		descriptor.Transport = "ynx-rpc"
		descriptor.Path = "/api/accounts/" + url.PathEscape(normalized)
		descriptor.UpstreamPath = "/accounts/" + url.PathEscape(normalized)
		account, err := s.service.Account(ctx, normalized)
		return descriptor, account, time.Time{}, err
	case "resource":
		normalized, err := normalizeExplorerAddress(subject)
		if err != nil {
			return descriptor, nil, time.Time{}, requestEvidenceError(http.StatusBadRequest, "invalid_resource_address", "Resource account address is invalid.", err)
		}
		descriptor.Subject = normalized
		descriptor.Authority = "01-chain-core"
		descriptor.System = "ynx-chain-resource-state"
		descriptor.Transport = "ynx-rpc"
		descriptor.Path = "/api/resources/" + url.PathEscape(normalized)
		descriptor.UpstreamPath = "/resources/" + url.PathEscape(normalized)
		resources, err := s.service.Resources(ctx, normalized)
		return descriptor, resources, time.Time{}, err
	case "token":
		symbol := strings.ToUpper(subject)
		descriptor.Subject = symbol
		descriptor.Authority = "01-chain-core"
		descriptor.System = "ynx-chain-network-identity"
		descriptor.Transport = "ynx-rpc"
		descriptor.Path = "/api/tokens/" + url.PathEscape(symbol)
		descriptor.UpstreamPath = "/status"
		descriptor.Derivation = "explorer-token-view-v1"
		if symbol != "YNXT" {
			return descriptor, nil, time.Time{}, requestEvidenceError(http.StatusNotFound, "token_not_indexed", "Requested token is not indexed by this Explorer.", nil)
		}
		token, err := s.service.Token(ctx, symbol)
		return descriptor, token, time.Time{}, err
	case "fee":
		descriptor.Authority = "01-chain-core"
		descriptor.System = "ynx-chain"
		descriptor.Transport = "ynx-indexer"
		descriptor.Path = "/api/fees/" + url.PathEscape(subject)
		descriptor.UpstreamPath = "/txs/" + url.PathEscape(subject)
		descriptor.Derivation = "explorer-fee-view-v1"
		tx, err := s.service.Transaction(ctx, subject)
		if err != nil {
			return descriptor, nil, time.Time{}, err
		}
		descriptor.Subject = tx.Hash
		descriptor.AsOfBasis = "source-event-time"
		return descriptor, FeeDetailFromTx(tx), tx.Timestamp, nil
	default:
		return descriptor, nil, time.Time{}, requestEvidenceError(http.StatusBadRequest, "unsupported_evidence_kind", "Evidence kind is not supported by this Explorer contract.", nil)
	}
}

func classifyEvidenceError(err error) (int, string, string) {
	var requestErr *evidenceRequestError
	if errors.As(err, &requestErr) {
		return requestErr.status, requestErr.code, requestErr.message
	}
	status := upstreamStatus(err)
	switch {
	case status == http.StatusBadRequest:
		return http.StatusBadRequest, "source_rejected_request", "The authoritative source rejected the evidence request."
	case status == http.StatusNotFound:
		return http.StatusNotFound, "evidence_not_found", "The authoritative source did not return the requested evidence."
	case status >= http.StatusInternalServerError:
		return http.StatusBadGateway, "evidence_source_unavailable", "The authoritative evidence source is unavailable."
	default:
		return http.StatusBadGateway, "evidence_source_unavailable", "The authoritative evidence source is unavailable."
	}
}

func payloadIntegrity(descriptor evidenceDescriptor, payload any) (EvidenceIntegrity, string, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return EvidenceIntegrity{}, "", err
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte(descriptor.Kind))
	_, _ = hash.Write([]byte("\n"))
	_, _ = hash.Write([]byte(descriptor.Subject))
	_, _ = hash.Write([]byte("\n"))
	_, _ = hash.Write([]byte(descriptor.Path))
	_, _ = hash.Write([]byte("\n"))
	_, _ = hash.Write(encoded)
	digest := hex.EncodeToString(hash.Sum(nil))
	return EvidenceIntegrity{Algorithm: "sha256", Digest: digest}, "ynx-evidence-sha256:" + digest, nil
}

func requestEvidenceID(kind, subject, path, code string) string {
	sum := sha256.Sum256([]byte(kind + "\n" + subject + "\n" + path + "\n" + code))
	return "ynx-evidence-request-sha256:" + hex.EncodeToString(sum[:])
}
