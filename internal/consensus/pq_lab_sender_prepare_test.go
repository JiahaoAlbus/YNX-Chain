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
	"testing"
)

func TestPQLabSenderPrepareOriginalWitnessAndCurrent(t *testing.T) {
	p, pin, _ := checkpointReadFixture(t, 1)
	raw, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(p.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, large := range []bool{false, true} {
		name := "cache"
		original := migration
		if large {
			name = "held-over-cache-bound"
			original = append(bytes.Repeat([]byte(" "), 33<<20), migration...)
		}
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(p.MigrationFile, original, 0600); err != nil {
				t.Fatal(err)
			}
			source := NewPQLabSenderCheckpointSource()
			defer source.Close()
			// Preparation must not treat any current checkpoint as static readiness.
			if err := os.WriteFile(p.Nodes[0].StatePath, []byte("unavailable current checkpoint"), 0600); err != nil {
				t.Fatal(err)
			}
			prepared := &PQLabMetrics{}
			if err := source.Prepare(p.RootDir, pin, "", prepared); err != nil {
				t.Fatal(err)
			}
			if err := source.Prepare(p.RootDir, pin, "", prepared); err != nil {
				t.Fatal(err)
			}
			stages := prepared.Snapshot().Stages
			if stages["lab.bootstrapFullValidation"].Calls != 1 || stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || stages["checkpoint.captureCurrentBytes"].Calls != 0 || stages["checkpoint.prepareStaticTotal"].Calls != 2 {
				t.Fatal("preparation rebuilt witness or captured current state", stages)
			}
			if _, err := source.Load(p.RootDir, pin, "", state.Height, state.AppHash, nil); err == nil {
				t.Fatal("prepared source bypassed unavailable current checkpoint")
			}
			if err := os.WriteFile(p.Nodes[0].StatePath, raw, 0600); err != nil {
				t.Fatal(err)
			}
			currentMetrics := &PQLabMetrics{}
			cp, err := source.Load(p.RootDir, pin, "", state.Height, state.AppHash, currentMetrics)
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				if err := cp.current(); err != nil {
					t.Fatal(err)
				}
			}
			full, err := encodeCommittedStateJSON(cp.state)
			if err != nil || !bytes.Equal(full, raw) {
				t.Fatal("prepared loader changed complete original state", err)
			}
			stages = currentMetrics.Snapshot().Stages
			if stages["lab.bootstrapFullValidation"].Calls != 0 || stages["lab.validatedMigrationOwnerBuild"].Calls != 0 || stages["checkpoint.captureCurrentBytes"].Calls != 12 || stages["checkpoint.fullStateValidation"].Calls != 1 || stages["checkpoint.exactBytesValidationReuse"].Calls != 11 {
				t.Fatal("dynamic read/validation denominator changed", stages)
			}
			if _, err := source.Load(p.RootDir, pin, "", state.Height+1, state.AppHash, nil); err == nil {
				t.Fatal("preparation authorized wrong H")
			}
			if _, err := source.Load(p.RootDir, pin, "", state.Height, strings.Repeat("f", 64), nil); err == nil {
				t.Fatal("preparation authorized wrong AppHash")
			}
			if err := source.Prepare(p.RootDir, strings.Repeat("f", 64), "", nil); err == nil {
				t.Fatal("prepared witness changed original pin")
			}
			if err := source.Prepare(p.RootDir, pin, strings.Repeat("f", 64), nil); err == nil {
				t.Fatal("prepared witness changed activation scope")
			}
			stats := source.CacheStats()
			if stats.Misses != 1 || (large && (stats.Entries != 0 || stats.Bypasses != 1 || stats.OriginalBytes != 0)) {
				t.Fatal("preparation enlarged original cache", stats)
			}
			// An identical encoding at another inode is not this held original.
			if err := os.WriteFile(p.MigrationFile+".replacement", original, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(p.MigrationFile+".replacement", p.MigrationFile); err != nil {
				t.Fatal(err)
			}
			if source.Prepare(p.RootDir, pin, "", nil) == nil || cp.current() == nil {
				t.Fatal("replaced static source retained readiness")
			}
			if err := source.Close(); err != nil {
				t.Fatal(err)
			}
			if source.Prepare(p.RootDir, pin, "", nil) == nil || cp.current() == nil {
				t.Fatal("closed prepared source resurrected")
			}
			t.Logf("PREPARED_STATIC_SOURCE large=%t bootstrapBuilds=1 prepareCalls=2 subsequentBootstrapBuilds=0 currentCaptures=12 completeStateSHA=%s authorityGranted=false", large, pqLabSHA(full))
		})
	}
}

