//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"path/filepath"
	"strconv"
	"time"
)

// This borrow is confined to the original live input owner and its serialized
// proof capture. The public proof host and separate verifier still open and
// validate their own inputs independently.
type pqLabProofMigration struct {
	witness   *validatedMigration
	original  *proofHostOriginal
	rawSHA    string
	canonical []byte
}

func (in *pqLabLiveMaterialsInputs) proofMigrationFor(static *pqLabLiveStaticSnapshot) (*pqLabProofMigration, error) {
	witness := static.witness
	if witness == nil || witness.bootstrap == nil || witness.validatedSelf != witness || witness.bootstrapKeysValidated != witness ||
		witness.migration.Network.ChainID != PQLabNativeChainID || witness.migration.Network.IsPublicNet {
		return nil, errors.New("original validated synthetic migration required")
	}
	var originals []*proofHostOriginal
	if static.cached != nil {
		originals = static.cached.originals
	} else {
		originals = static.uncached.originals
	}
	for _, original := range originals {
		if original.path != static.plan.MigrationFile {
			continue
		}
		if held := in.proofMigration; held != nil {
			if held.witness != witness || held.original != original {
				return nil, errors.New("held proof migration identity changed")
			}
			// loadStatic checks every original before each capture. The proof
			// loader rechecks this exact descriptor before admitting the plan.
			return held, nil
		}
		if witness.canonicalBytes <= 0 || witness.canonicalBytes > maxPQLabProofCanonicalMigrationBytes {
			return nil, errors.New("canonical migration exceeds the original lab proof input bound")
		}
		rawHash := sha256.Sum256(original.raw)
		canonical := original.raw
		if len(canonical) == witness.canonicalBytes && rawHash == witness.canonicalHash {
			if err := proofHostCompleteUniqueJSON(original.raw, maxProofHostMigrationBytes); err != nil {
				return nil, err
			}
		} else {
			// Legal whitespace and field ordering remain part of the raw
			// source hash. Canonicalize these exact typed bytes once, then
			// compare every byte through the private owner's canonical digest.
			decoded, err := decodeProofHostMigration(original.raw)
			if err != nil {
				return nil, err
			}
			var buf bytes.Buffer
			buf.Grow(witness.canonicalBytes)
			if err = decoded.WriteCanonicalJSON(&buf); err != nil {
				return nil, err
			}
			canonical = buf.Bytes()
			if len(canonical) != witness.canonicalBytes || sha256.Sum256(canonical) != witness.canonicalHash {
				return nil, errors.New("canonical proof migration differs from the original live witness")
			}
		}
		in.proofMigration = &pqLabProofMigration{witness: witness, original: original, rawSHA: hex.EncodeToString(rawHash[:]), canonical: canonical}
		return in.proofMigration, nil
	}
	return nil, errors.New("original held proof migration file unavailable")
}

func (m *pqLabProofMigration) checkPlan(p ProofHostSourcePlan, chainID string) error {
	b := m.witness.bootstrap
	if p.MigrationFile != m.original.path || p.MigrationSHA256 != m.rawSHA ||
		p.ConsensusGenesisSHA256 != b.record.CometGenesisSHA256 || p.OriginalGenesisHash != m.witness.migration.OriginalGenesisHash ||
		p.MigrationStateHash != m.witness.migration.StateHash || b.record.ChainID != chainID || p.RuntimePlanFile != "" {
		return errors.New("proof plan differs from the original held migration and bootstrap")
	}
	return m.original.unchanged()
}

func writePQLabProofMaterialFrame(path string, head, migration, tail []byte) (PQLabWorkloadFile, error) {
	digest := sha256.New()
	err := pqLabWritePublicFile(path, func(file io.Writer) error {
		return writePQLabProofMaterialBytes(io.MultiWriter(file, digest), head, migration, tail)
	})
	if err != nil {
		return PQLabWorkloadFile{}, err
	}
	size := len(head) + len(tail) + 2 + base64.StdEncoding.EncodedLen(len(migration))
	return PQLabWorkloadFile{Path: path, SHA256: hex.EncodeToString(digest.Sum(nil)), Bytes: strconv.Itoa(size)}, nil
}

// The live producer verifies the exact newly written checkpoint through the
// normal file reader. It carries only its already qualified static source into
// that read. The separately launched public verifier remains a cold reader.
func (in *proofHostInputs) writeLiveProofVerifier(directory string, m PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time) (PQLabProofExport, error) {
	var empty PQLabProofExport
	held := in.heldMigration
	if held == nil || !bytes.Equal(held.canonical, m.Migration) ||
		m.Pins != (ConsensusBootstrapPins{in.plan.ConsensusGenesisSHA256, in.plan.OriginalGenesisHash, in.plan.MigrationStateHash}) ||
		!bytes.Equal(m.Genesis, in.originals["genesis"].raw) || m.ScheduleHash != in.plan.ScheduleHash ||
		!bytes.Equal(m.Schedule, in.originals["schedule"].raw) || m.Expected.Block.ChainID != in.bootstrap.record.ChainID {
		return empty, errors.New("live verifier inputs differ from the admitted original proof source")
	}
	if err := validatePQLabProofMaterials(m, now); err != nil {
		return empty, err
	}
	trusted, err := DecodePQTrustedLightBlock(m.TrustedLightBlock)
	if err != nil {
		return empty, err
	}
	if err = writePQLabProofOriginals(directory, m); err != nil {
		return empty, err
	}
	source := &PQEngineFileSource{migration: held.witness.migration, validatedMigration: held.witness, bootstrap: held.witness.bootstrap,
		path: filepath.Join(directory, "committed-state.json"), authorization: in.engine}
	return finishPQLabProofInputsFromSource(directory, m, proof, now, in.bootstrap, source, trusted)
}
