//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"golang.org/x/crypto/pbkdf2"
)

// Synthetic experiment only: no session or normal sender calls this helper.
// Reauthenticate the complete original vault on every open. This test does not
// establish that retaining a key is an acceptable production custody lifetime.
func TestPQLabKDFReuseSyntheticExperiment(t *testing.T) {
	plan, _, credential := publicOwnerSessionFixture(t)
	vault, err := os.ReadFile(filepath.Join(plan.RootDir, "workload", "private-senders", "keys.vault"))
	if err != nil {
		t.Fatal(err)
	}
	fields, err := ynxbatch.DecodeFields(vault, 8, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	aad, err := ynxbatch.EncodeFields(fields[:7]...)
	if err != nil {
		t.Fatal(err)
	}
	open := func(aead cipher.AEAD, payload, associated []byte) ([]byte, error) {
		return aead.Open(nil, fields[6], payload, associated)
	}
	started := time.Now()
	old, err := pqLabSenderAEAD(credential, fields[5])
	if err != nil {
		t.Fatal(err)
	}
	cold := time.Since(started)
	expected, err := open(old, fields[7], aad)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(expected)
	started = time.Now()
	derived := pbkdf2.Key(credential, fields[5], 600000, 32, sha256.New)
	first := time.Since(started)
	if len(derived) != 32 {
		t.Fatal("key length")
	}
	warmOpen := func(payload, associated []byte) ([]byte, error) {
		block, err := aes.NewCipher(derived)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		return open(aead, payload, associated)
	}
	started = time.Now()
	for i := 0; i < 2; i++ {
		got, e := warmOpen(fields[7], aad)
		if e != nil || !bytes.Equal(expected, got) {
			t.Fatal("vault plaintext differs", e)
		}
		clear(got)
	}
	warm := time.Since(started)
	corrupted := bytes.Clone(fields[7])
	corrupted[len(corrupted)-1] ^= 1
	if _, err = warmOpen(corrupted, aad); err == nil {
		t.Fatal("modified ciphertext accepted")
	}
	changedAAD := bytes.Clone(aad)
	changedAAD[0] ^= 1
	if _, err = warmOpen(fields[7], changedAAD); err == nil {
		t.Fatal("modified vault binding accepted")
	}
	alternate := bytes.Clone(fields[5])
	alternate[0] ^= 1
	changed := pbkdf2.Key(credential, alternate, 600000, 32, sha256.New)
	if bytes.Equal(derived, changed) {
		t.Fatal("changed salt reused key")
	}
	clear(changed)
	clear(derived)
	for _, b := range derived {
		if b != 0 {
			t.Fatal("derived key not cleared")
		}
	}
	t.Logf("synthetic original two-owner vault: independent cold derivation %s, first cached derivation %s, two warm authenticated opens %s; excludes owner import/lease/nonce and process RSS; not TPS", cold, first, warm)
}

// Real isolated synthetic sessions, full original owner imports and leases;
// no key is pre-opened and no production CLI enables this experiment.
func TestExperimentalKDFReuseOriginalOwnersAndFailureWipe(t *testing.T) {
	plan, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	defer s.Close()
	cold := &PQLabMetrics{}
	if err = s.PrepareOwner(ctx, 0, cold); err != nil {
		t.Fatal(err)
	}
	if cold.Snapshot().Stages["sender.pbkdf2_600000"].Calls != 1 || cold.Snapshot().Stages["sender.pbkdf2_cache_hit"].Calls != 0 {
		t.Fatal("original cold KDF not measured exactly")
	}
	keyRef := cache.key
	warm := &PQLabMetrics{}
	if err = s.PrepareOwner(ctx, 1, warm); err != nil {
		t.Fatal(err)
	}
	stages := warm.Snapshot().Stages
	if stages["sender.pbkdf2_600000"].Calls != 0 || stages["sender.pbkdf2_cache_hit"].Calls != 1 || stages["sender.aesGCMOpen"].Calls != 1 || stages["sender.importFullPrivatePublicPair"].Calls != 1 {
		t.Fatal("warm original owner checks omitted or misstated", stages)
	}
	t.Logf("synthetic real owner open: cold=%dns KDF=%dns warm=%dns cache=%dns authenticatedOpen=%dns import=%dns; local wall intervals overlap; not TPS", cold.Snapshot().Stages["sender.openTotal"].ElapsedNS, cold.Snapshot().Stages["sender.pbkdf2_600000"].ElapsedNS, stages["sender.openTotal"].ElapsedNS, stages["sender.pbkdf2_cache_hit"].ElapsedNS, stages["sender.aesGCMOpen"].ElapsedNS, stages["sender.importFullPrivatePublicPair"].ElapsedNS)
	if s.Stats().OpenedOwners != 2 {
		t.Fatal("original owner imports missing")
	}
	for i := 0; i < 2; i++ {
		entries, e := os.ReadDir(filepath.Join(plan.RootDir, "workload", "sender-public", fmt.Sprintf("%04d", i)))
		if e != nil || len(entries) != 0 {
			t.Fatal("prepare created operation", e)
		}
	}
	// A request with no valid operation must clear the same retained key, and
	// no recovery or replacement operation is generated.
	_, err = s.Sign(ctx, PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OwnerIndex: 0, OperationID: "invalid"}, 0, "", nil)
	if err == nil || cache.key != nil {
		t.Fatal("failed sign did not clear reuse capability")
	}
	for _, v := range keyRef {
		if v != 0 {
			t.Fatal("retained key slice not cleared")
		}
	}
}

