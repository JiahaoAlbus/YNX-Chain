package cloud

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type lifecycleTestStore struct {
	LocalObjectStore
	mu       sync.Mutex
	fail     bool
	mismatch bool
	calls    []StorageTransitionRequest
	started  chan struct{}
	release  chan struct{}
}

func (s *lifecycleTestStore) Transition(ctx context.Context, in StorageTransitionRequest) (StorageTransitionResult, error) {
	s.mu.Lock()
	s.calls = append(s.calls, in)
	fail := s.fail
	mismatch := s.mismatch
	started := s.started
	release := s.release
	if s.started != nil {
		s.started = nil
	}
	s.mu.Unlock()
	if started != nil {
		close(started)
	}
	if release != nil {
		select {
		case <-release:
		case <-ctx.Done():
			return StorageTransitionResult{}, ctx.Err()
		}
	}
	if fail {
		return StorageTransitionResult{}, errors.New("test lifecycle outage")
	}
	resultRef := in.Ref
	if in.CopyRequired {
		body, err := s.LocalObjectStore.Get(ctx, in.Ref, in.Hash)
		if err != nil {
			return StorageTransitionResult{}, err
		}
		copyScope := hashBytes([]byte("YNX_LIFECYCLE_COPY_V1\x00" + in.TransitionID))
		resultRef, err = s.LocalObjectStore.PutScoped(ctx, copyScope, in.Hash, body)
		if err != nil {
			return StorageTransitionResult{}, err
		}
	}
	result := StorageTransitionResult{
		TransitionID:     in.TransitionID,
		Ref:              resultRef,
		Hash:             in.Hash,
		From:             in.From,
		To:               in.To,
		Status:           "completed",
		ReadMode:         StorageReadImmediate,
		ProviderEvidence: "evidence-" + in.TransitionID,
		AsOf:             time.Now().UTC(),
	}
	if in.To == StorageClassArchive {
		result.ReadMode = StorageReadRestoreRequired
	}
	if mismatch {
		result.Hash = hashBytes([]byte("mismatch"))
	}
	return result, nil
}

func (s *lifecycleTestStore) setFailure(value bool) {
	s.mu.Lock()
	s.fail = value
	s.mu.Unlock()
}

func TestStorageLifecycleHotColdArchiveAndRestore(t *testing.T) {
	dir := t.TempDir()
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}}
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("lifecycle-content")
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "tiered.bin", Content: body})
	if err != nil {
		t.Fatal(err)
	}
	if object.StorageClass != StorageClassHot || object.StorageClassVersion != 1 || object.StorageReadMode != StorageReadImmediate {
		t.Fatalf("initial storage state: %#v", object)
	}

	cold, err := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassCold)
	if err != nil || cold.Status != "completed" || cold.ReadMode != StorageReadImmediate {
		t.Fatalf("cold transition: %#v %v", cold, err)
	}
	object, _ = service.Get(owner, object.ID)
	if object.StorageClass != StorageClassCold || object.StorageClassVersion != 2 || object.StorageClassUpdatedAt == nil {
		t.Fatalf("cold object state: %#v", object)
	}

	archive, err := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassArchive)
	if err != nil || archive.Status != "completed" || archive.ReadMode != StorageReadRestoreRequired {
		t.Fatalf("archive transition: %#v %v", archive, err)
	}
	if _, _, err := service.Content(owner, object.ID, 0); !errors.Is(err, ErrArchiveRestoreRequired) {
		t.Fatalf("archived content did not fail closed: %v", err)
	}

	hot, err := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassHot)
	if err != nil || hot.Status != "completed" || hot.ReadMode != StorageReadImmediate {
		t.Fatalf("restore transition: %#v %v", hot, err)
	}
	_, restored, err := service.Content(owner, object.ID, 0)
	if err != nil || string(restored) != string(body) {
		t.Fatalf("restored content: %q %v", restored, err)
	}
	transitions, err := service.StorageTransitions(owner, "cloud", object.ID)
	if err != nil || len(transitions) != 3 {
		t.Fatalf("transition history: %#v %v", transitions, err)
	}

	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	restartedObject, err := restarted.Get(owner, object.ID)
	if err != nil || restartedObject.StorageClass != StorageClassHot || restartedObject.StorageClassVersion != 4 {
		t.Fatalf("restarted lifecycle state: %#v %v", restartedObject, err)
	}
}

