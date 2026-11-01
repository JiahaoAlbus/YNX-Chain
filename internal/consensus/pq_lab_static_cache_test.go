//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestPQLabStaticOwnerPUBLICExactInputsBoundedAndClosed(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	cache := NewPQLabStaticCache()
	defer cache.Close()
	metrics := &PQLabMetrics{}
	before := validatedMigrationFullChecks.Load()
	cold := time.Now()
	entry, err := cache.load(p.RootDir, pin, metrics)
	coldNS := time.Since(cold).Nanoseconds()
	if err != nil {
		t.Fatal(err)
	}
	if validatedMigrationFullChecks.Load()-before != 1 {
		t.Fatal("private owner did not use original complete migration validator once")
	}
	plain, m, b, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(m)
	owned, _ := json.Marshal(entry.witness.migration)
	if !reflect.DeepEqual(plain, entry.plan) || !bytes.Equal(a, owned) || !reflect.DeepEqual(b.record, entry.witness.bootstrap.record) {
		t.Fatal("cached owner differs from independently reconstructed normal originals")
	}
	start := time.Now()
	for i := 0; i < 3; i++ {
		loaded, e := cache.load(p.RootDir, pin, metrics)
		if e != nil || loaded != entry {
			t.Fatal("same raw pins did not reuse exact private owner", e)
		}
	}
	warmNS := time.Since(start).Nanoseconds()
	stats := cache.Stats()
	if stats.Entries != 1 || stats.HeldFiles == 0 || stats.HeldFiles > pqLabStaticMaxFiles || stats.OriginalBytes > pqLabStaticMaxBytes || stats.Hits != 3 || stats.Misses != 1 {
		t.Fatal("bounded original static owner differs", stats)
	}
	raw, _ := json.Marshal(struct {
		Scope                           string
		ColdNS, ThreeHeldReadbackHitsNS int64
		Stats                           PQLabStaticCacheStats
		Metrics                         PQLabMetricsSnapshot
	}{"PUBLIC no Node/network; cache times include actual unchanged full-source hashes", coldNS, warmNS, stats, metrics.Snapshot()})
	t.Log(string(raw))
	if err = cache.Close(); err != nil {
		t.Fatal(err)
	}
	if entry.current() == nil {
		t.Fatal("closed owner still authorized current checkpoint")
	}
	if _, err = cache.load(p.RootDir, pin, metrics); err == nil {
		t.Fatal("closed owner reconstructed itself")
	}
	if cache.Stats().Entries != 0 {
		t.Fatal("Close retained cache entry")
	}
}

func TestPQLabStaticOwnerPUBLICReplacedSourceAndForeignScopeRefused(t *testing.T) {
	for _, kind := range []string{"same-bytes-new-inode", "same-inode-new-bytes-restored-mtime", "different-plan-pin", "same-bytes-parent-alias"} {
		t.Run(kind, func(t *testing.T) {
			p, pin := newPQLabTestPlan(t)
			cache := NewPQLabStaticCache()
			defer cache.Close()
			entry, err := cache.load(p.RootDir, pin, nil)
			if err != nil {
				t.Fatal(err)
			}
			target := p.GenesisFile
			raw, err := os.ReadFile(target)
			if err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "same-bytes-new-inode":
				replacement := target + ".PUBLIC-replacement"
				if err = os.WriteFile(replacement, raw, 0600); err != nil {
					t.Fatal(err)
				}
				if err = os.Rename(replacement, target); err != nil {
					t.Fatal(err)
				}
			case "same-inode-new-bytes-restored-mtime":
				changed := bytes.Clone(raw)
				changed[0] ^= 1
				if err = os.WriteFile(target, changed, 0600); err != nil {
					t.Fatal(err)
				}
				if err = os.Chtimes(target, info.ModTime(), info.ModTime()); err != nil {
					t.Fatal(err)
				}
			case "same-bytes-parent-alias":
				retained := p.RootDir + ".PUBLIC-retained"
				if err = os.Rename(p.RootDir, retained); err != nil {
					t.Fatal(err)
				}
				if err = os.Symlink(retained, p.RootDir); err != nil {
					t.Fatal(err)
				}
			case "different-plan-pin":
				pin = strings.Repeat("f", 64)
			}
			if _, err = cache.load(p.RootDir, pin, nil); err == nil {
				t.Fatal("changed originals silently refreshed or foreign scope reused")
			}
			if entry.current() == nil {
				t.Fatal("replaced/evicted originals retained live authority")
			}
		})
	}
}

