package main_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
)

func participationStatusWant(t *testing.T, service *participation.Service, code string, wallet, stopped bool, entries, unknown string) {
	t.Helper()
	got := service.LocalStatus()
	want := participation.LocalStatus{Code: code, Configured: true, WalletPublisherConfigured: wallet, Stopped: stopped, Entries: entries, UnknownEntries: unknown}
	if got != want {
		t.Fatalf("local participation status: got %+v want %+v", got, want)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var jsonFields map[string]any
	if err = json.Unmarshal(raw, &jsonFields); err != nil || len(jsonFields) != 6 {
		t.Fatalf("unexpected status schema: %s %v", raw, err)
	}
	if jsonFields["entries"] != entries || jsonFields["unknownEntries"] != unknown {
		t.Fatalf("counts must be exact decimal JSON strings: %s", raw)
	}
	for _, name := range []string{"authority", "walletApproval", "nativeGrant", "independentFinality", "fundsVerified"} {
		if _, exists := jsonFields[name]; exists {
			t.Fatalf("local adapter status created an authority field: %s", raw)
		}
	}
}

func participationStatusNoEffects(t *testing.T, f *participationFixture) {
	t.Helper()
	if publishes, signatures, lookups := f.counts(); publishes != 0 || signatures != 0 || lookups != 0 {
		t.Fatalf("read-only status triggered original Wallet activity: publish=%d signature=%d lookup=%d", publishes, signatures, lookups)
	}
}

func participationStatusUnchanged(t *testing.T, f *participationFixture, check func()) {
	t.Helper()
	before, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(f.path)
	if err != nil {
		t.Fatal(err)
	}
	lock, err := os.ReadFile(f.path + ".owner.lock")
	if err != nil {
		t.Fatal(err)
	}
	check()
	after, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(f.path)
	if err != nil {
		t.Fatal(err)
	}
	afterLock, err := os.ReadFile(f.path + ".owner.lock")
	if err != nil || !bytes.Equal(before, after) || !info.ModTime().Equal(afterInfo.ModTime()) || !os.SameFile(info, afterInfo) || !bytes.Equal(lock, afterLock) {
		t.Fatalf("status changed journal bytes, inode, modification time or owner marker: %v", err)
	}
	participationStatusNoEffects(t, f)
}

func TestP09ParticipationLocalStatusAssemblyLifecycle(t *testing.T) {
	for _, withWallet := range []bool{false, true} {
		name, code := "original-wallet-absent", "UNSUPPORTED"
		if withWallet {
			name, code = "isolated-original-wallet-adapter", "CONFIGURED"
		}
		t.Run(name, func(t *testing.T) {
			f := newParticipationFixture(t, withWallet)
			participationStatusUnchanged(t, f, func() {
				participationStatusWant(t, f.service, code, withWallet, false, "0", "0")
			})
			entry, err := f.service.Prepare(context.Background(), f.request("status-only-prepared"))
			if withWallet && (err != nil || entry.State != participation.Prepared) || !withWallet && (!errors.Is(err, participation.ErrUnsupported) || entry.State != participation.Unsupported) {
				t.Fatalf("original prepare flow: %+v %v", entry, err)
			}
			// Closing the fixture HTTP source proves status does not need a live
			// reader, remote capabilities, lookup or signing/publishing service.
			f.server.Close()
			participationStatusUnchanged(t, f, func() {
				for i := 0; i < 16; i++ {
					participationStatusWant(t, f.service, code, withWallet, false, "1", "0")
				}
			})
			if err = f.service.Close(); err != nil {
				t.Fatal(err)
			}
			participationStatusUnchanged(t, f, func() {
				participationStatusWant(t, f.service, "UNAVAILABLE", withWallet, false, "1", "0")
			})
			var wallet participation.Wallet
			if withWallet {
				wallet = f.wallet
			}
			reopened, err := participation.New(f.path, f.reader, wallet)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = reopened.Close() })
			participationStatusUnchanged(t, f, func() {
				participationStatusWant(t, reopened, code, withWallet, false, "1", "0")
			})
			if original, ok := reopened.Get(entry.ID); !ok || original.State != participation.Revoked {
				t.Fatal("normal restart did not preserve the retired original metadata")
			}
			if err = reopened.Revoke(); err != nil {
				t.Fatal(err)
			}
			participationStatusUnchanged(t, f, func() {
				participationStatusWant(t, reopened, "REVOKED", withWallet, true, "1", "0")
			})
			if err = reopened.Close(); err != nil {
				t.Fatal(err)
			}
			participationStatusWant(t, reopened, "UNAVAILABLE", withWallet, true, "1", "0")
			stillRevoked, err := participation.New(f.path, f.reader, wallet)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = stillRevoked.Close() })
			participationStatusUnchanged(t, f, func() {
				participationStatusWant(t, stillRevoked, "REVOKED", withWallet, true, "1", "0")
			})
		})
	}
}