func TestStorageLifecycleFailureRetryAndBinding(t *testing.T) {
	dir := t.TempDir()
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}, fail: true}
	service, err := New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store})
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "retry.bin", Content: []byte("retry")})
	if err != nil {
		t.Fatal(err)
	}
	failed, err := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassCold)
	if err == nil || failed.Status != "failed" || failed.LastError == "" || failed.Attempts != 1 {
		t.Fatalf("failed transition truth: %#v %v", failed, err)
	}
	current, _ := service.Get(owner, object.ID)
	if current.StorageClass != StorageClassHot {
		t.Fatalf("provider failure mutated object class: %#v", current)
	}
	if _, err := service.RetryStorageTransition(context.Background(), owner, "docs", failed.ID); !errors.Is(err, ErrDenied) {
		t.Fatalf("cross-product lifecycle retry accepted: %v", err)
	}
	store.setFailure(false)
	completed, err := service.RetryStorageTransition(context.Background(), owner, "cloud", failed.ID)
	if err != nil || completed.Status != "completed" || completed.Attempts != 2 {
		t.Fatalf("retry transition: %#v %v", completed, err)
	}

	store.mu.Lock()
	store.mismatch = true
	store.mu.Unlock()
	bad, err := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassArchive)
	if err == nil || bad.Status != "failed" {
		t.Fatalf("mismatched provider result accepted: %#v %v", bad, err)
	}
	current, _ = service.Get(owner, object.ID)
	if current.StorageClass != StorageClassCold {
		t.Fatalf("binding failure mutated object class: %#v", current)
	}
	if _, err := service.SetTrash(owner, object.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteObject(owner, object.ID); err == nil || !strings.Contains(err.Error(), "lifecycle transition") {
		t.Fatalf("failed lifecycle allowed permanent deletion: %v", err)
	}
	if _, err := service.EraseProductData(context.Background(), owner, "cloud"); err == nil || !strings.Contains(err.Error(), "lifecycle transition") {
		t.Fatalf("failed lifecycle allowed product erasure: %v", err)
	}
	store.mu.Lock()
	store.mismatch = false
	store.mu.Unlock()
	resolved, err := service.RetryStorageTransition(context.Background(), owner, "cloud", bad.ID)
	if err != nil || resolved.Status != "completed" {
		t.Fatalf("failed lifecycle resolution: %#v %v", resolved, err)
	}
	if err := service.DeleteObject(owner, object.ID); err != nil {
		t.Fatalf("resolved lifecycle blocked deletion: %v", err)
	}
}

func TestStorageLifecycleConcurrentNewVersionPreservesVersionTruth(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{})
	release := make(chan struct{})
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}, started: started, release: release}
	service, err := New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "docs", Kind: KindDoc, Name: "concurrent.txt", Content: []byte("v1")})
	if err != nil {
		t.Fatal(err)
	}
	type lifecycleResult struct {
		transition StorageTransition
		err        error
	}
	result := make(chan lifecycleResult, 1)
	go func() {
		transition, transitionErr := service.TransitionStorageClass(context.Background(), owner, "docs", doc.ID, StorageClassArchive)
		result <- lifecycleResult{transition: transition, err: transitionErr}
	}()
	<-started
	updated, err := service.SaveDocument(context.Background(), owner, doc.ID, SaveDocumentRequest{BaseVersion: 1, Content: []byte("v2")})
	if err != nil {
		t.Fatal(err)
	}
	close(release)
	completed := <-result
	if completed.err != nil || completed.transition.Status != "completed" || completed.transition.Version != 1 {
		t.Fatalf("concurrent lifecycle result: %#v %v", completed.transition, completed.err)
	}
	versions, err := service.Versions(owner, doc.ID)
	if err != nil || len(versions) != 2 {
		t.Fatalf("concurrent versions: %#v %v", versions, err)
	}
	var v1, v2 Version
	for _, version := range versions {
		if version.Number == 1 {
			v1 = version
		} else if version.Number == 2 {
			v2 = version
		}
	}
	if v1.StorageClass != StorageClassArchive || v1.StorageReadMode != StorageReadRestoreRequired || v2.StorageClass != StorageClassHot || v2.StorageReadMode != StorageReadImmediate || updated.StorageClass != StorageClassHot {
		t.Fatalf("version lifecycle contamination: v1=%#v v2=%#v object=%#v", v1, v2, updated)
	}
	if _, body, err := service.Content(owner, doc.ID, 0); err != nil || string(body) != "v2" {
		t.Fatalf("current version content: %q %v", body, err)
	}
	if _, _, err := service.Content(owner, doc.ID, 1); !errors.Is(err, ErrArchiveRestoreRequired) {
		t.Fatalf("archived historical version was readable: %v", err)
	}
}

