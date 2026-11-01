package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

type commitObservationOutput struct {
	path      string
	root      *os.Root
	directory *os.File
	parent    os.FileInfo
}

func commitObservationPrivateParent(path string) error {
	resolved, err := filepath.EvalSymlinks(path)
	info, statErr := os.Lstat(path)
	if err != nil || resolved != path || statErr != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("Commit observation requires an existing canonical private 0700 parent")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("Commit observation parent must belong to the actual process user")
	}
	return nil
}
func openCommitObservationOutput(path string) (_ *commitObservationOutput, result error) {
	dir := filepath.Dir(path)
	if err := commitObservationPrivateParent(dir); err != nil {
		return nil, err
	}
	o := &commitObservationOutput{path: path}
	defer func() {
		if result != nil {
			result = errors.Join(result, o.close())
		}
	}()
	var err error
	if o.root, err = os.OpenRoot(dir); err != nil {
		return nil, err
	}
	if o.directory, err = os.Open(dir); err != nil {
		return nil, err
	}
	if o.parent, err = o.directory.Stat(); err != nil {
		return nil, err
	}
	if err = o.parentCurrent(); err != nil {
		return nil, err
	}
	if _, err = o.root.Lstat(filepath.Base(path)); !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("Commit observation output appeared; retain original/UNKNOWN")
	}
	return o, nil
}
func (o *commitObservationOutput) parentCurrent() error {
	if o == nil || o.root == nil || o.directory == nil || o.parent == nil {
		return errors.New("Commit observation original output parent unavailable")
	}
	if err := commitObservationPrivateParent(filepath.Dir(o.path)); err != nil {
		return err
	}
	current, e1 := os.Lstat(filepath.Dir(o.path))
	held, e2 := o.root.Stat(".")
	directory, e3 := o.directory.Stat()
	if e1 != nil || e2 != nil || e3 != nil || !os.SameFile(o.parent, current) || !os.SameFile(o.parent, held) || !os.SameFile(o.parent, directory) {
		return errors.New("Commit observation original parent changed; preserve UNKNOWN")
	}
	return nil
}
func (o *commitObservationOutput) write(raw []byte) error {
	if len(raw) == 0 || len(raw) > 512<<10 {
		return errors.New("Commit observation exceeds its fixed output bound")
	}
	if err := o.parentCurrent(); err != nil {
		return err
	}
	name := filepath.Base(o.path)
	f, err := o.root.OpenFile(name, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("Commit observation exclusive output refused; retain original/UNKNOWN: %w", err)
	}
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	info, statErr := f.Stat()
	var protectionErr error
	if statErr == nil {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
			protectionErr = errors.New("Commit observation original output protection changed")
		}
	}
	err = errors.Join(writeErr, f.Sync(), statErr, protectionErr, verifyWireObservationFile(o.root, name, f, raw), f.Close(), o.directory.Sync(), o.parentCurrent())
	if err != nil {
		return fmt.Errorf("Commit observation persistence UNKNOWN; preserve exact output and do not retry: %w", err)
	}
	return nil
}
func (o *commitObservationOutput) close() error {
	if o == nil {
		return nil
	}
	var err error
	if o.root != nil {
		err = errors.Join(err, o.root.Close())
		o.root = nil
	}
	if o.directory != nil {
		err = errors.Join(err, o.directory.Close())
		o.directory = nil
	}
	return err
}

func (o *operatorCommitObservation) writeAfterStop() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed || !o.ran || o.app == nil || o.attempted {
		return errors.New("Commit observation requires one original started lifetime and one completed normal stop")
	}
	o.attempted = true // partial/uncertain writes are never repeated
	o.result.FinalCheckpoint, _ = commitPoint(o.app)
	latest, ok := o.app.LastCommitTiming()
	o.result.LatestTimingAvailable = ok
	if ok && latest.Durable {
		point, reason := observedCommitSample(o.app, latest.Height)
		if reason != "" {
			o.reject(reason)
		} else if o.latestObserved == nil || point.Height != o.latestObserved.Height || point.AppHash != o.latestObserved.AppHash || !equalCommitTiming(point.Persistence, o.latestObserved.Persistence) {
			o.result.UnobservedLatest = point // replay/direct calls are never silently counted as observed notifications
		}
	} else if ok {
		if o.result.LastFailure == nil || o.result.LastFailure.Timing == nil || !equalCommitTiming(*o.result.LastFailure.Timing, latest) {
			o.result.LastFailure = &operatorCommitFailure{CommittedCheckpoint: o.result.FinalCheckpoint}
			if validObservedCommitTiming(latest) {
				o.result.LastFailure.Timing = &latest
			} else {
				o.reject("failed-timing-malformed")
			}
		}
	}
	o.result.Coverage.NotificationCaptureComplete = len(o.result.Samples) > 0 && o.result.LatestTimingAvailable &&
		o.result.FinalCheckpoint != nil && !o.result.SampleOverflow && o.result.DroppedSuccessSamples == 0 &&
		len(o.result.RejectedNotifications) == 0 && o.result.ErrorNotifications == 0 && o.result.LastFailure == nil &&
		o.result.UnobservedLatest == nil && len(o.result.Coverage.ObservedHeightGaps) == 0
	raw, err := json.Marshal(o.result)
	if err != nil {
		return errors.New("Commit observation bounded public result could not be encoded")
	}
	if err = o.file.write(append(raw, '\n')); err != nil {
		return err
	}
	if !o.result.Coverage.NotificationCaptureComplete {
		return errors.New("Commit observation incomplete; retain exact output, missing/truncated values are not zero")
	}
	return nil
}
func (o *operatorCommitObservation) close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return nil
	}
	o.closed = true
	if o.app != nil {
		o.app.SetCommitTimingEnabled(false)
	}
	return o.file.close()
}
