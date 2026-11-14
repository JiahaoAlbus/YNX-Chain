package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/spf13/pflag"
)

const operatorCommitObservationVersion = "YNX-COMET-COMMIT-OBSERVATION/v1"
const operatorCommitObservationMaxSamples = 128

func registerCommitObservationFlags(flags *pflag.FlagSet, p *pqOptions) {
	flags.BoolVar(&p.commitValidationObservation, "commit-validation-observation", false, "opt in to bounded per-commit validation detail in the synthetic Commit observation")
	flags.Var(&initializationStringFlag{target: &p.finalizeObservationOutput}, "finalize-observation-output", "disabled by default; separate bounded Finalize output; requires original synthetic Commit observation scope")
	flags.Var(&initializationStringFlag{target: &p.commitObservationOutput}, "commit-observation-output", "disabled by default; fresh private bounded Commit timing output after normal node stop")
	flags.Var(&initializationStringFlag{target: &p.commitObservationScope}, "commit-observation-scope", "explicit synthetic-loopback-lab/v1 only; local persistence is not signer fsync or finality")
}

func (p pqOptions) commitObservationConfigured() bool {
	return p.commitObservationOutput != "" || p.commitObservationScope != "" || p.finalizeObservationOutput != "" || p.commitValidationObservation
}

func (p pqOptions) commitObservationWireOptions() pqOptions {
	p.wireObservationOutput, p.wireObservationScope = p.commitObservationOutput, p.commitObservationScope
	return p
}

func (p pqOptions) validateCommitObservation() error {
	if !p.commitObservationConfigured() {
		return nil
	}
	// Reuse the original closed scope, protected paths and no-overwrite guard.
	if err := p.commitObservationWireOptions().validateWireObservation(); err != nil {
		return err
	}
	if p.wireObservationOutput != "" && p.commitObservationOutput == p.wireObservationOutput {
		return errors.New("Commit and wire observation require distinct fresh outputs")
	}
	for _, original := range []string{p.state, p.heightHaltControl, p.proofLivePolicy} {
		if original == "" {
			continue
		}
		absolute, err := filepath.Abs(original)
		if err != nil {
			return err
		}
		for _, suffix := range []string{".journal", ".blocks", ".snapshots"} {
			if strings.HasPrefix(p.commitObservationOutput, absolute+suffix+string(os.PathSeparator)) {
				return errors.New("Commit observation cannot enter an original state storage namespace")
			}
		}
	}
	if err := commitObservationPrivateParent(filepath.Dir(p.commitObservationOutput)); err != nil {
		return err
	}
	return p.validateFinalizeObservation()
}

func (p pqOptions) validateCommitObservationMigration(m chain.ConsensusMigrationState) error {
	if !p.commitObservationConfigured() {
		return nil
	}
	if m.Network.ChainID != consensus.PQLabNativeChainID || m.Network.IsPublicNet || !strings.HasPrefix(m.Network.Slug, "pq-lab-") {
		return errors.New("Commit observation refuses public or non-synthetic migration")
	}
	return nil
}