func TestStorageLifecycleBlocksDeletionAndErasureWhilePending(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{})
	release := make(chan struct{})
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}, started: started, release: release}
	service, err := New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store})
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "pending.bin", Content: []byte("pending")})
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, transitionErr := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassCold)
		result <- transitionErr
	}()
	<-started
	if _, err := service.SetTrash(owner, object.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteObject(owner, object.ID); err == nil || !strings.Contains(err.Error(), "lifecycle transition") {
		t.Fatalf("pending lifecycle allowed permanent deletion: %v", err)
	}
	if _, err := service.EraseProductData(context.Background(), owner, "cloud"); err == nil || !strings.Contains(err.Error(), "lifecycle transition") {
		t.Fatalf("pending lifecycle allowed product erasure: %v", err)
	}
	close(release)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteObject(owner, object.ID); err != nil {
		t.Fatalf("completed lifecycle blocked deletion: %v", err)
	}
}

func TestStorageLifecycleCopyOnWriteForDeduplicatedBlob(t *testing.T) {
	dir := t.TempDir()
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}}
	service, err := New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store})
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("shared-tier-content")
	first, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "first.bin", Content: body})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "second.bin", Content: body})
	if err != nil {
		t.Fatal(err)
	}
	firstVersions, _ := service.Versions(owner, first.ID)
	secondVersions, _ := service.Versions(owner, second.ID)
	sharedRef := firstVersions[0].BlobPath
	if sharedRef != secondVersions[0].BlobPath {
		t.Fatal("fixture did not deduplicate content")
	}
	transition, err := service.TransitionStorageClass(context.Background(), owner, "cloud", first.ID, StorageClassCold)
	if err != nil {
		t.Fatal(err)
	}
	if !transition.CopyRequired || transition.ResultRef == "" || transition.ResultRef == sharedRef {
		t.Fatalf("shared lifecycle transition did not copy on write: %#v", transition)
	}
	firstVersions, _ = service.Versions(owner, first.ID)
	secondVersions, _ = service.Versions(owner, second.ID)
	if firstVersions[0].BlobPath == secondVersions[0].BlobPath || firstVersions[0].StorageClass != StorageClassCold || secondVersions[0].StorageClass != StorageClassHot {
		t.Fatalf("tier isolation failed: first=%#v second=%#v", firstVersions[0], secondVersions[0])
	}
	_, firstBody, err := service.Content(owner, first.ID, 0)
	if err != nil || string(firstBody) != string(body) {
		t.Fatalf("tiered copy content mismatch: %q %v", firstBody, err)
	}
	_, secondBody, err := service.Content(owner, second.ID, 0)
	if err != nil || string(secondBody) != string(body) {
		t.Fatalf("original dedup content mismatch: %q %v", secondBody, err)
	}
}

func TestStorageLifecycleUnsupportedAndAuthorization(t *testing.T) {
	service := testService(t, nil)
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "unsupported.bin", Content: []byte("x")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionStorageClass(context.Background(), owner, "docs", object.ID, StorageClassCold); !errors.Is(err, ErrDenied) {
		t.Fatalf("cross-product lifecycle transition accepted: %v", err)
	}
	transition, err := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassCold)
	if err == nil || transition.Status != "failed" || !errors.Is(err, ErrArchiveRestoreRequired) && err.Error() != "storage lifecycle provider unavailable" {
		t.Fatalf("unsupported lifecycle truth: %#v %v", transition, err)
	}
	if _, err := service.TransitionStorageClass(context.Background(), viewer, "cloud", object.ID, StorageClassArchive); !errors.Is(err, ErrDenied) {
		t.Fatalf("non-owner lifecycle change accepted: %v", err)
	}
	folder, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFolder, Name: "folder"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionStorageClass(context.Background(), owner, "cloud", folder.ID, StorageClassCold); !errors.Is(err, ErrDenied) {
		t.Fatalf("folder lifecycle change accepted: %v", err)
	}
}

func persistPendingTransitionForTest(t *testing.T, service *Service, object Object, target StorageClass) StorageTransition {
	t.Helper()
	service.mu.Lock()
	defer service.mu.Unlock()
	_, version, err := currentVersionIndex(service.state, object)
	if err != nil {
		t.Fatal(err)
	}
	now := service.cfg.Now()
	transition := StorageTransition{
		ID:           newID("storage-transition"),
		Product:      object.Product,
		Owner:        object.Owner,
		ObjectID:     object.ID,
		Version:      version.Number,
		Ref:          version.BlobPath,
		Hash:         version.Hash,
		From:         normalizedVersionStorageClass(version),
		To:           target,
		CopyRequired: physicalReferenceCount(service.state, version.BlobPath, version.Hash) > 1,
		Status:       "pending",
		Attempts:     1,
		RequestedAt:  now,
		UpdatedAt:    now,
	}
	service.state.StorageTransitions[transition.ID] = transition
	if err := saveState(service.cfg.StatePath, &service.state); err != nil {
		t.Fatal(err)
	}
	return transition
}

