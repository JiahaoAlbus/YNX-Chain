package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// These are the existing normal Genesis and complete migration input limits.
// A reference keeps Genesis bounded; it never increases either input limit.
const MaxCometGenesisBytes = 64 << 20
const maxCometMigrationBytes = 1 << 30
const cometMigrationReferenceVersion = "YNX-COMET-MIGRATION-REFERENCE/v1"

// No path, URL or state is obtained from this document. Every field must match
// the complete, separately supplied migration already trusted by the caller.
// The digest covers CanonicalJSON exactly (not a sidecar's optional final LF).
type cometMigrationReference struct {
	Version                  string `json:"version"`
	MigrationCanonicalSHA256 string `json:"migrationCanonicalSHA256"`
	MigrationCanonicalBytes  string `json:"migrationCanonicalBytes"`
	MigrationVersion         string `json:"migrationVersion"`
	MigrationSourceFormat    string `json:"migrationSourceFormat"`
	NativeChainID            string `json:"nativeChainId"`
	OriginalGenesisHash      string `json:"originalGenesisHash"`
	MigrationStateHash       string `json:"migrationStateHash"`
	MigrationHeight          string `json:"migrationHeight"`
	MigrationLastBlockHash   string `json:"migrationLastBlockHash"`
}

func newCometMigrationReference(m chain.ConsensusMigrationState, canonical []byte) cometMigrationReference {
	h := sha256.Sum256(canonical)
	return newCometMigrationReferenceDigest(m, h, len(canonical))
}

func newCometMigrationReferenceDigest(m chain.ConsensusMigrationState, digest [sha256.Size]byte, count int) cometMigrationReference {
	return cometMigrationReference{
		Version: cometMigrationReferenceVersion, MigrationCanonicalSHA256: hex.EncodeToString(digest[:]), MigrationCanonicalBytes: strconv.Itoa(count),
		MigrationVersion: strconv.Itoa(m.Version), MigrationSourceFormat: m.SourceFormat, NativeChainID: strconv.FormatInt(m.Network.ChainID, 10),
		OriginalGenesisHash: m.OriginalGenesisHash, MigrationStateHash: m.StateHash, MigrationHeight: strconv.FormatUint(m.Height, 10), MigrationLastBlockHash: m.LastBlockHash,
	}
}

// Reference Genesis contains no history bytes. Hash/count the exact same
// original canonical stream, retaining only the bounded reference. This is not
// a caller-provided digest witness: complete typed validation and every byte
// of the independently supplied migration still go through the existing writer.
// Embedded Genesis retains its original complete byte-for-byte validation.
func validateBootstrapMigrationAppState(raw []byte, migration chain.ConsensusMigrationState) ([]byte, *cometMigrationReference, error) {
	var discriminator struct {
		Version json.RawMessage `json:"version"`
	}
	if err := json.Unmarshal(raw, &discriminator); err != nil {
		return nil, nil, err
	}
	var version string
	if json.Unmarshal(discriminator.Version, &version) == nil {
		ref, err := decodeCometMigrationReference(raw)
		if err != nil {
			return nil, nil, err
		}
		stream := validatedMigrationCanonicalWriter{digest: sha256.New(), binding: newCanonicalMigrationStreamBinding(nil)}
		if err := migration.WriteCanonicalJSON(&stream); err != nil {
			return nil, nil, err
		}
		if stream.count == 0 || stream.count > maxCometMigrationBytes {
			return nil, nil, errors.New("complete migration exceeds the existing input bound")
		}
		var digest [sha256.Size]byte
		copy(digest[:], stream.digest.Sum(nil))
		if ref != newCometMigrationReferenceDigest(migration, digest, stream.count) {
			return nil, nil, errors.New("genesis migration reference differs from the complete independently supplied migration")
		}
		normalized, err := json.Marshal(ref)
		return normalized, &ref, err
	}
	canonical, err := migration.CanonicalJSON()
	if err != nil {
		return nil, nil, err
	}
	appState, _, err := validateCometMigrationAppState(raw, migration, canonical)
	return appState, nil, err
}

