//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func publicOwnerSessionFixture(t *testing.T) (PQLabNetworkPlan, PQLabPublicOwnerSessionOptions, []byte) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: 2, BatchSize: 1, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	p, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: filepath.Join(pqLabWorkloadTemp(t), "network"), BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(p.RootDir, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	pin := pqLabSHA(raw)
	_, migration, _, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.WriteCorpus(filepath.Join(p.RootDir, "workload"), migration); err != nil {
		t.Fatal(err)
	}
	persistPQLabTestCheckpoint(t, p, pin, nil)
	raw, err = os.ReadFile(filepath.Join(p.RootDir, "workload", "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	credential, err := os.ReadFile(filepath.Join(p.RootDir, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { clear(credential) })
	return p, PQLabPublicOwnerSessionOptions{RootDir: p.RootDir, PlanSHA256: pin, WorkloadSHA256: pqLabSHA(raw), Owners: []int{0, 1}}, credential
}

func publicOwnerState(t *testing.T, p PQLabNetworkPlan) CommittedState {
	t.Helper()
	raw, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestPQLabPublicOwnerPrepareOwnerOpensOnlySelectedCustody(t *testing.T) {
	p, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	before := publicOwnerState(t, p)
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := s.PrepareOwner(cancelled, 0, nil); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled preparation opened custody", err)
	}
	if err := s.PrepareOwner(ctx, 2, nil); err == nil {
		t.Fatal("unapproved owner prepared")
	}
	s.gates[0].mu.Lock()
	if err := s.PrepareOwner(ctx, 0, nil); !errors.Is(err, ErrPQLabPublicOwnerBusy) {
		s.gates[0].mu.Unlock()
		t.Fatal("busy owner prepared concurrently", err)
	}
	s.gates[0].mu.Unlock()
	metrics := &PQLabMetrics{}
	commands := s.Stats().Commands
	if err := s.PrepareOwner(ctx, 0, metrics); err != nil {
		t.Fatal(err)
	}
	stages := metrics.Snapshot().Stages
	if s.Stats().OpenedOwners != 1 || s.Stats().Commands != commands+1 || stages["sender.importFullPrivatePublicPair"].Calls != 1 || stages["checkpoint.loadTotal"].Calls != 0 {
		t.Fatal("preparation did not remain owner-scoped and checkpoint-free")
	}
	entries, err := os.ReadDir(filepath.Join(p.RootDir, "workload", "sender-public", "0000"))
	if err != nil || len(entries) != 0 {
		t.Fatal("preparation created or changed a sender operation", err)
	}
	other := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("e", 64), OwnerIndex: 1, FirstNonce: 2, Members: 1}
	_, err = s.Sign(ctx, other, before.Height, before.AppHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := os.ReadFile(filepath.Join(p.RootDir, "workload", "sender-public", "0001", other.OperationID, "transaction.abci"))
	if err != nil {
		t.Fatal(err)
	}
	checkpointReadApplyOriginal(t, p, options.PlanSHA256, wire)
	request := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("d", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}
	if _, err := s.Sign(ctx, request, before.Height, before.AppHash, nil); err == nil {
		t.Fatal("prepared owner accepted stale original checkpoint")
	}
	operation := filepath.Join(p.RootDir, "workload", "sender-public", "0000", request.OperationID)
	if _, err := os.Lstat(operation); !os.IsNotExist(err) {
		t.Fatal("stale checkpoint created an operation", err)
	}
	current := publicOwnerState(t, p)
	signMetrics := &PQLabMetrics{}
	result, err := s.Sign(ctx, request, current.Height, current.AppHash, signMetrics)
	if err != nil || result.OperationID != request.OperationID || signMetrics.Snapshot().Stages["sender.importFullPrivatePublicPair"].Calls != 0 || signMetrics.Snapshot().Stages["checkpoint.captureCurrentBytes"].Calls != 12 {
		t.Fatal("prepared owner did not run the original fresh-checkpoint sign", err)
	}
	if _, err := s.Sign(ctx, request, 0, "", nil); err != nil {
		t.Fatal("prepared owner lost original operation recovery", err)
	}
	if err := s.CloseOwner(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.PrepareOwner(ctx, 0, nil); err == nil {
		t.Fatal("retired owner prepared again")
	}
}

func TestPQLabPublicOwnerSessionOriginalIsolationAndWitness(t *testing.T) {
	p, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	for _, owners := range [][]int{nil, {1, 0}, {0, 0}, {-1}, {0, 2}} {
		bad := options
		bad.Owners = owners
		if s, err := OpenPQLabPublicOwnerSession(ctx, bad, credential, nil); err == nil {
			s.Close()
			t.Fatal("unapproved owner set admitted")
		}
	}
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if stats := s.Stats(); stats.OpenedOwners != 0 || stats.SourceInputs.State != "NOT_LOADED" {
		t.Fatal("startup imported keys/preloaded full validation")
	}
	state := publicOwnerState(t, p)
	var results [2]PQLabSenderResult
	var requests [2]PQLabSenderRequest
	var before [2][]byte
	for i := 0; i < 2; i++ {
		// Same original checkpoint, but an independent normal process lifetime
		// for each owner: measure only Load, never compare it to whole signing.
		cold := NewPQLabSenderCheckpointSource()
		coldMetrics := &PQLabMetrics{}
		coldState, e := cold.Load(p.RootDir, options.PlanSHA256, "", state.Height, state.AppHash, coldMetrics)
		if e != nil {
			t.Fatal(e)
		}
		coldRaw, e := encodeCommittedStateJSON(coldState.state)
		actualRaw, readErr := os.ReadFile(p.Nodes[0].StatePath)
		if e != nil || readErr != nil || !bytes.Equal(coldRaw, actualRaw) {
			t.Fatal("cold lifetime changed complete original state", e, readErr)
		}
		if e = cold.Close(); e != nil {
			t.Fatal(e)
		}
		coldStages := coldMetrics.Snapshot().Stages
		if coldStages["lab.bootstrapFullValidation"].Calls != 1 {
			t.Fatal("independent cold denominator changed")
		}
		var unblock func()
		var blocked chan error
		if i == 1 {
			// Hold A's real signer mutex while its normal Recover is in flight.
			// A second A command must be Busy, but B's actual independent sign
			// must complete before releasing A (no global session gate).
			a := s.owners[0]
			a.mu.Lock()
			var once sync.Once
			unblock = func() { once.Do(a.mu.Unlock) }
			t.Cleanup(unblock)
			blocked = make(chan error, 1)
			go func() { _, e := s.Recover(ctx, requests[0], nil); blocked <- e }()
			publicOwnerWaitGate(t, s.gates[0])
			if _, e := s.Recover(ctx, requests[0], nil); !errors.Is(e, ErrPQLabPublicOwnerBusy) {
				t.Fatal("same owner failed immediate bounded Busy", e)
			}
		}
		requests[i] = PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: i, FirstNonce: 2, Members: 1}
		metrics := &PQLabMetrics{}
		start := time.Now()
		results[i], err = s.Sign(ctx, requests[i], state.Height, state.AppHash, metrics)
		elapsed := time.Since(start)
		if err != nil {
			t.Fatal("actual independent owner sign", i, err)
		}
		if unblock != nil {
			unblock()
			if e := <-blocked; e != nil {
				t.Fatal("original owner A recovery", e)
			}
		}
		stages := metrics.Snapshot().Stages
		want := uint64(0)
		if i == 0 {
			want = 1
		}
		if stages["lab.bootstrapFullValidation"].Calls != want || stages["sender.importFullPrivatePublicPair"].Calls != 1 || stages["checkpoint.captureCurrentBytes"].Calls != 12 {
			t.Fatal("cold/steady validation or original current/pair denominator changed", i, stages)
		}
		t.Logf("PUBLIC_OWNER_SHARED owner=%d beforeBootstrap=1 afterBootstrap=%d currentCaptures=%d importedPairs=1 beforeLoadNS=%d afterLoadNS=%d actualSignElapsedNS=%d stateBytes=%d stateSHA=%s syntheticOnly=true performanceQualification=false", i, want, stages["checkpoint.captureCurrentBytes"].Calls, coldStages["checkpoint.loadTotal"].ElapsedNS, stages["checkpoint.loadTotal"].ElapsedNS, elapsed.Nanoseconds(), len(coldRaw), pqLabSHA(coldRaw))
		path, _ := s.owners[i].operation(requests[i].OperationID)
		before[i], err = os.ReadFile(filepath.Join(path, "transaction.abci"))
		if err != nil {
			t.Fatal(err)
		}
		if results[i].AuthorityGranted || results[i].OwnerIndex != i {
			t.Fatal("owner result authority/identity changed")
		}
	}
	if bytes.Equal(s.owners[0].public.PKA, s.owners[1].public.PKA) || bytes.Equal(s.owners[0].public.PKB, s.owners[1].public.PKB) || bytes.Equal(s.owners[0].historyKey, s.owners[1].historyKey) {
		t.Fatal("private pair/history namespace crossed owners")
	}
	if s.checkpoints.CacheStats().Misses != 1 {
		t.Fatal("different owner rebuilt original public witness")
	}
	unknown := requests[0]
	unknown.OperationID = strings.Repeat("b", 64)
	if _, err = s.Sign(ctx, unknown, state.Height, state.AppHash, nil); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("unconfirmed owner escaped original UNKNOWN", err)
	}
	changed := requests[0]
	changed.FirstNonce++
	if _, err = s.Sign(ctx, changed, 0, "", nil); err == nil {
		t.Fatal("operation body changed during recovery", err)
	}
	if _, err = s.Sign(ctx, PQLabSenderRequest{Version: requests[0].Version, OwnerIndex: 2}, state.Height, state.AppHash, nil); err == nil || s.Stats().OpenedOwners != 2 {
		t.Fatal("unapproved owner opened custody")
	}
	// Repeated A commands consume only A's bounded admission budget. They do
	// not exhaust B's approved capacity or prevent physical A retirement.
	for count := uint64(0); count <= s.gates[0].budget; count++ {
		if _, err = s.Recover(ctx, requests[0], nil); err != nil {
			break
		}
	}
	if err == nil {
		t.Fatal("owner command budget was unbounded")
	}
	if err = s.CloseOwner(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Recover(ctx, requests[0], nil); err == nil {
		t.Fatal("retired owner resurrected")
	}
	recovered, err := s.Sign(ctx, requests[1], 0, "", nil)
	if err != nil || recovered.Transaction != results[1].Transaction {
		t.Fatal("peer owner failed exact original recovery without new checkpoint", err)
	}
	for _, tx := range before {
		checkpointReadApplyOriginal(t, p, options.PlanSHA256, tx)
	}
	current := publicOwnerState(t, p)
	for i := 0; i < 2; i++ {
		at, ok := accountIndex(current.Accounts, s.manifest.Owners[i].Owner)
		if !ok || current.Accounts[at].Nonce != 2 {
			t.Fatal("actual independent nonce lost")
		}
	}
	badNonce := requests[1]
	badNonce.OperationID = strings.Repeat("c", 64)
	if _, err = s.Sign(ctx, badNonce, current.Height, current.AppHash, nil); err == nil {
		t.Fatal("fresh actual nonce was cached")
	}
	// A stale exact original migration inode cannot lend its witness to another
	// request even when replaced with byte-identical public bytes.
	migration, err := os.ReadFile(p.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(p.MigrationFile, p.MigrationFile+".preserved"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(p.MigrationFile, migration, 0600); err != nil {
		t.Fatal(err)
	}
	badNonce.FirstNonce = 3
	if _, err = s.Sign(ctx, badNonce, current.Height, current.AppHash, nil); err == nil {
		t.Fatal("foreign inode reused immutable witness")
	}
	for i := 0; i < 2; i++ {
		path, _ := s.owners[i].operation(requests[i].OperationID)
		now, e := os.ReadFile(filepath.Join(path, "transaction.abci"))
		if e != nil || !bytes.Equal(now, before[i]) {
			t.Fatal("failed/current/close path changed original transaction", e)
		}
	}
	// Source Close must retire admission and join the COMPLETE owner call,
	// not merely the public reader's short current-file critical section.
	b := s.owners[1]
	b.mu.Lock()
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(b.mu.Unlock) }
	t.Cleanup(release)
	inflight := make(chan error, 1)
	go func() { _, e := s.Recover(ctx, requests[1], nil); inflight <- e }()
	publicOwnerWaitGate(t, s.gates[1])
	closing := make(chan error, 1)
	go func() { closing <- s.Close() }()
	select {
	case e := <-closing:
		t.Fatal("source closed before owner drained", e)
	case <-time.After(20 * time.Millisecond):
	}
	if _, err = s.Recover(ctx, requests[0], nil); err == nil {
		t.Fatal("retired source accepted new read")
	}
	release()
	if e := <-inflight; !errors.Is(e, ErrPQLabSenderUnknown) {
		t.Fatal("retired in-flight result promoted to success", e)
	}
	if err = <-closing; err != nil {
		t.Fatal(err)
	}
	if len(s.credential) != 0 || !s.checkpoints.closed || !s.public.closed {
		t.Fatal("source close retained secrets or public descriptors")
	}
	for _, sender := range s.owners {
		if sender != nil && (sender.key != nil || sender.lease != nil || len(sender.historyKey) != 0) {
			t.Fatal("owner custody not physically closed")
		}
	}
}

func TestPQLabPublicOwnerSessionProofAndOwnerRetirement(t *testing.T) {
	root := filepath.Join(pqLabWorkloadTemp(t), "network")
	p, export, _ := pqLabLiveMaterialsFixture(t, root)
	manifest, err := os.ReadFile(filepath.Join(root, "workload", "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	credential, err := os.ReadFile(filepath.Join(root, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, PQLabPublicOwnerSessionOptions{RootDir: root, PlanSHA256: export.PlanSHA256, ActivationSHA256: export.ActivationSHA256, WorkloadSHA256: pqLabSHA(manifest), Owners: []int{0, 1}}, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: 0, FirstNonce: 2, Members: 2}
	b := PQLabSenderRequest{Version: a.Version, OperationID: strings.Repeat("b", 64), OwnerIndex: 1, FirstNonce: 2, Members: 1}
	if _, err = s.Recover(ctx, a, nil); err != nil {
		t.Fatal(err)
	}
	saved, err := s.Recover(ctx, b, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Confirm(ctx, a, PQLabProofMaterials{}, PQTransactionProofRequest{}, time.Now().UTC(), nil); err == nil {
		t.Fatal("absent proof released owner A")
	}
	if err = s.CloseOwner(ctx, 0); err != nil {
		t.Fatal(err)
	}
	export.TransactionFile = filepath.Join(root, "workload", "sender-public", "0001", b.OperationID, "transaction.abci")
	export.TransactionSHA256 = saved.Transaction.Envelope.SHA256
	export.NativeWireHash = strings.TrimPrefix(saved.Transaction.NativeHash, "0x")
	export.OutputDir = filepath.Join(root, "owner-b-public-proof")
	receipt, err := ExportPQLabProof(export, time.Now().UTC())
	if err != nil {
		t.Fatal("normal original four-store proof export", err)
	}
	_ = receipt
	raw, err := os.ReadFile(filepath.Join(export.OutputDir, "materials.json"))
	if err != nil {
		t.Fatal(err)
	}
	materials, err := DecodePQLabProofMaterials(raw, pqLabSHA(raw))
	if err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(filepath.Join(export.OutputDir, "proof.json"))
	if err != nil {
		t.Fatal(err)
	}
	proof, err := DecodePQTransactionProofRequest(raw)
	if err != nil {
		t.Fatal(err)
	}
	confirmed, err := s.Confirm(ctx, b, materials, proof, time.Now().UTC(), nil)
	if err != nil || !confirmed.Result.Finalized || !confirmed.Result.ExecutionSuccessful || confirmed.Result.NativeGrant || confirmed.AuthorityGranted {
		t.Fatal("peer owner original full proof blocked by retired UNKNOWN owner", err)
	}
	if _, err = os.Stat(filepath.Join(root, "workload", "sender-public", "0000", a.OperationID, "CONFIRMED.json")); !os.IsNotExist(err) {
		t.Fatal("owner B proof confirmed owner A")
	}
	// No external Finalize/Commit occurs here: all four current files must still
	// match the original stopped proof-producing execution.
	state := publicOwnerState(t, p)
	if state.Height != materials.EngineHeight {
		t.Fatal("proof detached from actual checkpoint")
	}
}

func publicOwnerWaitGate(t *testing.T, gate *pqLabPublicOwnerGate) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for gate.mu.TryLock() {
		gate.mu.Unlock()
		if time.Now().After(deadline) {
			t.Fatal("actual owner call failed to enter its gate")
		}
		time.Sleep(time.Millisecond)
	}
}