type operatorCommitPoint struct {
	Height  int64  `json:"height"`
	AppHash string `json:"appHash"`
}
type operatorCommitValidation struct {
	Version            string           `json:"version"`
	Height             int64            `json:"height"`
	ElapsedNs          int64            `json:"elapsedNs"`
	PhaseNs            map[string]int64 `json:"phaseNs"`
	HashDocumentNs     int64            `json:"hashDocumentNs"`
	HashEncodeDigestNs int64            `json:"hashEncodeDigestNs"`
}
type operatorCommitSample struct {
	Height      int64                        `json:"height"`
	AppHash     string                       `json:"appHash"`
	Persistence consensus.CommitTimingSample `json:"persistence"`
	Validation  *operatorCommitValidation    `json:"validation,omitempty"`
}
type operatorCommitFailure struct {
	Timing               *consensus.CommitTimingSample `json:"timing"`
	CommittedCheckpoint  *operatorCommitPoint          `json:"committedCheckpoint"`
	AttemptAppHash       *string                       `json:"attemptAppHash"` // unavailable, never the prior committed hash
	NotificationObserved bool                          `json:"notificationObserved"`
}
type operatorCommitGap struct {
	AfterHeight  int64 `json:"afterHeight"`
	BeforeHeight int64 `json:"beforeHeight"`
}
type operatorCommitCoverage struct {
	NotificationCaptureComplete        bool                `json:"notificationCaptureComplete"`
	AllCommitAttemptsCovered           bool                `json:"allCommitAttemptsCovered"`
	ReplayCoverageComplete             bool                `json:"replayCoverageComplete"`
	PrePersistenceFailuresHaveNoTiming bool                `json:"prePersistenceFailuresHaveNoTiming"`
	UnreportedStagesAreUnknown         bool                `json:"unreportedStagesAreUnknown"`
	ObservedHeightGaps                 []operatorCommitGap `json:"observedHeightGaps"`
}
type operatorCommitObservationResult struct {
	Version               string                 `json:"version"`
	Scope                 string                 `json:"scope"`
	ProcessID             int                    `json:"processID"`
	ChainID               string                 `json:"chainID"`
	OriginalGenesisHash   string                 `json:"originalGenesisHash"`
	CaptureBoundary       string                 `json:"captureBoundary"`
	IndependentFinality   bool                   `json:"independentFinality"`
	SignerFsyncMeasured   bool                   `json:"signerFsyncMeasured"`
	MaxSamples            int                    `json:"maxSamples"`
	Samples               []operatorCommitSample `json:"samples"`
	SuccessNotifications  uint64                 `json:"successNotifications"`
	ErrorNotifications    uint64                 `json:"errorNotifications"`
	DroppedSuccessSamples uint64                 `json:"droppedSuccessSamples"`
	RejectedNotifications map[string]uint64      `json:"rejectedNotifications"`
	LastFailure           *operatorCommitFailure `json:"lastFailure"`
	UnobservedLatest      *operatorCommitSample  `json:"unobservedLatest"`
	LatestTimingAvailable bool                   `json:"latestTimingAvailable"`
	FinalCheckpoint       *operatorCommitPoint   `json:"finalCheckpoint"`
	SampleOverflow        bool                   `json:"sampleOverflow"`
	Coverage              operatorCommitCoverage `json:"coverage"`
}

// A logger notification is only a synchronous trigger. Every retained value
// comes from this exact original Application's owned APIs, never log payloads.
// There is no ticker, public listener, per-Commit file IO or replaceable backend.
type operatorCommitObservation struct {
	mu                     sync.Mutex
	app                    *consensus.Application
	file                   *commitObservationOutput
	finalize               *operatorFinalizeObservation
	result                 operatorCommitObservationResult
	latestObserved         *operatorCommitSample
	validationEnabled      bool
	ran, attempted, closed bool
}

func prepareOperatorCommitObservation(config *cfg.Config, p pqOptions) (*operatorCommitObservation, error) {
	if !p.commitObservationConfigured() {
		return nil, nil
	}
	if err := p.validateCommitObservation(); err != nil {
		return nil, err
	}
	if err := validateWireObservationNetwork(config, p.commitObservationWireOptions()); err != nil {
		return nil, err
	}
	file, err := openCommitObservationOutput(p.commitObservationOutput)
	if err != nil {
		return nil, err
	}
	finalize, err := prepareOperatorFinalizeObservation(p)
	if err != nil {
		return nil, errors.Join(err, file.close())
	}
	return &operatorCommitObservation{file: file, finalize: finalize, validationEnabled: p.commitValidationObservation, result: operatorCommitObservationResult{
		Version: operatorCommitObservationVersion, Scope: operatorWireObservationScope, ProcessID: os.Getpid(),
		CaptureBoundary: "synchronous-original-block-executor-Commit-return;normal-stop-output;replay-and-early-failures-not-covered",
		MaxSamples:      operatorCommitObservationMaxSamples, Samples: []operatorCommitSample{}, RejectedNotifications: map[string]uint64{},
		Coverage: operatorCommitCoverage{PrePersistenceFailuresHaveNoTiming: true, UnreportedStagesAreUnknown: true, ObservedHeightGaps: []operatorCommitGap{}},
	}}, nil
}