func TestPQLabStaticOwnerPUBLICFileBoundFallsBackWithoutRetention(t *testing.T) {
	parent := pqLabWorkloadTemp(t)
	reads := &pqLabStaticReads{cacheable: true}
	defer reads.close()
	for i := 0; i <= pqLabStaticMaxFiles; i++ {
		path := filepath.Join(parent, string(rune('a'+i))+".PUBLIC.json")
		if err := os.WriteFile(path, []byte(`{"public":true}`), 0600); err != nil {
			t.Fatal(err)
		}
		_, err := reads.read(path, 1024)
		if i < pqLabStaticMaxFiles && err != nil {
			t.Fatal(err)
		}
		if i == pqLabStaticMaxFiles && !errors.Is(err, ErrPQLabStaticCacheBound) {
			t.Fatal("file-bound cache did not explicitly refuse unheld fallback", err)
		}
	}
	// Retain the original over-file-count counterexample and its zero-retention
	// assertions. It now refuses instead of issuing an unheld fallback owner.
	if reads.cacheable || len(reads.originals) != 0 || reads.bytes != 0 {
		t.Fatal("file-bound refusal retained public descriptors/bytes")
	}
	if _, err := reads.read(filepath.Join(parent, "a.PUBLIC.json"), 1024); !errors.Is(err, ErrPQLabStaticCacheBound) {
		t.Fatal("refused collector resumed unheld reads", err)
	}
}

func TestPQLabStaticOwnerPUBLICLivePublishMeasuresAndRetainsOriginalState(t *testing.T) {
	root := filepath.Join(pqLabWorkloadTemp(t), "lab")
	p, o, setup := pqLabLiveMaterialsFixture(t, root)
	stateBefore := map[string][]byte{}
	for _, n := range p.Nodes {
		for _, path := range []string{n.StatePath, n.SignerStateFile} {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			stateBefore[path] = raw
		}
	}
	metrics := &PQLabMetrics{}
	r := PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: setup.Policy.SHA256, Sequence: 1, TransactionFile: o.TransactionFile, TransactionSHA256: o.TransactionSHA256, NativeWireHash: o.NativeWireHash}
	path, err := PublishPQLabLiveMaterialsRequestMeasured(setup.Policy.Path, setup.Policy.SHA256, r, metrics)
	if runtime.GOOS == "linux" {
		if err != nil {
			t.Fatal(err)
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		canonical, _ := json.Marshal(r)
		if !bytes.Equal(raw, canonical) {
			t.Fatal("instrumented publisher changed request bytes")
		}
	} else {
		if err == nil || !strings.Contains(err.Error(), "requires Linux renameat2") {
			t.Fatal("normal unsupported-platform publication guard changed", err)
		}
		if _, readErr := os.Stat(pqLabLiveRequestPath(filepath.Dir(setup.Policy.Path), 1)); !os.IsNotExist(readErr) {
			t.Fatal("unsupported publisher manufactured request")
		}
	}
	for path, before := range stateBefore {
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("public static cache changed actual state/HRS")
		}
	}
	m := metrics.Snapshot()
	if m.Stages["live.publishTotal"].Calls != 1 || m.Stages["live.anchorFullValidation"].Calls != 1 || m.Stages["lab.bootstrapFullValidation"].Calls != 1 || m.Stages["lab.staticOwnerHitRevalidateSources"].Calls < 2 {
		t.Fatal("actual live callee static/math stages not measured", m)
	}
	missing := &PQLabMetrics{}
	if _, err = ReadPQLabLiveMaterialsResultMeasured(setup.Policy.Path, setup.Policy.SHA256, 1, missing); err == nil {
		t.Fatal("missing result became confirmed/qualified")
	}
	if missing.Snapshot().Stages["live.resultReadTotal"].Calls != 1 {
		t.Fatal("failed result read omitted elapsed stage")
	}
	bytes, _ := json.Marshal(m)
	t.Log("PUBLIC live normal request elapsed " + string(bytes))
	if _, err = PublishPQLabLiveMaterialsRequestMeasured(setup.Policy.Path, setup.Policy.SHA256, r, nil); err == nil {
		t.Fatal("same original request replayed")
	}
}

