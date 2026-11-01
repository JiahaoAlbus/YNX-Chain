//go:build unix

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

// Bound by the QA builder to the one fixed sibling, never accepted from a
// packet, HTTP ticket, job argument or runtime executable selector.
var resourceWorkerSHA256 string
var resourceMonitorSHA256 string
var resourceSandboxSHA256 string

type controlledWASMPacket struct {
	Version           string               `json:"version"`
	Classification    string               `json:"classification"`
	Work              contribution.Work    `json:"work"`
	Consent           contribution.Consent `json:"consent"`
	IssuerPublicKey   string               `json:"issuerPublicKey"`
	ConsentPublicKey  string               `json:"consentPublicKey"`
	ManifestSignature string               `json:"manifestSignature"`
	ConsentSignature  string               `json:"consentSignature"`
	Input             []byte               `json:"input"`
}
type controlledWASMAuthority struct {
	issuer, principal     string
	issuerKey, consentKey ed25519.PublicKey
}

func (a controlledWASMAuthority) VerifyManifest(ctx context.Context, issuer string, payload, sig []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if issuer != a.issuer || !ed25519.Verify(a.issuerKey, payload, sig) {
		return contribution.ErrDenied
	}
	return nil
}
func (a controlledWASMAuthority) VerifyConsent(ctx context.Context, principal string, payload, sig []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if principal != a.principal || !ed25519.Verify(a.consentKey, payload, sig) {
		return contribution.ErrDenied
	}
	return nil
}
func controlledKey(value, pin string) (ed25519.PublicKey, error) {
	b, err := hex.DecodeString(value)
	sum := sha256.Sum256(b)
	if err != nil || len(b) != ed25519.PublicKeySize || len(pin) != 64 || hex.EncodeToString(sum[:]) != pin {
		return nil, contribution.ErrDenied
	}
	return ed25519.PublicKey(b), nil
}

// This explicit CLI runs a controlled fixture-authority packet, not a public
// resource start API. Both independent key pins are operator inputs. Temporary
// fixture signatures are never called a production publisher or human consent.
func runControlledWASM(path, dataDir, issuerPin, consentPin string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || !filepath.IsAbs(dataDir) || filepath.Clean(dataDir) != dataDir || issuerPin == consentPin {
		return contribution.ErrInvalid
	}
	info, err := os.Lstat(dataDir)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("explicit existing private controlled QA data directory required")
	}
	if st, ok := info.Sys().(*syscall.Stat_t); !ok || st.Uid != uint32(os.Geteuid()) {
		return contribution.ErrInvalid
	}
	info, err = os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 6<<20 || info.Mode().Perm()&0022 != 0 {
		return contribution.ErrInvalid
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return contribution.ErrInvalid
	}
	raw, err := io.ReadAll(io.LimitReader(f, 6<<20+1))
	after, e := f.Stat()
	named, n := os.Lstat(path)
	if err != nil || e != nil || n != nil || len(raw) > 6<<20 || !os.SameFile(opened, after) || !os.SameFile(after, named) || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return contribution.ErrInvalid
	}
	var packet controlledWASMPacket
	if err := nativeDecode(raw, &packet); err != nil {
		return err
	}
	if packet.Version != "YNX-NETWORK-CONTROLLED-WASM-PACKET/v1" || packet.Classification != contribution.SandboxClass || packet.Work.Kind != contribution.PublicBlockHistogramKind || len(packet.Input) > contribution.HistogramMaxInputBytes {
		return contribution.ErrInvalid
	}
	issuer, err := controlledKey(packet.IssuerPublicKey, issuerPin)
	if err != nil {
		return err
	}
	person, err := controlledKey(packet.ConsentPublicKey, consentPin)
	if err != nil {
		return err
	}
	manifestSig, err := hex.DecodeString(packet.ManifestSignature)
	if err != nil || len(manifestSig) != ed25519.SignatureSize {
		return contribution.ErrInvalid
	}
	consentSig, err := hex.DecodeString(packet.ConsentSignature)
	if err != nil || len(consentSig) != ed25519.SignatureSize {
		return contribution.ErrInvalid
	}
	authority := controlledWASMAuthority{packet.Work.Issuer, packet.Consent.Principal, issuer, person}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	workerPath := filepath.Join(filepath.Dir(executable), "ynx-network-task-worker")
	if len(resourceWorkerSHA256) != 64 {
		return errors.New("fixed WASM worker not bound into this helper build")
	}
	var executor *contribution.PinnedWASMExecutor
	if runtime.GOOS == "darwin" {
		executor, err = contribution.NewOSLimitedWASMExecutor(workerPath, resourceWorkerSHA256, filepath.Join(filepath.Dir(executable), "ynx-network-resource-monitor"), resourceMonitorSHA256)
	} else if runtime.GOOS == "linux" {
		executor, err = contribution.NewLinuxContainedWASMExecutor(workerPath, resourceWorkerSHA256, resourceSandboxSHA256)
	} else {
		executor, err = contribution.NewPinnedWASMExecutor(workerPath, resourceWorkerSHA256)
	}
	if err != nil {
		return err
	}
	defer executor.Close()
	manifestID := sha256.Sum256(contribution.ManifestPayload(packet.Work))
	journal := filepath.Join(dataDir, "controlled-wasm", hex.EncodeToString(manifestID[:]), "resource-journal.json")
	runner, err := contribution.NewControlledWASMSandbox(journal, authority, executor)
	if err != nil {
		return err
	}
	defer runner.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if _, err = runner.StartContribution(ctx, packet.Work, packet.Consent, manifestSig, consentSig, packet.Input); err != nil {
		return err
	}
	if err = runner.Wait(ctx); err != nil {
		return err
	}
	record, ok := runner.Record(packet.Work.Job)
	if !ok || (record.State != "submitted" && record.State != "historical" && record.State != "verified") {
		return fmt.Errorf("controlled worker did not submit: %s", record.Failure)
	}
	receipt, err := runner.VerifyWorkReceipt(ctx, packet.Work.Job, record.Result, packet.Input)
	if err != nil {
		return err
	}
	again, err := runner.VerifyWorkReceipt(ctx, packet.Work.Job, record.Result, packet.Input)
	if err != nil || again != receipt {
		return errors.New("original receipt deduplication failed")
	}
	meter := runner.VerifyResourceMeter()
	if meter.VerifiedJobs != 1 || meter.VerifiedBytes != uint64(len(packet.Input)) {
		return errors.New("controlled unique metering mismatch")
	}
	if err = runner.StopContribution(context.Background()); err != nil {
		return err
	}
	occupied, started, _ := executor.LocalProcess()
	if occupied || started {
		return errors.New("owned WASM process still present after stop")
	}
	starts := executor.Executions()
	if err = runner.Close(); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"classification": contribution.SandboxClass, "productionEnabled": false, "publisherAuthority": "CONTROLLED_FIXTURE_ONLY", "humanConsentEstablished": false, "authority": false, "rewards": "NOT_AUTHORIZED", "sourceRevision": sourceRevision, "receipt": receipt, "meter": meter, "workerExecutions": starts, "stopped": true, "workerAfterStop": false, "journal": journal})
}