// This private path is reachable only with the original constructor-owned
// migration and its FULL validated canonical stream. The normal public path
// above is unchanged. It removes repeated mathematical validation, never the
// complete canonical comparison or independent Genesis/reference binding.
func validateBootstrapMigrationAppStateOwned(raw []byte, owner *validatedMigration) ([]byte, *cometMigrationReference, error) {
	if owner == nil || owner.valid() != nil || owner.validatedSelf != owner || owner.bootstrapKeysValidated != owner || owner.bootstrap != nil {
		return nil, nil, errors.New("missing original validated bootstrap migration owner")
	}
	var discriminator struct {
		Version json.RawMessage `json:"version"`
	}
	if err := json.Unmarshal(raw, &discriminator); err != nil {
		return nil, nil, err
	}
	var version string
	if json.Unmarshal(discriminator.Version, &version) == nil {
		// Keep the original streaming full validator for large reference input;
		// never allocate a history-sized canonical slice here. This conservative
		// path keeps its extra mathematical pass until a separate bounded normal
		// encoder port exists. Its result must also match this exact owner.
		normalized, ref, err := validateBootstrapMigrationAppState(raw, owner.migration)
		if err != nil {
			return nil, nil, err
		}
		if ref == nil || *ref != newCometMigrationReferenceDigest(owner.migration, owner.canonicalHash, owner.canonicalBytes) {
			return nil, nil, errors.New("original validated canonical migration changed")
		}
		return normalized, ref, nil
	}
	// Use precisely the original CanonicalJSON encoder. Its complete validation
	// has already run inside WriteDetachedCanonicalJSON. A changed owner or any
	// normalization difference cannot be supplied by a caller digest or flag.
	canonical, err := json.MarshalIndent(owner.migration, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	if len(canonical) != owner.canonicalBytes || sha256.Sum256(canonical) != owner.canonicalHash || len(canonical) == 0 || len(canonical) > maxCometMigrationBytes {
		return nil, nil, errors.New("original validated canonical migration changed")
	}
	// Same original typed decoder and canonical encoding as the inline path.
	// Every resulting byte must equal the FULL previously validated original;
	// an unvalidated/different embedded state never reaches mathematical reuse.
	var embedded chain.ConsensusMigrationState
	if err = json.Unmarshal(raw, &embedded); err != nil {
		return nil, nil, err
	}
	encoded, err := json.MarshalIndent(embedded, "", "  ")
	if err != nil || !bytes.Equal(encoded, canonical) {
		return nil, nil, errors.New("genesis AppState is not the complete bound migration")
	}
	return canonical, nil, nil
}

func decodeCometMigrationReference(raw []byte) (cometMigrationReference, error) {
	var ref cometMigrationReference
	if len(raw) == 0 || len(raw) > 4096 || json.Unmarshal(raw, &ref) != nil {
		return ref, errors.New("invalid bounded genesis migration reference")
	}
	canonical, err := json.Marshal(ref)
	var compact bytes.Buffer
	if err != nil || json.Compact(&compact, raw) != nil || !bytes.Equal(compact.Bytes(), canonical) || ref.Version != cometMigrationReferenceVersion {
		return ref, errors.New("genesis migration reference requires exact versioned fields and canonical values")
	}
	return ref, nil
}

// Normalize the actual AppState representation without resolving any location.
// canonical must be the full validated migration's CanonicalJSON, never bytes
// obtained by interpreting the reference itself as an initial state.
func validateCometMigrationAppState(raw []byte, m chain.ConsensusMigrationState, canonical []byte) ([]byte, bool, error) {
	if len(canonical) == 0 || len(canonical) > maxCometMigrationBytes {
		return nil, false, errors.New("complete migration exceeds the existing input bound")
	}
	var discriminator struct {
		Version json.RawMessage `json:"version"`
	}
	if err := json.Unmarshal(raw, &discriminator); err != nil {
		return nil, false, err
	}
	var version string
	if json.Unmarshal(discriminator.Version, &version) == nil {
		ref, err := decodeCometMigrationReference(raw)
		if err != nil {
			return nil, true, err
		}
		if ref != newCometMigrationReference(m, canonical) {
			return nil, true, errors.New("genesis migration reference differs from the complete independently supplied migration")
		}
		normalized, err := json.Marshal(ref)
		return normalized, true, err
	}
	// Preserve the existing inline migration representation and its validation.
	var embedded chain.ConsensusMigrationState
	if err := json.Unmarshal(raw, &embedded); err != nil {
		return nil, false, err
	}
	encoded, err := embedded.CanonicalJSON()
	if err != nil || !bytes.Equal(encoded, canonical) {
		return nil, false, errors.New("genesis AppState is not the complete bound migration")
	}
	return canonical, false, nil
}

// Small Genesis bytes remain unchanged. Select the reference only if the
// original complete Genesis's normal SaveAs encoding exceeds the existing cap.
func boundCometGenesisAppState(doc *cmttypes.GenesisDoc, m chain.ConsensusMigrationState, canonical []byte) error {
	if len(canonical) == 0 || len(canonical) > maxCometMigrationBytes {
		return errors.New("complete migration exceeds the existing input bound")
	}
	if len(canonical) <= MaxCometGenesisBytes {
		raw, err := cmtjson.MarshalIndent(doc, "", "  ")
		if err != nil {
			return err
		}
		if len(raw) <= MaxCometGenesisBytes {
			return nil
		}
	}
	raw, err := json.Marshal(newCometMigrationReference(m, canonical))
	if err != nil {
		return err
	}
	doc.AppState = raw
	encoded, err := cmtjson.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if len(encoded) > MaxCometGenesisBytes {
		return errors.New("genesis metadata exceeds the existing input bound")
	}
	return nil
}