func TestPQLabPublicOwnerPrepareBeforeCommands(t *testing.T) {
	p, options, credential := publicOwnerSessionFixture(t)
	ctx := context.Background()
	s, err := OpenPQLabPublicOwnerSession(ctx, options, credential, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// No sender-key open is needed. Keep actual private originals inaccessible
	// at their normal path during Prepare, then restore them before signing.
	private := filepath.Join(p.RootDir, "workload", "private-senders")
	if err := os.Rename(private, private+".held"); err != nil {
		t.Fatal(err)
	}
	metrics := &PQLabMetrics{}
	err = s.PrepareSource(ctx, metrics)
	restore := os.Rename(private+".held", private)
	if err != nil || restore != nil {
		t.Fatal(err, restore)
	}
	stats := s.Stats()
	if stats.OpenedOwners != 0 || stats.Commands != 0 || stats.SourceInputs.State == "NOT_LOADED" {
		t.Fatal("preparation opened owner or reserved command", stats)
	}
	stages := metrics.Snapshot().Stages
	if stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || stages["checkpoint.captureCurrentBytes"].Calls != 0 || stages["sender.importFullPrivatePublicPair"].Calls != 0 {
		t.Fatal("unmeasured preparation or signing work", stages)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if !errors.Is(s.PrepareSource(canceled, nil), context.Canceled) {
		t.Fatal("canceled preparation reported ready")
	}
	state := publicOwnerState(t, p)
	for owner := 0; owner < 2; owner++ {
		request := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: owner, FirstNonce: 2, Members: 1}
		metrics := &PQLabMetrics{}
		result, err := s.Sign(ctx, request, state.Height, state.AppHash, metrics)
		if err != nil || result.AuthorityGranted {
			t.Fatal("normal prepared sign", err)
		}
		stages := metrics.Snapshot().Stages
		if stages["lab.bootstrapFullValidation"].Calls != 0 || stages["checkpoint.captureCurrentBytes"].Calls != 12 || stages["sender.importFullPrivatePublicPair"].Calls != 1 {
			t.Fatal("prepared sign omitted dynamic validation or repeated static math", stages)
		}
		originalPath := filepath.Join(p.RootDir, "workload", "sender-public", []string{"0000", "0001"}[owner], request.OperationID, "transaction.abci")
		original, err := os.ReadFile(originalPath)
		if err != nil {
			t.Fatal(err)
		}
		unknown := request
		unknown.OperationID = strings.Repeat("b", 64)
		if _, err := s.Sign(ctx, unknown, state.Height, state.AppHash, nil); !errors.Is(err, ErrPQLabSenderUnknown) {
			t.Fatal("prepare lost original UNKNOWN", err)
		}
		if _, err := s.Sign(ctx, request, 0, "", nil); err != nil {
			t.Fatal("original recovery depended on a new checkpoint", err)
		}
		after, err := os.ReadFile(originalPath)
		if err != nil || !bytes.Equal(after, original) {
			t.Fatal("prepared recovery resigned original", err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if s.PrepareSource(ctx, nil) == nil {
		t.Fatal("closed session prepared again")
	}
}