func (o *operatorCommitObservation) bind(app *consensus.Application, m chain.ConsensusMigrationState) error {
	if o == nil || app == nil {
		return errors.New("Commit observation requires the original owning application")
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if m.Network.ChainID != consensus.PQLabNativeChainID || m.Network.IsPublicNet || !strings.HasPrefix(m.Network.Slug, "pq-lab-") {
		return errors.New("Commit observation binding requires the original closed synthetic migration")
	}
	if o.closed || o.app != nil || o.ran || o.attempted {
		return errors.New("Commit observation application can be bound exactly once")
	}
	if err := o.file.parentCurrent(); err != nil {
		return err
	}
	if err := o.finalize.bind(app, m); err != nil {
		return err
	}
	o.app = app
	o.result.ChainID, o.result.OriginalGenesisHash = fmt.Sprintf("ynx_%d-1", m.Network.ChainID), m.OriginalGenesisHash
	app.SetCommitTimingEnabled(true)
	if o.validationEnabled {
		if err := app.SetCommitValidationTimingEnabled(true); err != nil {
			app.SetCommitTimingEnabled(false)
			return err
		}
	}
	return nil
}

func (o *operatorCommitObservation) started() {
	if o != nil {
		o.mu.Lock()
		o.ran = o.app != nil && !o.closed
		o.finalize.started()
		o.mu.Unlock()
	}
}

func (o *operatorCommitObservation) increment(value *uint64) {
	if *value == math.MaxUint64 {
		o.result.SampleOverflow = true
	} else {
		*value++
	}
}
func (o *operatorCommitObservation) reject(reason string) {
	n := o.result.RejectedNotifications[reason]
	o.increment(&n)
	o.result.RejectedNotifications[reason] = n
}

func equalCommitTiming(a, b consensus.CommitTimingSample) bool {
	if a.Height != b.Height || a.Storage != b.Storage || a.Durable != b.Durable || a.ElapsedNs != b.ElapsedNs || a.PayloadBytes != b.PayloadBytes || len(a.StagesNs) != len(b.StagesNs) {
		return false
	}
	for k, v := range a.StagesNs {
		if w, ok := b.StagesNs[k]; !ok || v != w {
			return false
		}
	}
	return true
}
func validObservedCommitTiming(t consensus.CommitTimingSample) bool {
	if t.Height <= 0 || t.ElapsedNs < 0 || t.PayloadBytes < 0 || len(t.StagesNs) > 32 {
		return false
	}
	if t.Storage != "atomic-json" && t.Storage != "snapshot-journal-v1" && t.Storage != "block-journal-v2" {
		return false
	}
	if t.Durable && (t.ElapsedNs == 0 || t.PayloadBytes == 0 || len(t.StagesNs) == 0) {
		return false
	}
	for name, ns := range t.StagesNs {
		if len(name) == 0 || len(name) > 64 || ns < 0 || ns > t.ElapsedNs {
			return false
		}
		for _, c := range name {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_') {
				return false
			}
		}
	}
	return true
}
func commitPoint(app *consensus.Application) (*operatorCommitPoint, error) {
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil || info == nil || info.LastBlockHeight <= 0 || len(info.LastBlockAppHash) != 32 || bytes.Equal(info.LastBlockAppHash, make([]byte, 32)) {
		return nil, errors.New("original committed checkpoint unavailable")
	}
	return &operatorCommitPoint{Height: info.LastBlockHeight, AppHash: hex.EncodeToString(info.LastBlockAppHash)}, nil
}
func observedCommitSample(app *consensus.Application, height int64) (*operatorCommitSample, string) {
	if app == nil {
		return nil, "original-application-unavailable"
	}
	first, ok := app.LastCommitTiming()
	if !ok {
		return nil, "timing-unavailable"
	}
	if !validObservedCommitTiming(first) {
		return nil, "timing-malformed"
	}
	if !first.Durable || first.Height != height {
		return nil, "notification-does-not-match-durable-attempt"
	}
	point, err := commitPoint(app)
	if err != nil || point.Height != height {
		return nil, "checkpoint-does-not-match-attempt"
	}
	second, ok := app.LastCommitTiming()
	if !ok || !equalCommitTiming(first, second) {
		return nil, "attempt-changed-during-capture"
	}
	return &operatorCommitSample{Height: height, AppHash: point.AppHash, Persistence: first}, ""
}

// Bracket the detail with the original persistence identity to reject a concurrent Commit.
func observedCommitValidation(app *consensus.Application, sample *operatorCommitSample) (*operatorCommitValidation, string) {
	first, ok := app.LastCommitTiming()
	if !ok || !equalCommitTiming(first, sample.Persistence) {
		return nil, "validation-attempt-changed"
	}
	detail, ok := app.LastCommitValidationTiming()
	if !ok || !detail.Valid || detail.Height != sample.Height || detail.FailedPhase != "" {
		return nil, "validation-unavailable-or-height-differs"
	}
	second, ok := app.LastCommitTiming()
	if !ok || !equalCommitTiming(first, second) {
		return nil, "validation-attempt-changed"
	}
	parent, exists := sample.Persistence.StagesNs["validate"]
	if !exists || detail.ElapsedNs < 0 || detail.ElapsedNs > parent || detail.HashDocumentNs < 0 || detail.HashEncodeDigestNs < 0 || len(detail.PhaseNs) == 0 || len(detail.PhaseNs) > 64 {
		return nil, "validation-malformed"
	}
	for name, ns := range detail.PhaseNs {
		if len(name) == 0 || len(name) > 64 || ns < 0 || ns > detail.ElapsedNs {
			return nil, "validation-malformed"
		}
		for _, c := range name {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_') {
				return nil, "validation-malformed"
			}
		}
	}
	if detail.HashDocumentNs > detail.PhaseNs["app_hash"] || detail.HashEncodeDigestNs > detail.PhaseNs["app_hash"] {
		return nil, "validation-malformed"
	}
	return &operatorCommitValidation{Version: "YNX-COMET-COMMIT-VALIDATION/v1", Height: detail.Height, ElapsedNs: detail.ElapsedNs, PhaseNs: detail.PhaseNs, HashDocumentNs: detail.HashDocumentNs, HashEncodeDigestNs: detail.HashEncodeDigestNs}, ""
}