func TestP09ParticipationLocalStatusUnknownJournal(t *testing.T) {
	f := newParticipationFixture(t, true)
	entries := make([]participation.Entry, 3)
	for i, name := range []string{"fixture-unknown", "fixture-awaiting-wallet", "fixture-retired"} {
		f.mu.Lock()
		f.nonce = uint64(i + 1)
		f.mu.Unlock()
		entry, err := f.service.Prepare(context.Background(), f.request(name))
		if err != nil {
			t.Fatal(err)
		}
		entries[i] = entry
	}
	if err := f.service.Close(); err != nil {
		t.Fatal(err)
	}
	// This isolated local journal fixture contains genuine Prepare-bound
	// descriptors. Seeding historical states offline avoids calling Publish or
	// signing; it asserts no original chain submission or loss actually occurred.
	var snapshot struct {
		Version    int                            `json:"version"`
		Generation uint64                         `json:"generation"`
		Stopped    bool                           `json:"stopped"`
		Entries    map[string]participation.Entry `json:"entries"`
		Slots      map[string]string              `json:"slots"`
		Requests   map[string]string              `json:"requests"`
	}
	if legacy, err := productstore.Load(f.path, &snapshot); err != nil || legacy {
		t.Fatalf("original owned journal load: legacy=%v %v", legacy, err)
	}
	for i, state := range []string{participation.Unknown, participation.AwaitingWallet} {
		entry := snapshot.Entries[entries[i].ID]
		entry.State = state
		entry.PublishAttemptedAt = time.Now().UTC().Format(time.RFC3339Nano)
		entry.FirstCause = "isolated frozen local status fixture; no original publish performed"
		snapshot.Entries[entry.ID] = entry
	}
	if err := productstore.Save(f.path, snapshot); err != nil {
		t.Fatal(err)
	}
	restored, err := participation.New(f.path, f.reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restored.Close() })
	f.server.Close()
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, restored, "UNSUPPORTED", false, false, "3", "1")
	})
	for i, state := range []string{participation.Unknown, participation.AwaitingWallet, participation.Revoked} {
		got, ok := restored.Get(entries[i].ID)
		if !ok || got.State != state {
			t.Fatalf("status retired or changed original state: %+v", got)
		}
		before, _ := json.Marshal(snapshot.Entries[entries[i].ID])
		after, _ := json.Marshal(got)
		if !bytes.Equal(before, after) {
			t.Fatal("status or restart changed the original historical descriptor")
		}
	}
	if err = restored.Revoke(); err != nil {
		t.Fatal(err)
	}
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, restored, "REVOKED", false, true, "3", "1")
	})
}

func TestP09ParticipationLocalStatusOwnershipFailure(t *testing.T) {
	f := newParticipationFixture(t, true)
	marker := f.path + ".owner.lock"
	if err := os.Chmod(marker, 0640); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(marker, 0600) })
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, f.service, "UNAVAILABLE", true, false, "0", "0")
	})
	// A read-only check does not seal, repair, replace or delete the marker.
	if info, err := os.Stat(marker); err != nil || info.Mode().Perm() != 0640 {
		t.Fatal("status repaired or replaced the unexpected owner marker")
	}
	if err := os.Chmod(marker, 0600); err != nil {
		t.Fatal(err)
	}
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, f.service, "CONFIGURED", true, false, "0", "0")
	})
	original, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	displaced := marker + ".isolated-original"
	if err = os.Rename(marker, displaced); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := os.Stat(displaced); err == nil {
			_ = os.Remove(marker)
			_ = os.Rename(displaced, marker)
		}
	})
	if err = os.WriteFile(marker, original, 0600); err != nil {
		t.Fatal(err)
	}
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, f.service, "UNAVAILABLE", true, false, "0", "0")
	})
	if err = os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(displaced, marker); err != nil {
		t.Fatal(err)
	}
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, f.service, "CONFIGURED", true, false, "0", "0")
	})
}

func TestP09ParticipationLocalStatusPersistenceFailureBeforePublish(t *testing.T) {
	f := newParticipationFixture(t, true)
	entry, err := f.service.Prepare(context.Background(), f.request("status-persistence-boundary"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(f.path+".tmp", 0700); err != nil {
		t.Fatal(err)
	}
	entry, err = f.service.Submit(context.Background(), entry.ID)
	if err == nil || entry.State != participation.Unknown || entry.PublishAttemptedAt == "" || entry.FirstCause == "" {
		t.Fatalf("real durable-before-publish boundary not reached: %+v %v", entry, err)
	}
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, f.service, "UNAVAILABLE", true, true, "1", "1")
	})
	if err = f.service.Close(); err == nil {
		t.Fatal("close hid the original persistence failure")
	}
	participationStatusUnchanged(t, f, func() {
		participationStatusWant(t, f.service, "UNAVAILABLE", true, true, "1", "1")
	})
}

func TestP09ParticipationLocalStatusConcurrentRevokeAndClose(t *testing.T) {
	f := newParticipationFixture(t, true)
	if _, err := f.service.Prepare(context.Background(), f.request("status-concurrent-transition")); err != nil {
		t.Fatal(err)
	}
	var readers sync.WaitGroup
	problems := make(chan participation.LocalStatus, 16)
	start := make(chan struct{})
	for i := 0; i < 16; i++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			<-start
			for j := 0; j < 64; j++ {
				s := f.service.LocalStatus()
				valid := s.Configured && s.WalletPublisherConfigured && s.Entries == "1" && s.UnknownEntries == "0" &&
					(s.Code == "CONFIGURED" && !s.Stopped || s.Code == "REVOKED" && s.Stopped || s.Code == "UNAVAILABLE")
				if !valid {
					problems <- s
					return
				}
			}
		}()
	}
	close(start)
	if err := f.service.Revoke(); err != nil {
		t.Fatal(err)
	}
	if err := f.service.Close(); err != nil {
		t.Fatal(err)
	}
	readers.Wait()
	close(problems)
	for s := range problems {
		t.Errorf("inconsistent concurrent status: %+v", s)
	}
	participationStatusWant(t, f.service, "UNAVAILABLE", true, true, "1", "0")
	participationStatusNoEffects(t, f)
}

func TestP09ParticipationLocalStatusUnassembledValue(t *testing.T) {
	var service participation.Service
	status := service.LocalStatus()
	if status != (participation.LocalStatus{Code: "UNAVAILABLE", Entries: "0", UnknownEntries: "0"}) {
		t.Fatalf("zero value created configured capability: %+v", status)
	}
}