func TestStorageLifecycleWorkerRecoversPendingAfterRestart(t *testing.T) {
	dir := t.TempDir()
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}}
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "orphan.bin", Content: []byte("orphan")})
	if err != nil {
		t.Fatal(err)
	}
	orphan := persistPendingTransitionForTest(t, service, object, StorageClassCold)

	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	result, err := restarted.RecoverPendingStorageTransitions(context.Background(), 1)
	if err != nil || result.Claimed != 1 || result.Completed != 1 || result.Failed != 0 || len(result.TransitionIDs) != 1 || result.TransitionIDs[0] != orphan.ID {
		t.Fatalf("pending recovery result: %#v %v", result, err)
	}
	transitions, err := restarted.StorageTransitions(owner, "cloud", object.ID)
	if err != nil || len(transitions) != 1 || transitions[0].Status != "completed" || transitions[0].Attempts != 2 {
		t.Fatalf("pending recovery truth: %#v %v", transitions, err)
	}
	recoveredObject, err := restarted.Get(owner, object.ID)
	if err != nil || recoveredObject.StorageClass != StorageClassCold || recoveredObject.StorageClassVersion != 2 {
		t.Fatalf("pending recovery object: %#v %v", recoveredObject, err)
	}
	foundAudit := false
	for _, event := range restarted.state.Audit {
		if event.Action == "storage.transition.recovered" && event.ObjectID == object.ID {
			foundAudit = true
			break
		}
	}
	if !foundAudit {
		t.Fatal("pending recovery audit event missing")
	}

	restartedAgain, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	empty, err := restartedAgain.RecoverPendingStorageTransitions(context.Background(), 8)
	if err != nil || empty.Claimed != 0 {
		t.Fatalf("completed transition was reclaimed after restart: %#v %v", empty, err)
	}
}

func TestStorageLifecycleWorkerDoesNotDoubleExecuteActiveTransition(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{})
	release := make(chan struct{})
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}, started: started, release: release}
	service, err := New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store})
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "active.bin", Content: []byte("active")})
	if err != nil {
		t.Fatal(err)
	}
	transitionResult := make(chan error, 1)
	go func() {
		_, transitionErr := service.TransitionStorageClass(context.Background(), owner, "cloud", object.ID, StorageClassCold)
		transitionResult <- transitionErr
	}()
	<-started
	workerResult, err := service.RecoverPendingStorageTransitions(context.Background(), 8)
	if err != nil || workerResult.Claimed != 0 {
		t.Fatalf("worker double-claimed active transition: %#v %v", workerResult, err)
	}
	close(release)
	if err := <-transitionResult; err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	calls := len(store.calls)
	store.mu.Unlock()
	if calls != 1 {
		t.Fatalf("active transition executed %d provider calls", calls)
	}
}

func TestStorageLifecycleWorkerFailureDoesNotHotLoop(t *testing.T) {
	dir := t.TempDir()
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}, fail: true}
	service, err := New(Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store})
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "failed-worker.bin", Content: []byte("failure")})
	if err != nil {
		t.Fatal(err)
	}
	orphan := persistPendingTransitionForTest(t, service, object, StorageClassArchive)
	result, err := service.RecoverPendingStorageTransitions(context.Background(), 8)
	if err != nil || result.Claimed != 1 || result.Completed != 0 || result.Failed != 1 {
		t.Fatalf("worker failure truth: %#v %v", result, err)
	}
	transitions, err := service.StorageTransitions(owner, "cloud", object.ID)
	if err != nil || len(transitions) != 1 || transitions[0].ID != orphan.ID || transitions[0].Status != "failed" || transitions[0].Attempts != 2 {
		t.Fatalf("worker failed transition: %#v %v", transitions, err)
	}
	second, err := service.RecoverPendingStorageTransitions(context.Background(), 8)
	if err != nil || second.Claimed != 0 {
		t.Fatalf("failed transition hot-looped: %#v %v", second, err)
	}
	store.mu.Lock()
	calls := len(store.calls)
	store.mu.Unlock()
	if calls != 1 {
		t.Fatalf("failed transition executed %d provider calls", calls)
	}
}

