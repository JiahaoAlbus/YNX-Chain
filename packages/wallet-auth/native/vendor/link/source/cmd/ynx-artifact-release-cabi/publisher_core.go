package main

import (
	"bytes"
	"encoding/binary"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	publisherRegistrationABIVersion = 1
	publisherMemberCapacity         = 131072
	publisherPublicCapacity         = 8192
	publisherPrivateCapacity        = 16384
	publisherCustodyMagic           = "YNX-PUBLISHER-CUSTODY/v1\n"
	publisherPoPMemberMaximum       = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + ynxbatch.MaxPublisherRegistrationPoPMessageBytes + 28
	publisherCustodianMemberMaximum = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + ynxbatch.MaxPublisherRegistrationCustodianMessageBytes + 28
)

type publisherIdentity struct {
	NetworkID                                                          []byte
	SubjectOwner, Account, ProjectID, PublisherID, PublisherKeyVersion string
}

type publisherGeneratePlan struct{ identity publisherIdentity }

func preparePublisherGenerate(in publisherIdentity, privateCapacity, publicCapacity uint64) (publisherGeneratePlan, resultCode) {
	if privateCapacity != publisherPrivateCapacity || publicCapacity != publisherPublicCapacity {
		return publisherGeneratePlan{}, resultCapacity
	}
	// Reuse the sole R13 metadata parser before invoking any randomness. These
	// zero public placeholders are local syntax DATA only, never output, used as
	// a registration, or interpreted as an existing authorized pair.
	r := ynxbatch.ArtifactPublisherRegistration{NetworkID: in.NetworkID, SubjectOwner: in.SubjectOwner,
		Account: in.Account, ProjectID: in.ProjectID, PublisherID: in.PublisherID,
		PublisherKeyVersion: in.PublisherKeyVersion, PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize)}
	if _, err := ynxbatch.EncodeArtifactPublisherRegistration(r); err != nil {
		return publisherGeneratePlan{}, resultPublicBinding
	}
	in.NetworkID = bytes.Clone(in.NetworkID)
	return publisherGeneratePlan{identity: in}, resultOK
}

func finishPublisherGeneration(private, public []byte, code resultCode, panicked, clean bool) ([]byte, []byte, resultCode, cleanupCode) {
	cleanup := cleanupLogicalComplete
	if !clean {
		code, cleanup = resultCleanup, cleanupFailed
	} else if panicked {
		code, cleanup = resultInternal, cleanupUnknown
	}
	if code != resultOK || cleanup != cleanupLogicalComplete {
		clear(private)
		clear(public)
		return nil, nil, code, cleanup
	}
	return private, public, code, cleanup
}

// This creates only a fresh purpose-isolated pair. Main owns real Source,
// visible approval, a durable generation-once record and immediate protected
// retention of the first result. No issuer, account key, seed or RNG is an input.
// Returned transfer buffers are cleared by the synchronous C bridge after copy;
// the provider handles and intermediate exported material are cleaned here.
func generatePublisherPrepared(plan publisherGeneratePlan) (private, public []byte, code resultCode, cleanup cleanupCode) {
	var key, imported *ynxbatch.PrivateKey
	var material ynxbatch.KeyMaterial
	var candidatePrivate, candidatePublic []byte
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		clean := runLogicalCleanup(func() { imported.Destroy() }, func() { key.Destroy() }, func() { material.Clear() })
		private, public, code, cleanup = finishPublisherGeneration(candidatePrivate, candidatePublic, code, panicked, clean)
	}()
	var pair ynxbatch.PublicKey
	var err error
	key, pair, err = ynxbatch.KeyGen()
	if err != nil {
		return nil, nil, resultKeyMaterial, cleanupUnknown
	}
	material, err = ynxbatch.ExportKeyMaterial(key)
	if err != nil || !bytes.Equal(pair.PKA, material.PKA) || !bytes.Equal(pair.PKB, material.PKB) {
		return nil, nil, resultKeyMaterial, cleanupUnknown
	}
	var checked ynxbatch.PublicKey
	imported, checked, err = ynxbatch.ImportKeyMaterial(material)
	if err != nil || !bytes.Equal(checked.PKA, pair.PKA) || !bytes.Equal(checked.PKB, pair.PKB) {
		return nil, nil, resultKeyMaterial, cleanupUnknown
	}
	i := plan.identity
	candidatePublic, err = ynxbatch.EncodeArtifactPublisherRegistration(ynxbatch.ArtifactPublisherRegistration{
		NetworkID: i.NetworkID, SubjectOwner: i.SubjectOwner, Account: i.Account, ProjectID: i.ProjectID,
		PublisherID: i.PublisherID, PublisherKeyVersion: i.PublisherKeyVersion, PKA: pair.PKA, PKB: pair.PKB})
	if err != nil || len(candidatePublic) == 0 || len(candidatePublic) > publisherPublicCapacity {
		return nil, nil, resultOutputValidation, cleanupUnknown
	}
	// Exact existing Main custody storage, not a new KEY7 wire or public JSON.
	candidatePrivate = make([]byte, 0, len(publisherCustodyMagic)+20+len(candidatePublic)+ynxbatch.PKCS8ASize+ynxbatch.PKCS8BSize+ynxbatch.PublicKeyASize+ynxbatch.PublicKeyBSize)
	candidatePrivate = append(candidatePrivate, publisherCustodyMagic...)
	for _, span := range [][]byte{candidatePublic, material.PKCS8A, material.PKCS8B, material.PKA, material.PKB} {
		candidatePrivate = binary.BigEndian.AppendUint32(candidatePrivate, uint32(len(span)))
		candidatePrivate = append(candidatePrivate, span...)
	}
	if len(candidatePrivate) > publisherPrivateCapacity {
		return nil, nil, resultOutputValidation, cleanupUnknown
	}
	return candidatePrivate, candidatePublic, resultOK, cleanupUnknown
}

