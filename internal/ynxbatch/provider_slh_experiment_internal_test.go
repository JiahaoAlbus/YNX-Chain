//go:build ynxslhexperiment

package ynxbatch

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	experiment "github.com/cloudflare/circl/experimental-slh/slhdsa"
	"github.com/cloudflare/circl/sign/slhdsa"
	"io"
	"os"
	"runtime"
	"sync"
	"testing"
	"time"
)

// Only tests enroll fresh synthetic keys in this isolated build. No enrollment
// symbol exists in an application binary; neither real keys nor Native inputs
// can enter the experimental provider. Nothing private is written to artifacts.
func registerSLHBaselineSyntheticKey(t *testing.T, k *PrivateKey) {
	t.Helper()
	raw, err := k.state.b.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	defer clear(raw)
	candidate := &experiment.PrivateKey{ID: experiment.SHA2_256f}
	if err = candidate.UnmarshalBinary(raw); err != nil {
		t.Fatal(err)
	}
	slhSyntheticKeys.Lock()
	slhSyntheticKeys.keys[k.state.b] = candidate
	slhSyntheticKeys.Unlock()
	original := k.state.b
	t.Cleanup(func() {
		k.state.mu.Lock()
		defer k.state.mu.Unlock()
		slhSyntheticKeys.Lock()
		delete(slhSyntheticKeys.keys, original)
		slhSyntheticKeys.Unlock()
		experiment.ClearExperimentKey(candidate)
	})
}

func TestSLHExperimentDestroyWaitsForOriginalWorkerJoin(t *testing.T) {
	k, _, err := KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(k.Destroy)
	registerSLHBaselineSyntheticKey(t, k)
	type result struct {
		wire []byte
		err  error
	}
	signed := make(chan result, 1)
	go func() {
		b, e := BatchSign(k, Metadata{ChainID: bytes.Repeat([]byte{51}, 32), Owner: "synthetic-destroy", Purpose: "TX-BATCH"}, [][]byte{bytes.Repeat([]byte{52}, 256)}, SignOptions{Optimized: true})
		if e != nil {
			signed <- result{err: e}
			return
		}
		wire, e := b.CertificateWire()
		b.Discard()
		signed <- result{wire, e}
	}()
	deadline := time.Now().Add(2 * time.Second)
	for experiment.ExperimentSchedulingStats().Workers == 0 {
		if time.Now().After(deadline) {
			t.Fatal("scheduled signing worker did not start")
		}
		runtime.Gosched()
	}
	destroyed := make(chan experiment.SchedulingStats, 1)
	go func() { k.Destroy(); destroyed <- experiment.ExperimentSchedulingStats() }()
	r := <-signed
	stats := <-destroyed
	if r.err != nil {
		t.Fatal(r.err)
	}
	if stats.Workers != 0 || stats.Requests != 0 {
		t.Fatalf("Destroy returned with a signer still active: %+v", stats)
	}
	cert, e := DecodeCertificate(r.wire)
	if e != nil {
		t.Fatal(e)
	}
	p, e := importPublic(cert.Context)
	if e != nil {
		t.Fatal(e)
	}
	if e = verifySignatures(cert, p); e != nil {
		t.Fatal(e)
	}
}