func TestExperimentalKDFReuseDetectsVaultReplacementAndCloseWipes(t *testing.T) {
	plan, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	if err = s.PrepareOwner(ctx, 0, nil); err != nil {
		t.Fatal(err)
	}
	keyRef := cache.key
	path := filepath.Join(plan.RootDir, "workload", "private-senders", "keys.vault")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	fields, err := ynxbatch.DecodeFields(raw, 8, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	fields[5][0] ^= 1
	changed, err := ynxbatch.EncodeFields(fields...)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, changed, 0600); err != nil {
		t.Fatal(err)
	}
	metrics := &PQLabMetrics{}
	if err = s.PrepareOwner(ctx, 1, metrics); err == nil {
		t.Fatal("tampered salt accepted")
	}
	if metrics.Snapshot().Stages["sender.pbkdf2_600000"].Calls != 1 || metrics.Snapshot().Stages["sender.pbkdf2_cache_hit"].Calls != 0 || cache.key != nil {
		t.Fatal("changed vault did not derive afresh then wipe")
	}
	for _, v := range keyRef {
		if v != 0 {
			t.Fatal("old key not wiped on replacement")
		}
	}
	// Restore only this test-owned vault, then show a successful open is wiped at close.
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = s.PrepareOwner(ctx, 1, nil); err != nil {
		t.Fatal(err)
	}
	keyRef = cache.key
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if cache.key != nil {
		t.Fatal("close retained key")
	}
	for _, v := range keyRef {
		if v != 0 {
			t.Fatal("close did not clear retained key slice")
		}
	}
}

func TestExperimentalKDFReuseCredentialChangeFailsAndRetireWipes(t *testing.T) {
	_, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	if err = s.PrepareOwner(ctx, 0, nil); err != nil {
		t.Fatal(err)
	}
	keyRef := cache.key
	// Test-only mutation simulates a different credential in this original scope.
	s.credential[0] ^= 1
	metrics := &PQLabMetrics{}
	if err = s.PrepareOwner(ctx, 1, metrics); err == nil {
		t.Fatal("wrong credential authenticated")
	}
	if metrics.Snapshot().Stages["sender.pbkdf2_600000"].Calls != 1 || metrics.Snapshot().Stages["sender.pbkdf2_cache_hit"].Calls != 0 || cache.key != nil {
		t.Fatal("credential change reused key or did not wipe")
	}
	for _, v := range keyRef {
		if v != 0 {
			t.Fatal("prior key not cleared")
		}
	}
	s.credential[0] ^= 1
	if err = s.PrepareOwner(ctx, 1, nil); err != nil {
		t.Fatal(err)
	}
	keyRef = cache.key
	s.Retire()
	if cache.key != nil {
		t.Fatal("retire retained key")
	}
	for _, v := range keyRef {
		if v != 0 {
			t.Fatal("retire did not wipe key")
		}
	}
}

