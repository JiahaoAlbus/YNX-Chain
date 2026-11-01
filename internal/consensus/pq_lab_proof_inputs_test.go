package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

func TestPQLabProofInputsSameOriginalParityAndCost(t *testing.T) {
	m, proof := pqLabProofFixture(t)
	now := time.Now().UTC()
	root := pqLabWorkloadTemp(t)
	path := filepath.Join(root, "proof")
	type measured struct {
		elapsed   time.Duration
		allocated uint64
		out       PQLabProofExport
	}
	measure := func(call func() (PQLabProofExport, error)) measured {
		var a, b runtime.MemStats
		runtime.ReadMemStats(&a)
		start := time.Now()
		out, err := call()
		elapsed := time.Since(start)
		runtime.ReadMemStats(&b)
		if err != nil {
			t.Fatal(err)
		}
		return measured{elapsed, b.TotalAlloc - a.TotalAlloc, out}
	}
	before := measure(func() (PQLabProofExport, error) { return legacyPQLabWriteProofF27(path, m, proof, now) })
	// Preserve every before byte; use the exact same absolute target for the
	// after arm so context/request/result hashes are directly comparable.
	saved := filepath.Join(root, "before-preserved")
	if err := os.Rename(path, saved); err != nil {
		t.Fatal(err)
	}
	after := measure(func() (PQLabProofExport, error) { return WritePQLabProofInputs(path, m, proof, now) })
	if !reflect.DeepEqual(before.out, after.out) || !after.out.Result.Finalized || !after.out.Result.ExecutionSuccessful || after.out.AuthorityGranted || after.out.ActualNetworkExecutionClaim {
		t.Fatal("original complete proof result differs")
	}
	names := []string{"migration.json", "genesis.json", "committed-state.json", "schedule.json", "trusted-light-block.json", "trust-context.json", "request.json", "PUBLIC-PROOF-INPUTS.json"}
	for _, name := range names {
		a, err := os.ReadFile(filepath.Join(saved, name))
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(filepath.Join(path, name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(a, b) {
			t.Fatal("original file bytes/hash differ", name)
		}
		t.Logf("PROOF_FILE_PARITY file=%s bytes=%d sha256=%s", name, len(a), pqLabSHA(a))
	}
	if _, err := WritePQLabProofInputs(path, m, proof, now); err == nil {
		t.Fatal("existing UNKNOWN output overwritten")
	}
	// Exact continuation must still re-evaluate the independent clock/target,
	// despite every persisted byte and all immutable source hashes matching.
	expired := m
	expired.TrustingPeriod = time.Nanosecond
	if _, err := recheckPQLabProofInputs(path, expired, proof, now); err == nil {
		t.Fatal("same-byte proof bypassed expired trust")
	}
	wrong := m
	wrong.EngineAppHash = bytes.Repeat([]byte{1}, 32)
	if _, err := recheckPQLabProofInputs(path, wrong, proof, now); err == nil {
		t.Fatal("same-byte proof bypassed independent engine checkpoint")
	}
	for _, bad := range [][]byte{append(bytes.Clone(m.Migration), ' '), append([]byte(" "), m.Migration...), append(bytes.Clone(m.Migration), []byte(`{}`)...)} {
		changed := m
		changed.Migration = bad
		if _, err := WritePQLabProofInputs(filepath.Join(pqLabWorkloadTemp(t), "refused"), changed, proof, now); err == nil {
			t.Fatal("noncanonical migration accepted")
		}
	}
	// The encoded untrusted proof was not rewritten by either arm.
	raw, _ := json.Marshal(proof)
	t.Logf("PROOF_INPUT_COST operations=1 perArm=true inputMigrationBytes=%d inputStateBytes=%d inputProofSHA=%s beforeNS=%d afterNS=%d beforeAllocatedBytes=%d afterAllocatedBytes=%d sameClock=true sameInput=true fullAND=true networkRun=false", len(m.Migration), len(m.CommittedState), pqLabSHA(raw), before.elapsed.Nanoseconds(), after.elapsed.Nanoseconds(), before.allocated, after.allocated)
}

func TestPQLabCanonicalComparisonExactChunks(t *testing.T) {
	original := []byte(`{"a":[1,2],"b":"all-original-bytes"}`)
	for split := 0; split <= len(original); split++ {
		w := pqLabCanonicalComparison{original: original}
		if n, err := w.Write(original[:split]); err != nil || n != split {
			t.Fatal(err)
		}
		if n, err := w.Write(original[split:]); err != nil || n != len(original)-split || w.offset != len(original) {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte("x")); err == nil {
			t.Fatal("trailing canonical bytes ignored")
		}
	}
	w := pqLabCanonicalComparison{original: original}
	wrong := bytes.Clone(original)
	wrong[len(wrong)-1] = '!'
	if _, err := w.Write(wrong); err == nil {
		t.Fatal("late canonical mismatch ignored")
	}
}
