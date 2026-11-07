package main

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type resultCode int32
type cleanupCode uint32

const (
	resultOK resultCode = iota
	resultInvalidArgument
	resultBounds
	resultOverlap
	resultCapacity
	resultPublicBinding
	resultKeyMaterial
	resultSigning
	resultOutputValidation
	resultCleanup
	resultInternal
)

const (
	cleanupUnknown cleanupCode = iota
	cleanupNotRequired
	cleanupLogicalComplete
	cleanupFailed
)

const (
	abiVersion                = 1
	memberCapacity            = 98304
	registrationMaximum       = 8192
	manifestMaximum           = 16384
	publicationMessageMaximum = 16 + len(ynxbatch.ArtifactPublicationMessageVersion) + registrationMaximum + manifestMaximum
	// E(member tag, certificate, message, N=1 proof); the empty-path proof
	// is E(u32(0), E(), E()) = 28 bytes. Capacity is public and preallocated.
	publicationMemberMaximum = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + publicationMessageMaximum + 28
)

type publicationInputs struct {
	registration, manifest []byte
	expected               ynxbatch.ArtifactPublisherRegistration
}

// A plan contains public DATA only. Its construction checks exact expected R,
// canonical original manifest and project binding; it does not grant authority.
type publicationPlan struct {
	message, manifest []byte
	expected          ynxbatch.ArtifactPublisherRegistration
}

func preparePublication(in publicationInputs, capacity uint64) (publicationPlan, resultCode) {
	if capacity != memberCapacity {
		return publicationPlan{}, resultCapacity
	}
	if len(in.registration) < 1 || len(in.registration) > registrationMaximum ||
		len(in.manifest) < 1 || len(in.manifest) > manifestMaximum {
		return publicationPlan{}, resultBounds
	}
	message, err := ynxbatch.BuildArtifactPublicationMessage(in.registration, in.manifest, in.expected)
	if err != nil {
		return publicationPlan{}, resultPublicBinding
	}
	inspected, err := ynxbatch.InspectArtifactPublicationMessage(message, in.expected, in.manifest)
	if err != nil || len(message) > publicationMessageMaximum || publicationMemberMaximum > memberCapacity {
		return publicationPlan{}, resultPublicBinding
	}
	return publicationPlan{message: message, manifest: inspected.ManifestOriginal, expected: inspected.Publisher}, resultOK
}

// Each cleanup is attempted even if an earlier step panics. This helper has no
// C entry point and does not inject a signing provider or authorization callback.
func runLogicalCleanup(steps ...func()) (ok bool) {
	ok = true
	for _, step := range steps {
		func() {
			defer func() {
				if recover() != nil {
					ok = false
				}
			}()
			step()
		}()
	}
	return ok
}

func finishPublication(candidate []byte, code resultCode, panicked, clean bool) ([]byte, resultCode, cleanupCode) {
	cleanup := cleanupLogicalComplete
	switch {
	case !clean:
		code, cleanup = resultCleanup, cleanupFailed
	case panicked:
		code, cleanup = resultInternal, cleanupUnknown
	}
	if code != resultOK || cleanup != cleanupLogicalComplete {
		clear(candidate)
		return nil, code, cleanup
	}
	return candidate, code, cleanup
}

// The only private operation is fixed ArtifactPublication N=1 signing. Material
// is borrowed only for this call; copies are first made after public preflight.
// Neither the package nor this function retains any key/handle on return.
func signPrepared(plan publicationPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize ||
		len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		clean := runLogicalCleanup(func() { batch.Discard() }, func() { key.Destroy() }, func() { owned.Clear() })
		// A panic inside import/provider may hide partial internal state.
		// Clearing known owned buffers does not turn that into a guarantee.
		output, code, cleanup = finishPublication(candidate, code, panicked, clean)
	}()
	// Assign each independent allocation before attempting the next, so partial
	// ownership is visible to deferred cleanup. Never mutate the borrowed spans.
	owned.PKCS8A = bytes.Clone(borrowed.PKCS8A)
	owned.PKCS8B = bytes.Clone(borrowed.PKCS8B)
	owned.PKA = bytes.Clone(borrowed.PKA)
	owned.PKB = bytes.Clone(borrowed.PKB)
	if !bytes.Equal(owned.PKA, plan.expected.PKA) || !bytes.Equal(owned.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	var public ynxbatch.PublicKey
	var err error
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, plan.expected.PKA) || !bytes.Equal(public.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID,
		Owner: plan.expected.SubjectOwner, Purpose: ynxbatch.ArtifactPublicationPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > publicationMemberMaximum || len(candidate) > memberCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	if _, err := ynxbatch.InspectArtifactPublicationMember(candidate, plan.expected, plan.manifest); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	// The named return is released only after the deferred logical cleanup has
	// run. This is not a claim that the Go/CIRCL heaps have been physically wiped.
	return candidate, resultOK, cleanupUnknown
}

type memoryRange struct{ start, length uintptr }

func (r memoryRange) valid() bool {
	return r.start != 0 && r.length != 0 && r.length <= ^uintptr(0)-r.start
}

func overlaps(a, b memoryRange) bool {
	return a.start < b.start+b.length && b.start < a.start+a.length
}

// Addresses must already be valid caller-owned C allocations. These checks
// detect arithmetic overflow and writes into known input ranges, not mapping,
// allocation-size, provenance or lifetime errors in arbitrary C pointers.
func checkMemoryLayout(request memoryRange, inputs, outputs []memoryRange) resultCode {
	if !request.valid() {
		return resultBounds
	}
	for _, r := range inputs {
		if !r.valid() {
			return resultBounds
		}
	}
	for i, out := range outputs {
		if !out.valid() {
			return resultBounds
		}
		if overlaps(out, request) {
			return resultOverlap
		}
		for _, in := range inputs {
			if overlaps(out, in) {
				return resultOverlap
			}
		}
		for _, other := range outputs[:i] {
			if overlaps(out, other) {
				return resultOverlap
			}
		}
	}
	return resultOK
}

func main() {}