func TestExperimentalKDFReuseSameBytesDifferentVaultInode(t *testing.T) {
	plan, options, credential := publicOwnerSessionFixture(t)
	s, err := OpenPQLabPublicOwnerSession(context.Background(), options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	if err = s.PrepareOwner(context.Background(), 0, nil); err != nil {
		t.Fatal(err)
	}
	oldKey := cache.key
	path := filepath.Join(plan.RootDir, "workload", "private-senders", "keys.vault")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".synthetic-vault-replacement-")
	if err != nil {
		t.Fatal(err)
	}
	if err = temp.Chmod(0600); err != nil {
		t.Fatal(err)
	}
	if _, err = temp.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err = temp.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(temp.Name(), path); err != nil {
		t.Fatal(err)
	}
	metrics := &PQLabMetrics{}
	if err = s.PrepareOwner(context.Background(), 1, metrics); err != nil {
		t.Fatal(err)
	}
	if metrics.Snapshot().Stages["sender.pbkdf2_600000"].Calls != 1 || metrics.Snapshot().Stages["sender.pbkdf2_cache_hit"].Calls != 0 {
		t.Fatal("different vault inode reused key")
	}
	for _, v := range oldKey {
		if v != 0 {
			t.Fatal("replaced vault key not cleared")
		}
	}
}

func TestExperimentalKDFReuseUnknownPreservesOriginalAndWipes(t *testing.T) {
	plan, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	if err = s.PrepareOwner(ctx, 0, nil); err != nil {
		t.Fatal(err)
	}
	keyRef := cache.key
	// Model an existing incomplete original: never remove or regenerate it.
	operationID := strings.Repeat("e", 64)
	directory := filepath.Join(plan.RootDir, "workload", "sender-public", "0000", operationID)
	if err = os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(directory, "original-unknown")
	if err = os.WriteFile(marker, []byte("original incomplete"), 0600); err != nil {
		t.Fatal(err)
	}
	req := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: operationID, OwnerIndex: 0, FirstNonce: 2, Members: 1}
	if _, err = s.Sign(ctx, req, 0, "", nil); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("original UNKNOWN not preserved", err)
	}
	if cache.key != nil {
		t.Fatal("UNKNOWN retained key")
	}
	for _, v := range keyRef {
		if v != 0 {
			t.Fatal("UNKNOWN key not wiped")
		}
	}
	contents, err := os.ReadFile(marker)
	if err != nil || string(contents) != "original incomplete" {
		t.Fatal("original UNKNOWN changed", err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 1 {
		t.Fatal("UNKNOWN was replayed or replaced", err)
	}
}

func TestExperimentalKDFReuseOriginalSignAndRecovery(t *testing.T) {
	plan, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.experimentalKDFCache = &pqLabExperimentalKDFCache{}
	if err = s.PrepareOwner(ctx, 0, nil); err != nil {
		t.Fatal(err)
	}
	if err = s.PrepareOwner(ctx, 1, nil); err != nil {
		t.Fatal(err)
	}
	state := publicOwnerState(t, plan)
	req := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("b", 64), OwnerIndex: 1, FirstNonce: 2, Members: 1}
	result, err := s.Sign(ctx, req, state.Height, state.AppHash, nil)
	if err != nil || result.OperationID != req.OperationID {
		t.Fatal("original sign failed", err)
	}
	path := filepath.Join(plan.RootDir, "workload", "sender-public", "0001", req.OperationID, "transaction.abci")
	first, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := s.Sign(ctx, req, 0, "", nil)
	if err != nil || recovered.OperationID != req.OperationID {
		t.Fatal("original recovery failed", err)
	}
	second, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(first, second) {
		t.Fatal("original recovered wire changed", err)
	}
	entries, err := os.ReadDir(filepath.Dir(filepath.Dir(path)))
	if err != nil || len(entries) != 1 || entries[0].Name() != req.OperationID {
		t.Fatal("original recovery created replacement operation", err)
	}
}

