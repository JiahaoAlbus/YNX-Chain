package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"reflect"
	"strconv"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func TestGenesisMigrationReferenceStreamMatchesOriginalBytesAndEveryBinding(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	ref := newCometMigrationReference(f.migration, canonical)
	raw, err := json.Marshal(ref)
	if err != nil {
		t.Fatal(err)
	}
	var stream bytes.Buffer
	if err := f.migration.WriteCanonicalJSON(&stream); err != nil || !bytes.Equal(stream.Bytes(), canonical) {
		t.Fatal("existing stream writer changed old canonical bytes", err)
	}
	if got := newCometMigrationReferenceDigest(f.migration, sha256.Sum256(stream.Bytes()), stream.Len()); got != ref {
		t.Fatal("stream digest/count changed an original reference field")
	}
	for _, value := range [][]byte{canonical, raw, append(append([]byte(" \n"), raw...), '\t')} {
		old, referenced, oldErr := validateCometMigrationAppState(value, f.migration, canonical)
		got, reference, err := validateBootstrapMigrationAppState(value, f.migration)
		if oldErr != nil || err != nil || !bytes.Equal(old, got) || referenced != (reference != nil) {
			t.Fatal("normal bootstrap changed inline/reference representation", oldErr, err)
		}
		if reference != nil && *reference != ref {
			t.Fatal("returned reference does not bind every original field")
		}
	}
	for field := 0; field < reflect.TypeOf(ref).NumField(); field++ {
		name := reflect.TypeOf(ref).Field(field).Name
		t.Run(name, func(t *testing.T) {
			changed := ref
			value := reflect.ValueOf(&changed).Elem().Field(field)
			value.SetString("changed-" + value.String())
			bad, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := validateBootstrapMigrationAppState(bad, f.migration); err == nil {
				t.Fatal("stream bootstrap accepted a changed complete-source binding")
			}
		})
	}
	for _, bad := range [][]byte{
		append([]byte(`{"foreign":0,`), raw[1:]...),
		append([]byte(`{"version":"YNX-COMET-MIGRATION-REFERENCE/v1",`), raw[1:]...),
		bytes.Replace(raw, []byte(`"version"`), []byte(`"Version"`), 1),
		bytes.Replace(raw, []byte(`"migrationCanonicalBytes":"`+strconv.Itoa(len(canonical))+`"`), []byte(`"migrationCanonicalBytes":`+strconv.Itoa(len(canonical))), 1),
		append(append([]byte(nil), raw...), '{', '}'),
		raw[:len(raw)-1],
	} {
		if bytes.Equal(raw, bad) {
			t.Fatal("counterexample did not change reference bytes")
		}
		if _, _, err := validateBootstrapMigrationAppState(bad, f.migration); err == nil {
			t.Fatal("unknown/duplicated/folded/numeric/trailing/truncated reference accepted")
		}
	}
	doc := *f.doc
	doc.AppState = raw
	genesis, err := cmtjson.Marshal(&doc)
	if err != nil {
		t.Fatal(err)
	}
	pins := f.pins
	pins.CometGenesisSHA256 = productionOperatorSHA(genesis)
	bootstrap, err := NewConsensusBootstrap(genesis, pins, f.migration)
	if err != nil || bootstrap.migrationReference == nil || !bytes.Equal(bootstrap.appState, raw) {
		t.Fatal("real bootstrap did not consume the complete reference binding", err)
	}
	if _, err := NewConsensusBootstrap(genesis, pins, chain.ConsensusMigrationState{}); err == nil {
		t.Fatal("reference alone granted missing source state")
	}
	doc.ChainID += "-foreign"
	foreign, err := cmtjson.Marshal(&doc)
	if err != nil {
		t.Fatal(err)
	}
	pins.CometGenesisSHA256 = productionOperatorSHA(foreign)
	if _, err := NewConsensusBootstrap(foreign, pins, f.migration); err == nil {
		t.Fatal("self-pinned foreign Genesis replaced original chain binding")
	}
}

func TestGenesisMigrationReferenceStreamLargeNormalSource(t *testing.T) {
	// Exercise the actual >64MiB boundary with real normal producer history,
	// reusing its existing valid fixture. No node, signer or original data runs.
	f := newValidatorRegistryFixture(t)
	migration, _ := largeReferenceMigration(t, f.migration)
	var bindings []chain.ConsensusValidatorKeyBinding
	for _, validator := range f.migration.Validators {
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: validator.Address,
			KeyType: validator.ConsensusKeyType, PublicKey: validator.ConsensusPubKey, ConsensusAddress: validator.ConsensusAddress})
	}
	var err error
	migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := migration.CanonicalJSON()
	if err != nil || len(canonical) <= MaxCometGenesisBytes {
		t.Fatal("normal source did not reach the old large-input boundary", err)
	}
	want := newCometMigrationReference(migration, canonical)
	raw, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	// Discard the oracle's whole-history byte slice before the actual new path.
	canonical = nil
	got, ref, err := validateBootstrapMigrationAppState(raw, migration)
	if err != nil || ref == nil || *ref != want || !bytes.Equal(got, raw) || len(got) > 4096 {
		t.Fatal("large source did not bind the original bounded reference", err)
	}
}
