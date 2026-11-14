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

func TestPQLabProofMaterialsCanonicalReadback(t *testing.T) {
	m := PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: []byte{1, 2, 3, 4}}
	if path := os.Getenv("YNX_PQ_PROOF_HOST_MIGRATION_PUBLIC_FIXTURE"); path != "" {
		var err error
		m.Migration, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	decode := func(in []byte) (PQLabProofMaterials, error) {
		return DecodePQLabProofMaterials(in, pqLabSHA(in))
	}
	got, err := decode(raw)
	if err != nil || !reflect.DeepEqual(m, got) {
		t.Fatal("valid original v1 proof material changed", err)
	}
	if len(m.Migration) >= 64<<20 {
		t.Logf("same v1 material frame readback: migration=%d bytes frame=%d bytes", len(m.Migration), len(raw))
		return
	}
	for name, invalid := range map[string][]byte{
		"root duplicate":    bytes.Replace(raw, []byte(`"migration":`), []byte(`"migration":null,"migration":`), 1),
		"escaped duplicate": bytes.Replace(raw, []byte(`"migration":`), []byte(`"migr\u0061tion":null,"migration":`), 1),
		"alias":             bytes.Replace(raw, []byte(`"migration":`), []byte(`"Migration":`), 1),
		"nested unknown":    bytes.Replace(raw, []byte(`"Index":0`), []byte(`"Index":0,"Unknown":true`), 1),
		"nested duplicate":  bytes.Replace(raw, []byte(`"Index":0`), []byte(`"Index":1,"Index":0`), 1),
		"whitespace":        append([]byte(" "), raw...),
		"base64 escape":     bytes.Replace(raw, []byte(`"AQIDBA=="`), []byte(`"\u0041QIDBA=="`), 1),
		"trailing bytes":    append(bytes.Clone(raw), []byte("{}")...),
	} {
		t.Run(name, func(t *testing.T) {
			if bytes.Equal(raw, invalid) {
				t.Fatal("counterexample did not change the material frame")
			}
			if _, err := decode(invalid); err == nil {
				t.Fatal("changed material frame was accepted with a fresh hash")
			}
		})
	}
	for _, empty := range [][]byte{nil, {}} {
		m.Migration = empty
		encoded, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		got, err := decode(encoded)
		if err != nil || !reflect.DeepEqual(m, got) {
			t.Fatal("original v1 null/empty syntax changed", err)
		}
	}
}

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
