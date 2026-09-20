package chain

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"
)

// The old test covered only simultaneous readers. A queued peer-observation
// writer makes sync.RWMutex block every *new* reader until persistence finishes.
func TestCheckpointIOAllowsPeerWriterAndRPCReads(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tx, err := d.Faucet("rpc-latency-old-recipient", 100)
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		finished <- d.persistSnapshotWithWriter(func(snapshot devnetSnapshot) error {
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	defer func() {
		close(release)
		if err := <-finished; err != nil {
			t.Error(err)
		}
	}()
	written := make(chan struct{})
	go func() {
		// The same short write-lock boundary as RecordValidatorPeerSync.
		d.mu.Lock()
		d.validatorPeerSyncs["local-probe"] = ValidatorPeerSync{Status: "synced"}
		d.mu.Unlock()
		close(written)
	}()
	select {
	case <-written:
	case <-time.After(250 * time.Millisecond):
		t.Error("peer writer waits for checkpoint I/O and therefore queues all later RPC reads")
		return
	}
	read := make(chan struct{})
	go func() {
		_ = d.Config()
		_ = d.LatestBlock()
		_ = d.EthereumNativeTransfersEnabled()
		_, proof, ok := d.TransactionWithDurability(tx.Hash)
		if !ok || proof.Status != "durable" {
			t.Error("unchanged completed receipt lost proof")
		}
		close(read)
	}()
	select {
	case <-read:
	case <-time.After(250 * time.Millisecond):
		t.Error("RPC read waits for checkpoint I/O")
	}
}

func TestDetachedSnapshotPreservesTypedStateWithoutAliases(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet("large-exact-balance", 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	d.mu.Lock()
	// Synthetic precision fixture only; no public funding or minted assets.
	d.accounts["large-exact-balance"].Balance = 9007199254740993
	want := d.snapshotLocked()
	detached, err := d.detachedSnapshotLocked()
	if err != nil {
		d.mu.Unlock()
		t.Fatal(err)
	}
	// SavedAt is sampled separately, not a mutation of the persisted state.
	detached.SavedAt = want.SavedAt
	before, _ := json.Marshal(want)
	got, _ := json.Marshal(detached)
	if !bytes.Equal(before, got) {
		d.mu.Unlock()
		t.Fatal("snapshot wire schema/value changed")
	}
	d.accounts["large-exact-balance"].Balance++
	d.accounts["large-exact-balance"].Lots["live-only"] = 7
	d.blocks[1].Transactions[0].Amount++
	d.blocks[1].Transactions[0].Logs[0].Topics[0] = "live-only"
	d.validatorPeerSyncs["live-only"] = ValidatorPeerSync{Status: "changed"}
	d.mu.Unlock()
	after, _ := json.Marshal(detached)
	if !bytes.Equal(got, after) {
		t.Fatal("detached snapshot still aliases live maps, transactions or nested logs")
	}
	if detached.Accounts["large-exact-balance"].Balance != 9007199254740993 {
		t.Fatal("integer precision was lost")
	}
	// Guard the explicit fast-path copy against a future new reference field.
	typ := reflect.TypeOf(Block{})
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if f.Name == "Transactions" {
			continue
		}
		switch f.Type.Kind() {
		case reflect.Slice, reflect.Map, reflect.Pointer, reflect.Interface:
			t.Fatalf("new Block reference %s needs detached snapshot cloning", f.Name)
		}
	}
}

func TestDetachedCheckpointCannotOverwriteLaterMutation(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	first := make(chan error, 1)
	go func() {
		first <- d.persistSnapshotWithWriter(func(snapshot devnetSnapshot) error {
			close(entered)
			<-release
			return d.persistPreparedSnapshotSerialized(snapshot)
		})
	}()
	<-entered
	later := make(chan error, 1)
	admitted := make(chan struct{})
	go func() {
		d.mu.Lock()
		d.account("later-mutation").Balance = 100
		close(admitted)
		err := d.persistSnapshotLocked()
		d.mu.Unlock()
		later <- err
	}()
	<-admitted
	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if err := <-later; err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(d.snapshotPath())
	if err != nil {
		t.Fatal(err)
	}
	var snapshot devnetSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Accounts["later-mutation"] == nil || snapshot.Accounts["later-mutation"].Balance != 100 {
		t.Fatal("older checkpoint overwrote later committed mutation")
	}
	if err := validateDevnetSnapshotIntegrity(snapshot); err != nil {
		t.Fatal(err)
	}
	cold, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), d.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	acct, ok := cold.Account("later-mutation")
	if !ok || acct.Balance != 100 {
		t.Fatal("cold recovery lost mutation")
	}
}

func TestCheckpointConcurrentReadLatency(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	tx, err := d.Faucet("read-load-recipient", 100)
	if err != nil {
		t.Fatal(err)
	}
	for range 100_000 {
		d.ProduceBlock()
	}
	d.dataDir = t.TempDir()
	if err := d.persistSnapshot(); err != nil {
		t.Fatal(err)
	}
	var latencies []time.Duration
	var mu sync.Mutex
	for round := 0; round < 3; round++ {
		stop, peerDone := make(chan struct{}), make(chan struct{})
		go func() {
			defer close(peerDone)
			for {
				select {
				case <-stop:
					return
				default:
				}
				d.mu.Lock()
				d.validatorPeerSyncs["latency-probe"] = ValidatorPeerSync{Status: "synced"}
				d.mu.Unlock()
				time.Sleep(time.Millisecond)
			}
		}()
		checkpoint := make(chan error, 1)
		go func() { checkpoint <- d.persistSnapshot() }()
		var users sync.WaitGroup
		for user := 0; user < 3; user++ {
			users.Add(1)
			go func() {
				defer users.Done()
				for range 30 {
					started := time.Now()
					_ = d.Config()
					_ = d.LatestBlock()
					_, proof, found := d.TransactionWithDurability(tx.Hash)
					if !found || proof.Status != "durable" {
						t.Error("existing receipt is not durable")
					}
					elapsed := time.Since(started)
					mu.Lock()
					latencies = append(latencies, elapsed)
					mu.Unlock()
					time.Sleep(time.Millisecond)
				}
			}()
		}
		users.Wait()
		if err := <-checkpoint; err != nil {
			t.Error(err)
		}
		close(stop)
		<-peerDone
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	t.Logf("local synthetic 100000-block history, 3 rounds x 3 readers x 30 reads: n=%d p50=%s p95=%s max=%s; no public SLO claim", len(latencies), latencies[len(latencies)/2], latencies[(len(latencies)*95+99)/100-1], latencies[len(latencies)-1])
}