// The lab's original pqLabRead(...private=true) contract is exact 0600 and
// single-link. A public immutable-source witness must not relax that contract.
func TestPQLabStaticOwnerPUBLICPrivateReadContract(t *testing.T) {
	for _, mode := range []os.FileMode{0400, 0640, 0644} {
		t.Run("cold-"+mode.String(), func(t *testing.T) {
			root := pqLabWorkloadTemp(t)
			path := filepath.Join(root, "original.PUBLIC.json")
			if err := os.WriteFile(path, []byte(`{"public":true}`), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, mode); err != nil {
				t.Fatal(err)
			}
			if _, err := pqLabRead(path, 1024); err == nil {
				t.Fatal("original private=true reader unexpectedly accepted fixture mode", mode)
			}
			reads := &pqLabStaticReads{cacheable: true}
			defer reads.close()
			if _, err := reads.read(path, 1024); err == nil {
				t.Fatal("static cache relaxed original private=true file mode", mode)
			}
			if len(reads.originals) != 0 || reads.bytes != 0 {
				t.Fatal("rejected permission source was retained")
			}
		})
	}
	t.Run("exact-private-and-hit-mode-change", func(t *testing.T) {
		root := pqLabWorkloadTemp(t)
		path := filepath.Join(root, "original.PUBLIC.json")
		if err := os.WriteFile(path, []byte(`{"public":true}`), 0600); err != nil {
			t.Fatal(err)
		}
		reads := &pqLabStaticReads{cacheable: true}
		defer reads.close()
		if _, err := reads.read(path, 1024); err != nil {
			t.Fatal(err)
		}
		entry := &pqLabStaticEntry{root: root, originals: reads.originals}
		if err := entry.unchangedFiles(); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, 0400); err != nil {
			t.Fatal(err)
		}
		if entry.unchangedFiles() == nil {
			t.Fatal("cache hit accepted permission change to held original")
		}
	})
	t.Run("single-link-and-parent-alias", func(t *testing.T) {
		root := pqLabWorkloadTemp(t)
		path := filepath.Join(root, "original.PUBLIC.json")
		if err := os.WriteFile(path, []byte(`{"public":true}`), 0600); err != nil {
			t.Fatal(err)
		}
		alias := filepath.Join(root, "alias.PUBLIC.json")
		if err := os.Link(path, alias); err != nil {
			t.Fatal(err)
		}
		reads := &pqLabStaticReads{cacheable: true}
		defer reads.close()
		if _, err := pqLabRead(path, 1024); err == nil {
			t.Fatal("original reader accepted linked fixture")
		}
		if _, err := reads.read(path, 1024); err == nil {
			t.Fatal("cache accepted linked original")
		}
		if err := os.Remove(alias); err != nil {
			t.Fatal(err)
		}
		alias = root + "-alias"
		if err := os.Symlink(root, alias); err != nil {
			t.Fatal(err)
		}
		defer os.Remove(alias)
		if _, err := reads.read(filepath.Join(alias, filepath.Base(path)), 1024); err == nil {
			t.Fatal("cache accepted parent alias")
		}
	})
}

func TestPQLabStaticOwnerPUBLICOverByteBoundNeverIssuesUnheldOwner(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	raw, err := os.ReadFile(p.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	// Legal JSON whitespace changes no canonical state or independent plan pin.
	// The normal one-shot API must still validate this exact source successfully.
	padded := append(bytes.Clone(raw), bytes.Repeat([]byte(" "), pqLabStaticMaxBytes+1)...)
	if err = os.WriteFile(p.MigrationFile, padded, 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = loadPQLab(p.RootDir, pin); err != nil {
		t.Fatal("legal original uncached fixture was rejected", err)
	}
	cache := NewPQLabStaticCache()
	defer cache.Close()
	entry, err := cache.load(p.RootDir, pin, nil)
	if err == nil || entry != nil {
		// Actual old path: close every held descriptor at the byte limit, return an
		// unheld witness, then fail to notice replacement of the original genesis.
		if entry != nil {
			if e := os.WriteFile(p.GenesisFile, []byte(`{"replaced-original":true}`), 0600); e != nil {
				t.Fatal(e)
			}
			if entry.current() == nil {
				t.Fatal("over-bound cache issued unheld owner and accepted replaced genesis")
			}
		}
		t.Fatal("bounded cache returned an owner without all original source witnesses", err)
	}
	if !errors.Is(err, ErrPQLabStaticCacheBound) {
		t.Fatal("cache bound was reported as a protocol/input failure", err)
	}
	stats := cache.Stats()
	if stats.Entries != 0 || stats.HeldFiles != 0 || stats.OriginalBytes != 0 || stats.Bypasses != 1 {
		t.Fatal("over-bound refusal retained authorization/raw/FDs or lost accounting", stats)
	}
	// The explicit original API remains usable after cache refusal; no cache
	// capacity is promoted to a transaction, genesis or protocol validity rule.
	if _, _, _, err = loadPQLab(p.RootDir, pin); err != nil {
		t.Fatal("cache refusal changed original no-cache validation", err)
	}
}