type publisherRegistrationInputs struct {
	public, principal, command, registration, pop []byte
	publisher                                     ynxbatch.ArtifactPublisherRegistration
	custodian                                     ynxbatch.PublisherRegistrationCustodianBinding
	atMS                                          uint64
}

type publisherRegistrationPlan struct {
	inputs  publisherRegistrationInputs
	message []byte
	custody bool
}

func clonePublisherRegistrationInputs(in publisherRegistrationInputs) publisherRegistrationInputs {
	in.public, in.principal, in.command = bytes.Clone(in.public), bytes.Clone(in.principal), bytes.Clone(in.command)
	in.registration, in.pop = bytes.Clone(in.registration), bytes.Clone(in.pop)
	in.publisher.NetworkID = bytes.Clone(in.publisher.NetworkID)
	in.publisher.PKA, in.publisher.PKB = bytes.Clone(in.publisher.PKA), bytes.Clone(in.publisher.PKB)
	in.custodian.NetworkID = bytes.Clone(in.custodian.NetworkID)
	in.custodian.PKA, in.custodian.PKB = bytes.Clone(in.custodian.PKA), bytes.Clone(in.custodian.PKB)
	return in
}

func publisherInputBounds(in publisherRegistrationInputs) bool {
	return len(in.public) > 0 && len(in.public) <= publisherPublicCapacity && len(in.principal) > 0 && len(in.principal) <= principalMaximum &&
		len(in.command) > 0 && len(in.command) <= commandMaximum && len(in.registration) > 0 && len(in.registration) <= ynxbatch.MaxPublisherRegistrationBodyBytes
}

func preparePublisherPoP(in publisherRegistrationInputs, capacity uint64) (publisherRegistrationPlan, resultCode) {
	if capacity != publisherMemberCapacity {
		return publisherRegistrationPlan{}, resultCapacity
	}
	if !publisherInputBounds(in) || len(in.pop) != 0 || publisherPoPMemberMaximum > publisherMemberCapacity {
		return publisherRegistrationPlan{}, resultBounds
	}
	message, err := ynxbatch.BuildPublisherRegistrationPoPMessage(in.public, in.principal, in.command, in.registration, in.publisher, in.atMS)
	if err != nil {
		return publisherRegistrationPlan{}, resultPublicBinding
	}
	return publisherRegistrationPlan{inputs: clonePublisherRegistrationInputs(in), message: message}, resultOK
}