func TestExperimentalVaultReaderRejectsLinks(t *testing.T) {
	plan, _, _ := publicOwnerSessionFixture(t)
	path := filepath.Join(plan.RootDir, "workload", "private-senders", "keys.vault")
	link := path + ".synthetic-link"
	if err := os.Link(path, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readExperimentalOriginalVault(path, 8<<20); err == nil {
		t.Fatal("hard-linked vault accepted")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readExperimentalOriginalVault(link, 8<<20); err == nil {
		t.Fatal("symlink vault accepted")
	}
}

func TestExperimentalKDFReuseSealedCacheCannotReopen(t *testing.T) {
	plan, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	if err = s.PrepareOwner(ctx, 0, nil); err != nil {
		t.Fatal(err)
	}
	s.Retire()
	metrics := &PQLabMetrics{}
	// Represents an already-admitted call reaching the private open only after
	// retirement acquired and sealed its cache. No public operation is invoked.
	sender, err := openPQLabSenderMeasured(filepath.Join(plan.RootDir, "workload"), options.WorkloadSHA256, 1, credential, metrics, cache)
	if sender != nil || err == nil || cache.key != nil || metrics.Snapshot().Stages["sender.pbkdf2_600000"].Calls != 0 {
		t.Fatal("sealed cache allowed a later key derivation")
	}
}

func TestExperimentalKDFCacheLockWaitIncludedInOpen(t *testing.T) {
	cache := &pqLabExperimentalKDFCache{}
	metrics := &PQLabMetrics{}
	cache.mu.Lock()
	waiting := make(chan struct{})
	cache.onWait = func() { close(waiting) }
	done := make(chan error, 1)
	go func() {
		_, err := openPQLabSenderMeasured("relative-invalid", "", 0, make([]byte, 32), metrics, cache)
		done <- err
	}()
	<-waiting
	time.Sleep(20 * time.Millisecond)
	cache.mu.Unlock()
	if err := <-done; err == nil {
		t.Fatal("invalid path unexpectedly accepted")
	}
	defer cache.seal()
	stages := metrics.Snapshot().Stages
	if stages["sender.pbkdf2_cache_lock_wait"].Calls != 1 || stages["sender.pbkdf2_cache_lock_wait"].ElapsedNS < 10_000_000 || stages["sender.openTotal"].ElapsedNS < stages["sender.pbkdf2_cache_lock_wait"].ElapsedNS || stages["sender.pbkdf2_600000"].Calls != 0 {
		t.Fatal("cache lock wait omitted from total", stages)
	}
}

func TestExperimentalKDFReusePrepareSourceFailureWipes(t *testing.T) {
	_, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cache := &pqLabExperimentalKDFCache{}
	s.experimentalKDFCache = cache
	if err = s.PrepareOwner(ctx, 0, nil); err != nil {
		t.Fatal(err)
	}
	key := cache.key
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err = s.PrepareSource(canceled, nil); err == nil || cache.key != nil {
		t.Fatal("failed source preparation retained key")
	}
	for _, v := range key {
		if v != 0 {
			t.Fatal("failed source preparation did not clear key slice")
		}
	}
}

func TestExperimentalErrorClearWaitIncludedInTotals(t *testing.T) {
	for _, which := range []string{"prepareSource", "signTotal"} {
		t.Run(which, func(t *testing.T) {
			cache := &pqLabExperimentalKDFCache{}
			s := &PQLabPublicOwnerSession{experimentalKDFCache: cache}
			metrics := &PQLabMetrics{}
			waiting := make(chan struct{})
			cache.onClear = func() { close(waiting) }
			cache.mu.Lock()
			done := make(chan error, 1)
			go func() {
				if which == "prepareSource" {
					ctx, cancel := context.WithCancel(context.Background())
					cancel()
					done <- s.PrepareSource(ctx, metrics)
				} else {
					_, err := s.Sign(context.Background(), PQLabSenderRequest{}, 0, "", metrics)
					done <- err
				}
			}()
			<-waiting
			time.Sleep(20 * time.Millisecond)
			cache.mu.Unlock()
			if err := <-done; err == nil {
				t.Fatal("invalid request unexpectedly succeeded")
			}
			stage := metrics.Snapshot().Stages["publicOwner."+which]
			if stage.Calls != 1 || stage.ElapsedNS < 10_000_000 {
				t.Fatal("failure cleanup wait omitted from total", stage)
			}
		})
	}
}