func (o *operatorCommitObservation) success(height int64, validHeight bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return
	}
	o.increment(&o.result.SuccessNotifications)
	if !validHeight {
		o.reject("notification-height-malformed")
		return
	}
	sample, reason := observedCommitSample(o.app, height)
	if reason != "" {
		o.reject(reason)
		return
	}
	if o.validationEnabled {
		validation, reason := observedCommitValidation(o.app, sample)
		if reason != "" {
			o.reject(reason)
			return
		}
		sample.Validation = validation
	}
	if o.latestObserved != nil {
		if height <= o.latestObserved.Height {
			o.reject("duplicate-or-stale-notification")
			return
		}
		if height != o.latestObserved.Height+1 && len(o.result.Coverage.ObservedHeightGaps) < operatorCommitObservationMaxSamples {
			o.result.Coverage.ObservedHeightGaps = append(o.result.Coverage.ObservedHeightGaps, operatorCommitGap{AfterHeight: o.latestObserved.Height, BeforeHeight: height})
		}
	}
	o.latestObserved = sample
	if len(o.result.Samples) >= operatorCommitObservationMaxSamples {
		o.increment(&o.result.DroppedSuccessSamples)
		o.result.SampleOverflow = true
		return
	}
	o.result.Samples = append(o.result.Samples, *sample)
}
func (o *operatorCommitObservation) failure() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return
	}
	o.increment(&o.result.ErrorNotifications)
	f := &operatorCommitFailure{NotificationObserved: true}
	if o.app != nil {
		f.CommittedCheckpoint, _ = commitPoint(o.app)
		if sample, ok := o.app.LastCommitTiming(); ok {
			if sample.Durable {
				o.reject("error-notification-does-not-match-failed-attempt")
				return
			}
			if validObservedCommitTiming(sample) {
				f.Timing = &sample
			} else {
				o.reject("failed-timing-malformed")
			}
		}
	}
	o.result.LastFailure = f // no new AppHash is invented for a failed attempt
}

// Installed outside ParseLogLevel, so log-level none does not remove capture.
// With delegates unchanged and retains the SAME consumer, tracking the actual
// last module binding. RPC/consensus/other loggers cannot trigger this reader.
type operatorCommitLogger struct {
	base        log.Logger
	observation *operatorCommitObservation
	module      string
}

func commitLogModule(module string, keyvals []interface{}) string {
	for i := 0; i < len(keyvals); i += 2 {
		if key, ok := keyvals[i].(string); ok && key == "module" {
			module = ""
			if i+1 < len(keyvals) {
				module, _ = keyvals[i+1].(string)
			}
		}
	}
	return module
}
func wrapOperatorCommitLogger(logger log.Logger, o *operatorCommitObservation) log.Logger {
	if o == nil {
		return logger
	}
	return &operatorCommitLogger{base: logger, observation: o}
}
func (l *operatorCommitLogger) Debug(msg string, kv ...interface{}) { l.base.Debug(msg, kv...) }
func (l *operatorCommitLogger) Info(msg string, kv ...interface{}) {
	if msg == "committed state" && commitLogModule(l.module, kv) == "state" {
		var height int64
		count := 0
		valid := true
		for i := 0; i < len(kv); i += 2 {
			if key, ok := kv[i].(string); ok && key == "height" {
				count++
				if i+1 < len(kv) {
					height, valid = kv[i+1].(int64)
				} else {
					valid = false
				}
			}
		}
		l.observation.success(height, valid && count == 1 && height > 0)
	}
	l.base.Info(msg, kv...)
}
func (l *operatorCommitLogger) Error(msg string, kv ...interface{}) {
	if msg == "client error during proxyAppConn.CommitSync" && commitLogModule(l.module, kv) == "state" {
		l.observation.failure()
	}
	l.base.Error(msg, kv...)
}
func (l *operatorCommitLogger) With(kv ...interface{}) log.Logger {
	return &operatorCommitLogger{base: l.base.With(kv...), observation: l.observation, module: commitLogModule(l.module, kv)}
}