func TestStorageLifecycleWorkerCancellationRemainsRecoverable(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{})
	release := make(chan struct{})
	store := &lifecycleTestStore{LocalObjectStore: LocalObjectStore{Root: filepath.Join(dir, "objects")}, started: started, release: release}
	cfg := Config{StatePath: filepath.Join(dir, "state.json"), ObjectDir: filepath.Join(dir, "objects"), ObjectStore: store}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	object, err := service.Create(context.Background(), owner, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "interrupted-worker.bin", Content: []byte("interrupted")})
	if err != nil {
		t.Fatal(err)
	}
	pending := persistPendingTransitionForTest(t, service, object, StorageClassCold)

	type workerOutcome struct {
		result StorageTransitionWorkerResult
		err    error
	}
	ctx, cancel := context.WithCancel(context.Background())
	outcomes := make(chan workerOutcome, 1)
	go func() {
		result, workerErr := service.RecoverPendingStorageTransitions(ctx, 1)
		outcomes <- workerOutcome{result: result, err: workerErr}
	}()
	<-started
	cancel()
	outcome := <-outcomes
	if !errors.Is(outcome.err, context.Canceled) || outcome.result.Claimed != 1 || outcome.result.Completed != 0 || outcome.result.Failed != 0 || outcome.result.Interrupted != 1 {
		t.Fatalf("canceled worker result: %#v %v", outcome.result, outcome.err)
	}
	transitions, err := service.StorageTransitions(owner, "cloud", object.ID)
	if err != nil || len(transitions) != 1 || transitions[0].ID != pending.ID || transitions[0].Status != "pending" || transitions[0].Attempts != 2 || !strings.Contains(transitions[0].LastError, "recovery pending") {
		t.Fatalf("canceled worker transition truth: %#v %v", transitions, err)
	}
	foundAudit := false
	for _, event := range service.state.Audit {
		if event.Action == "storage.transition.interrupted" && event.ObjectID == object.ID {
			foundAudit = true
			break
		}
	}
	if !foundAudit {
		t.Fatal("interrupted transition audit event missing")
	}

	close(release)
	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := restarted.RecoverPendingStorageTransitions(context.Background(), 1)
	if err != nil || recovered.Claimed != 1 || recovered.Completed != 1 || recovered.Failed != 0 || recovered.Interrupted != 0 {
		t.Fatalf("interrupted transition restart recovery: %#v %v", recovered, err)
	}
	transitions, err = restarted.StorageTransitions(owner, "cloud", object.ID)
	if err != nil || len(transitions) != 1 || transitions[0].Status != "completed" || transitions[0].Attempts != 3 {
		t.Fatalf("interrupted transition final truth: %#v %v", transitions, err)
	}
}

func TestStorageLifecycleWorkerBoundsAndCancellation(t *testing.T) {
	service := testService(t, nil)
	if _, err := service.RecoverPendingStorageTransitions(context.Background(), 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("zero worker batch accepted: %v", err)
	}
	if _, err := service.RecoverPendingStorageTransitions(context.Background(), 65); !errors.Is(err, ErrInvalid) {
		t.Fatalf("oversized worker batch accepted: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.RecoverPendingStorageTransitions(ctx, 1); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled worker context accepted: %v", err)
	}
}

func TestSchemaV6MigratesStorageLifecycleDefaultsToV7(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	state := newState()
	state.SchemaVersion = 6
	state.StorageTransitions = nil
	now := time.Now().UTC()
	state.Objects["legacy"] = Object{ID: "legacy", Product: "cloud", Owner: owner, Kind: KindFile, Name: "legacy.bin", Size: 1, Hash: hashBytes([]byte("x")), Version: 1, CreatedAt: now, UpdatedAt: now, ScanStatus: "accepted"}
	state.Versions["legacy"] = []Version{{ObjectID: "legacy", Number: 1, Hash: hashBytes([]byte("x")), Size: 1, BlobPath: filepath.Join(dir, "objects", "legacy"), Author: owner, CreatedAt: now}}
	if err := saveState(path, &state); err != nil {
		t.Fatal(err)
	}
	service, err := New(Config{StatePath: path, ObjectDir: filepath.Join(dir, "objects")})
	if err != nil {
		t.Fatal(err)
	}
	object := service.state.Objects["legacy"]
	if service.state.SchemaVersion != 7 || object.StorageClass != StorageClassHot || object.StorageClassVersion != 1 || object.StorageReadMode != StorageReadImmediate || service.state.StorageTransitions == nil {
		t.Fatalf("v6 lifecycle migration: schema=%d object=%#v transitions=%#v", service.state.SchemaVersion, object, service.state.StorageTransitions)
	}
	if _, err := os.Stat(path + ".v6.bak"); err != nil {
		t.Fatalf("v6 migration backup missing: %v", err)
	}
}
