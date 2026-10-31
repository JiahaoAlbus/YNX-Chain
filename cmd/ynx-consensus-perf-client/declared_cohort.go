package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const declaredCohortSchema = "YNX-PERF-DECLARED-COHORT/v1"

type logicalArrival struct {
	ID          string `json:"id"`
	Index       int    `json:"index"`
	Sender      int    `json:"sender"`
	Round       int    `json:"round"`
	SigningMode string `json:"signingMode"`
	ArrivalNs   string `json:"logicalArrivalOffsetNs"`
}
type declaredCohortPlan struct {
	Schema         string           `json:"schema"`
	ManifestSHA256 string           `json:"manifestSha256"`
	InputSHA256    string           `json:"inputSha256"`
	GenesisHash    string           `json:"genesisHash"`
	MigrationHash  string           `json:"migrationHash"`
	Senders        int              `json:"senders"`
	Rounds         int              `json:"rounds"`
	OfferedRate    float64          `json:"offeredRate"`
	WindowStartNs  string           `json:"windowStartNs"`
	WindowEndNs    string           `json:"windowEndNs"`
	Rows           []logicalArrival `json:"rows"`
}
type declaredCohortReport struct {
	Schema              string    `json:"schema"`
	PlanSHA256          string    `json:"planSha256"`
	PlanPath            string    `json:"planPath"`
	WindowCompleted     bool      `json:"windowCompleted"`
	ObservationCutoffNs string    `json:"observationCutoffNs"`
	ReleasedOffsetNs    []*string `json:"releasedOffsetNs"`
	Interpretation      string    `json:"interpretation"`
}
type declaredCohort struct {
	plan         declaredCohortPlan
	digest, path string
	origin       time.Time
	window       time.Duration
	releaseTimes []time.Time
	released     []chan struct{}
	done         chan struct{}
	cancel       context.CancelFunc
}

func makeDeclaredCohortPlan(manifestRaw, inputRaw []byte, genesis, migration string, senders, rounds int, rate float64, window time.Duration) (declaredCohortPlan, error) {
	p := declaredCohortPlan{}
	n := senders * rounds
	if senders < 1 || senders > maxTransactions || rounds < 2 || rounds > 32 || n < 1 || n > maxTransactions || rate <= 0 || rate > maxTransactions || window <= 0 || window > 30*time.Second {
		return p, errors.New("declared cohort exceeds original finite plan limits")
	}
	// A fixed window covers the complete constant-arrival demand, including the
	// last arrival interval; it is never chosen after observing successes/drain.
	expected := time.Duration(float64(n) * float64(time.Second) / rate)
	if window != expected {
		return p, errors.New("declared window must equal complete planned count / offered rate")
	}
	mh, ih := sha256.Sum256(manifestRaw), sha256.Sum256(inputRaw)
	p = declaredCohortPlan{Schema: declaredCohortSchema, ManifestSHA256: hex.EncodeToString(mh[:]), InputSHA256: hex.EncodeToString(ih[:]), GenesisHash: genesis, MigrationHash: migration, Senders: senders, Rounds: rounds, OfferedRate: rate, WindowStartNs: "0", WindowEndNs: strconv.FormatInt(window.Nanoseconds(), 10), Rows: make([]logicalArrival, n)}
	for i := range p.Rows {
		sender, round := i%senders, i/senders+1
		key, _ := json.Marshal([]any{declaredCohortSchema, p.ManifestSHA256, p.InputSHA256, i, sender, round})
		id := sha256.Sum256(key)
		mode := "online_signed"
		if round == 1 {
			mode = "pre_signed"
		}
		due := time.Duration(float64(i) * float64(time.Second) / rate)
		p.Rows[i] = logicalArrival{ID: hex.EncodeToString(id[:]), Index: i, Sender: sender, Round: round, SigningMode: mode, ArrivalNs: strconv.FormatInt(due.Nanoseconds(), 10)}
	}
	return p, nil
}
func persistDeclaredCohort(path string, plan declaredCohortPlan) (string, error) {
	raw, err := json.Marshal(plan)
	if err != nil {
		return "", err
	}
	raw = append(raw, '\n')
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	n, writeErr := f.Write(raw)
	if n != len(raw) && writeErr == nil {
		writeErr = io.ErrShortWrite
	}
	if writeErr == nil {
		writeErr = f.Sync()
	}
	err = errors.Join(writeErr, f.Close())
	if err != nil {
		return "", err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	err = errors.Join(dir.Sync(), dir.Close())
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:]), nil
}
func startDeclaredCohort(ctx context.Context, origin time.Time, path string, plan declaredCohortPlan, digest string) *declaredCohort {
	child, cancel := context.WithCancel(ctx)
	window, _ := strconv.ParseInt(plan.WindowEndNs, 10, 64)
	c := &declaredCohort{plan: plan, digest: digest, path: path, origin: origin, window: time.Duration(window), releaseTimes: make([]time.Time, len(plan.Rows)), released: make([]chan struct{}, len(plan.Rows)), done: make(chan struct{}), cancel: cancel}
	for i := range c.released {
		c.released[i] = make(chan struct{})
	}
	go func() {
		defer close(c.done)
		for i, row := range plan.Rows {
			ns, _ := strconv.ParseInt(row.ArrivalNs, 10, 64)
			if !waitUntil(child, origin.Add(time.Duration(ns))) {
				return
			}
			c.releaseTimes[i] = time.Now()
			close(c.released[i])
		}
	}()
	return c
}
func (c *declaredCohort) waitArrival(ctx context.Context, index int) error {
	if c == nil {
		return nil
	}
	if index < 0 || index >= len(c.released) {
		return errors.New("logical arrival outside original plan")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.released[index]:
		return ctx.Err()
	}
}
func (c *declaredCohort) finish(ctx context.Context, completeWindow bool) error {
	if c == nil {
		return nil
	}
	var err error
	if completeWindow {
		if !waitUntil(ctx, c.origin.Add(c.window)) {
			err = ctx.Err()
		} else {
			select {
			case <-c.done:
			case <-ctx.Done():
				err = ctx.Err()
			}
		}
	}
	c.cancel()
	<-c.done
	return err
}
func (c *declaredCohort) snapshot(cutoff time.Time) *declaredCohortReport {
	if c == nil {
		return nil
	}
	r := &declaredCohortReport{Schema: declaredCohortSchema, PlanSHA256: c.digest, PlanPath: c.path, ObservationCutoffNs: strconv.FormatInt(cutoff.Sub(c.origin).Nanoseconds(), 10), WindowCompleted: !cutoff.Before(c.origin.Add(c.window)), ReleasedOffsetNs: make([]*string, len(c.releaseTimes)), Interpretation: "Immutable pre-dispatch logical arrival schedule defines the full denominator. Independent generator release times disclose lateness/cancellation; missing release or signature does not erase planned demand. Actual submission still obeys original nonce/quarantine/pacing. Final events remain client observations, not physical Commit or sustained TPS proof."}
	for i, at := range c.releaseTimes {
		if at.IsZero() {
			r.WindowCompleted = false
			continue
		}
		if !hasMonotonic(at) || at.Before(c.origin) || at.After(cutoff) {
			r.WindowCompleted = false
			continue
		}
		ns := fmt.Sprint(at.Sub(c.origin).Nanoseconds())
		r.ReleasedOffsetNs[i] = &ns
	}
	return r
}