// This local verifier proves only fixed-pair mathematical consistency. The
// independently admitted pair/current/role/expiry/ACL/Root remains Main/Auth's
// responsibility. The local resolver below is never a chain registration or
// Source factory, and this function returns no authorization capability.
func verifyPublisherMathematics(raw, network []byte, owner, purpose, version string, pkA, pkB []byte, height uint64) error {
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: network, Purpose: purpose,
		ResolveTrustedOwner: func(ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: network, Owner: owner, Purpose: purpose,
				PolicyRevision: version, PKA: pkA, PKB: pkB, Enabled: true}, nil
		}})
	if err != nil {
		return err
	}
	defer v.Clear()
	return v.VerifyOne(raw, height)
}

func preparePublisherCustodian(in publisherRegistrationInputs, capacity uint64) (publisherRegistrationPlan, resultCode) {
	if capacity != publisherMemberCapacity {
		return publisherRegistrationPlan{}, resultCapacity
	}
	if !publisherInputBounds(in) || len(in.pop) == 0 || len(in.pop) > ynxbatch.MaxPublisherRegistrationPoPMemberBytes || publisherCustodianMemberMaximum > publisherMemberCapacity {
		return publisherRegistrationPlan{}, resultBounds
	}
	if _, err := ynxbatch.InspectPublisherRegistrationPoPMember(in.pop, in.publisher, in.public, in.principal, in.command, in.registration, in.atMS); err != nil {
		return publisherRegistrationPlan{}, resultPublicBinding
	}
	if bytes.Equal(in.publisher.PKA, in.custodian.PKA) || bytes.Equal(in.publisher.PKB, in.custodian.PKB) ||
		verifyPublisherMathematics(in.pop, in.publisher.NetworkID, in.publisher.SubjectOwner, ynxbatch.PublisherRegistrationPoPPurpose,
			in.publisher.PublisherKeyVersion, in.publisher.PKA, in.publisher.PKB, 0) != nil {
		return publisherRegistrationPlan{}, resultPublicBinding
	}
	message, err := ynxbatch.BuildPublisherRegistrationCustodianMessage(in.public, in.principal, in.command, in.registration, in.pop, in.publisher, in.custodian, in.atMS)
	if err != nil {
		return publisherRegistrationPlan{}, resultPublicBinding
	}
	return publisherRegistrationPlan{inputs: clonePublisherRegistrationInputs(in), message: message, custody: true}, resultOK
}

func signPublisherPrepared(plan publisherRegistrationPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize || len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
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
		output, code, cleanup = finishPublication(candidate, code, panicked, clean)
	}()
	in := plan.inputs
	network, owner, purpose, version, pkA, pkB, height := in.publisher.NetworkID, in.publisher.SubjectOwner,
		ynxbatch.PublisherRegistrationPoPPurpose, in.publisher.PublisherKeyVersion, in.publisher.PKA, in.publisher.PKB, uint64(0)
	if plan.custody {
		network, owner, purpose, version, pkA, pkB = in.custodian.NetworkID, in.custodian.Owner,
			ynxbatch.PublisherRegistrationCustodianPurpose, in.custodian.KeyVersion, in.custodian.PKA, in.custodian.PKB
		var err error
		height, err = strconv.ParseUint(in.custodian.ExecutionHeight, 10, 64)
		if err != nil {
			return nil, resultPublicBinding, cleanupUnknown
		}
	}
	// Publish each owned allocation to deferred cleanup before allocating the
	// next; a later allocation panic must not hide an earlier private copy.
	owned.PKCS8A = bytes.Clone(borrowed.PKCS8A)
	owned.PKCS8B = bytes.Clone(borrowed.PKCS8B)
	owned.PKA = bytes.Clone(borrowed.PKA)
	owned.PKB = bytes.Clone(borrowed.PKB)
	if !bytes.Equal(owned.PKA, pkA) || !bytes.Equal(owned.PKB, pkB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	var public ynxbatch.PublicKey
	var err error
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, pkA) || !bytes.Equal(public.PKB, pkB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: purpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > publisherMemberCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	if plan.custody {
		_, err = ynxbatch.InspectPublisherRegistrationCustodianMember(candidate, in.custodian, in.publisher, in.public, in.principal, in.command, in.registration, in.pop, in.atMS)
	} else {
		_, err = ynxbatch.InspectPublisherRegistrationPoPMember(candidate, in.publisher, in.public, in.principal, in.command, in.registration, in.atMS)
	}
	if err != nil || verifyPublisherMathematics(candidate, network, owner, purpose, version, pkA, pkB, height) != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}