func TestSLHExperimentExactPublicSeedAndRandomness(t *testing.T) {
	// Public, nonproduction diagnostic seed and independent additional randomness.
	// Original and isolated fork generate the same key without any key export.
	seed := make([]byte, 96)
	for i := range seed {
		seed[i] = byte(i)
	}
	pub, original, err := slhdsa.GenerateKey(bytes.NewReader(seed), slhdsa.SHA2_256f)
	if err != nil {
		t.Fatal(err)
	}
	candidatePub, candidate, err := experiment.GenerateKey(bytes.NewReader(seed), experiment.SHA2_256f)
	if err != nil {
		t.Fatal(err)
	}
	defer experiment.ClearExperimentKey(&candidate)
	a, _ := pub.MarshalBinary()
	b, _ := candidatePub.MarshalBinary()
	if !bytes.Equal(a, b) {
		t.Fatal("public key mismatch")
	}
	vectors := make([]map[string][]byte, 0, 8)
	for i := 0; i < 8; i++ {
		message := bytes.Repeat([]byte{byte(i + 1)}, i*31+1)
		entropy := bytes.Repeat([]byte{byte(0x90 + i)}, 32)
		want, e := slhdsa.SignRandomized(&original, bytes.NewReader(entropy), slhdsa.NewMessage(message), nil)
		if e != nil {
			t.Fatal(e)
		}
		got, e := experiment.SignRandomizedScheduled(&candidate, bytes.NewReader(entropy), experiment.NewMessage(message), nil)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("same key/R differential %d", i)
		}
		if !slhdsa.Verify(&pub, slhdsa.NewMessage(message), got, nil) || !experiment.Verify(&candidatePub, experiment.NewMessage(message), want, nil) {
			t.Fatal("independent original/fork verification")
		}
		vectors = append(vectors, map[string][]byte{"publicKey": a, "message": message, "entropy": entropy, "original": want, "candidate": clone(got)})
		got[0] ^= 1
		if slhdsa.Verify(&pub, slhdsa.NewMessage(message), got, nil) || experiment.Verify(&candidatePub, experiment.NewMessage(message), got, nil) {
			t.Fatal("tamper accepted")
		}
	}
	if path := os.Getenv("YNX_SLH_INTEROP_OUTPUT"); path != "" {
		encoded, e := json.Marshal(vectors)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, encoded, 0600); e != nil {
			t.Fatal(e)
		}
	}
	stats := experiment.ExperimentSchedulingStats()
	if stats.Workers != 0 || stats.Requests != 0 || stats.PeakWorkers > stats.Capacity {
		t.Fatalf("unjoined %+v", stats)
	}
}

func TestSLHExperimentProtectedCallerAndEnrollment(t *testing.T) {
	k, _, err := KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer k.Destroy()
	metadata := Metadata{ChainID: bytes.Repeat([]byte{51}, 32), Owner: "synthetic-experiment", Purpose: "TX-BATCH"}
	messages := [][]byte{bytes.Repeat([]byte{52}, 256)}
	if b, e := BatchSign(k, metadata, messages, SignOptions{Optimized: true}); e == nil || b != nil {
		t.Fatal("unenrolled key accepted")
	}
	registerSLHBaselineSyntheticKey(t, k)
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 4; j++ {
				b, e := BatchSign(k, metadata, messages, SignOptions{Optimized: true})
				if e != nil {
					errs <- e
					return
				}
				wire, e := b.CertificateWire()
				b.Discard()
				if e != nil {
					errs <- e
					return
				}
				cert, e := DecodeCertificate(wire)
				if e != nil {
					errs <- e
					return
				}
				pub, e := importPublic(cert.Context)
				if e != nil {
					errs <- e
					return
				}
				if e = verifySignatures(cert, pub); e != nil {
					errs <- e
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	k.Destroy()
	if b, e := BatchSign(k, metadata, messages, SignOptions{Optimized: true}); e == nil || b != nil {
		t.Fatal("destroyed handle accepted")
	}
	stats := experiment.ExperimentSchedulingStats()
	if stats.Workers != 0 || stats.Requests != 0 {
		t.Fatalf("worker leak %+v", stats)
	}
}

type slhExperimentEntropyError struct{}

func (slhExperimentEntropyError) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func TestSLHExperimentEntropyFailureAndConcurrentRequests(t *testing.T) {
	seed := bytes.Repeat([]byte{7}, 96)
	_, key, err := experiment.GenerateKey(bytes.NewReader(seed), experiment.SHA2_256f)
	if err != nil {
		t.Fatal(err)
	}
	defer experiment.ClearExperimentKey(&key)
	if sig, e := experiment.SignRandomizedScheduled(&key, slhExperimentEntropyError{}, experiment.NewMessage([]byte("public")), nil); !errors.Is(e, io.ErrUnexpectedEOF) || sig != nil {
		t.Fatalf("entropy error/partial output: %v", e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 3; j++ {
				_, e := experiment.SignRandomizedScheduled(&key, rand.Reader, experiment.NewMessage([]byte("concurrent public diagnostic")), nil)
				if e != nil {
					errs <- e
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	stats := experiment.ExperimentSchedulingStats()
	if stats.Workers != 0 || stats.Requests != 0 || stats.PeakWorkers > stats.Capacity || stats.Serial == 0 {
		t.Fatalf("global budget/fallback %+v", stats)
	}
}
