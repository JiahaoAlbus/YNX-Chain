package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func publisherCoreIdentity() publisherIdentity {
	return publisherIdentity{NetworkID: bytes.Repeat([]byte{0x42}, 32), SubjectOwner: "0x" + strings.Repeat("11", 20),
		Account: "synthetic-publisher-account", ProjectID: "synthetic-publisher-project", PublisherID: "synthetic-publisher", PublisherKeyVersion: "18446744073709551615"}
}

func publisherCoreSHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Independent read of Main's existing storage: literal magic, exactly five
// big-endian length-prefixed spans, no JSON/KEY7 alias or trailing material.
// Nothing is persisted or printed. Returned material is owned by this test.
func publisherCoreReadCustody(t *testing.T, private, public []byte) ynxbatch.KeyMaterial {
	t.Helper()
	const magic = "YNX-PUBLISHER-CUSTODY/v1\n"
	if len(private) > 16384 || len(public) == 0 || len(public) > 8192 || !bytes.HasPrefix(private, []byte(magic)) {
		t.Fatal("generated result differs from the existing Main custody profile")
	}
	left := private[len(magic):]
	spans := make([][]byte, 0, 5)
	for i := 0; i < 5; i++ {
		if len(left) < 4 {
			t.Fatal("generated custody span length is absent")
		}
		n := uint64(binary.BigEndian.Uint32(left[:4]))
		left = left[4:]
		if n > uint64(len(left)) {
			t.Fatal("generated custody span exceeds the original record")
		}
		spans = append(spans, left[:int(n)])
		left = left[int(n):]
	}
	if len(left) != 0 || !bytes.Equal(spans[0], public) || len(spans[1]) != 54 || len(spans[2]) != 150 || len(spans[3]) != 2592 || len(spans[4]) != 64 {
		t.Fatal("generated custody omitted, relabelled or changed a complete original span")
	}
	return ynxbatch.KeyMaterial{PKCS8A: bytes.Clone(spans[1]), PKCS8B: bytes.Clone(spans[2]), PKA: bytes.Clone(spans[3]), PKB: bytes.Clone(spans[4])}
}

func publisherCoreInputs(t *testing.T, publisher ynxbatch.ArtifactPublisherRegistration) publisherRegistrationInputs {
	t.Helper()
	public, err := ynxbatch.EncodeArtifactPublisherRegistration(publisher)
	must(t, err)
	p := ynxbatch.ProjectControlPrincipal{Account: "synthetic-developer", DeviceID: "synthetic-device", SessionRef: "synthetic-session", CurrentRef: "synthetic-current",
		AccountGeneration: math.MaxUint64, SessionGeneration: 9007199254740993, ExpiresMS: 60000}
	principal, err := json.Marshal(p)
	must(t, err)
	c := ynxbatch.ProjectControlCommand{RequestID: "synthetic-publisher-request", Action: "project.publisher", ProjectID: publisher.ProjectID,
		SubjectAccount: publisher.Account, PublisherID: publisher.PublisherID, ExpectedRevision: 7, GrantExpiresMS: 60000, ExpiresMS: 60000, PublicOriginalSHA256: publisherCoreSHA(public)}
	command, err := json.Marshal(c)
	must(t, err)
	// The exported body struct is already declared in the SDK's sorted order.
	// ASCII synthetic fields make Go's string encoding identical to canonical().
	b := ynxbatch.PublisherRegistrationBody{Account: publisher.Account, CallerIdentity: "synthetic-native-caller", CommandSHA256: publisherCoreSHA(command),
		CustodyCurrentRef: "synthetic-custody-current", ExpiresAtMS: 20000, IssuedAtMS: 1000, KeyRole: "ide-artifact-publisher",
		Nonce: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)), PrincipalSHA256: publisherCoreSHA(principal), ProjectID: publisher.ProjectID,
		PublicSHA256: publisherCoreSHA(public), PublisherID: publisher.PublisherID, PublisherKeyVersion: publisher.PublisherKeyVersion,
		RegistrationRef: "synthetic-registration", SourceCurrentRef: p.CurrentRef, Version: "YNX-IDE-PROTECTED-PUBLISHER-REGISTRATION/v1"}
	registration, err := json.Marshal(b)
	must(t, err)
	return publisherRegistrationInputs{public: public, principal: principal, command: command, registration: registration, publisher: publisher, atMS: 1001}
}

func publisherCoreVerify(t *testing.T, wire []byte, network []byte, owner, purpose, version string, pair ynxbatch.PublicKey, height uint64) {
	t.Helper()
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: network, Purpose: purpose, Optimized: true,
		ResolveTrustedOwner: func(q ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			if q.Owner != owner || q.Purpose != purpose || q.Height != height || !bytes.Equal(q.ChainID, network) {
				return ynxbatch.Registration{}, errors.New("synthetic public mathematical context mismatch")
			}
			// This mathematical test resolver grants no real Source/current/role.
			return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: network, Owner: owner, Purpose: purpose,
				PolicyRevision: version, PKA: pair.PKA, PKB: pair.PKB, Enabled: true}, nil
		}})
	must(t, err)
	defer v.Clear()
	must(t, v.VerifyOne(wire, height))
}

func publisherCoreFrame(t *testing.T, message []byte, expected [][]byte) {
	t.Helper()
	parts, err := ynxbatch.DecodeFields(message, len(expected), ynxbatch.MaxMessageBytes)
	must(t, err)
	for i := range expected {
		if !bytes.Equal(parts[i], expected[i]) {
			t.Fatal("fixed SDK46 message field differs from its exact original", i)
		}
	}
}

func publisherCoreMutateInputs(in publisherRegistrationInputs) {
	for _, raw := range [][]byte{in.public, in.principal, in.command, in.registration, in.pop,
		in.publisher.NetworkID, in.publisher.PKA, in.publisher.PKB, in.custodian.NetworkID, in.custodian.PKA, in.custodian.PKB} {
		if len(raw) > 0 {
			raw[0] ^= 1
		}
	}
}

func publisherCoreInputDigests(in publisherRegistrationInputs) [11]string {
	var digests [11]string
	for i, raw := range [][]byte{in.public, in.principal, in.command, in.registration, in.pop,
		in.publisher.NetworkID, in.publisher.PKA, in.publisher.PKB, in.custodian.NetworkID, in.custodian.PKA, in.custodian.PKB} {
		digests[i] = publisherCoreSHA(raw)
	}
	return digests
}

func publisherCoreRequireSignFailure(t *testing.T, plan publisherRegistrationPlan, borrowed ynxbatch.KeyMaterial, expected resultCode, expectedCleanup cleanupCode) {
	t.Helper()
	before := cloneMaterial(borrowed)
	defer before.Clear()
	out, code, cleanup := signPublisherPrepared(plan, borrowed)
	defer clear(out)
	if len(out) != 0 || code != expected || cleanup != expectedCleanup {
		t.Fatal("failed publisher signing released output or misreported cleanup")
	}
	equalMaterial(t, borrowed, before)
}

func TestPublisherCoreGenerationMainCustodyAndSDK46DualProofs(t *testing.T) {
	// Real generation/signing occurs only when the normal CI executes this test.
	// All keys are ephemeral synthetic pairs in process memory, never real grants.
	identity := publisherCoreIdentity()
	plan, code := preparePublisherGenerate(identity, 16384, 8192)
	if code != resultOK {
		t.Fatal("valid public generation preflight refused")
	}
	expectedNetwork := bytes.Clone(identity.NetworkID)
	identity.NetworkID[0] ^= 1
	private, public, code, cleanup := generatePublisherPrepared(plan)
	defer clear(private)
	defer clear(public)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("generation failed or released an uncertain first result")
	}
	material := publisherCoreReadCustody(t, private, public)
	defer material.Clear()
	privateBefore, publicBefore := bytes.Clone(private), bytes.Clone(public)
	defer clear(privateBefore)
	defer clear(publicBefore)
	imported, pair, err := ynxbatch.ImportKeyMaterial(material)
	must(t, err)
	defer imported.Destroy()
	publisher, err := ynxbatch.DecodeArtifactPublisherRegistration(public)
	must(t, err)
	if !bytes.Equal(publisher.NetworkID, expectedNetwork) || publisher.SubjectOwner != identity.SubjectOwner || publisher.Account != identity.Account ||
		publisher.ProjectID != identity.ProjectID || publisher.PublisherID != identity.PublisherID || publisher.PublisherKeyVersion != identity.PublisherKeyVersion ||
		!bytes.Equal(publisher.PKA, pair.PKA) || !bytes.Equal(publisher.PKB, pair.PKB) || !bytes.Equal(material.PKA, pair.PKA) || !bytes.Equal(material.PKB, pair.PKB) {
		t.Fatal("generated R13 changed metadata, aliases the input, or differs from imported complete pair")
	}
	// A second explicit synthetic generation must obtain two fresh branches.
	// It also supplies this test's independent mathematical custodian pair.
	otherIdentity := publisherCoreIdentity()
	otherIdentity.SubjectOwner = "0x" + strings.Repeat("22", 20)
	otherIdentity.PublisherID = "synthetic-custodian-pair"
	otherPlan, code := preparePublisherGenerate(otherIdentity, publisherPrivateCapacity, publisherPublicCapacity)
	if code != resultOK {
		t.Fatal("second synthetic generation preflight refused")
	}
	otherPrivate, otherPublic, code, cleanup := generatePublisherPrepared(otherPlan)
	defer clear(otherPrivate)
	defer clear(otherPublic)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("second synthetic generation failed")
	}
	otherMaterial := publisherCoreReadCustody(t, otherPrivate, otherPublic)
	defer otherMaterial.Clear()
	otherImported, otherPair, err := ynxbatch.ImportKeyMaterial(otherMaterial)
	must(t, err)
	defer otherImported.Destroy()
	if bytes.Equal(pair.PKA, otherPair.PKA) || bytes.Equal(pair.PKB, otherPair.PKB) {
		t.Fatal("generation reused a publisher algorithm key")
	}
	in := publisherCoreInputs(t, publisher)
	in.custodian = ynxbatch.PublisherRegistrationCustodianBinding{NetworkID: bytes.Clone(expectedNetwork), Owner: otherIdentity.SubjectOwner,
		KeyVersion: "18446744073709551615", ExecutionHeight: "18446744073709551615", CallerIdentity: "synthetic-native-caller", SourceCurrentRef: "synthetic-custody-current",
		PKA: bytes.Clone(otherPair.PKA), PKB: bytes.Clone(otherPair.PKB)}
	originalDigests := publisherCoreInputDigests(in)
	popPlan, code := preparePublisherPoP(in, 131072)
	if code != resultOK || popPlan.custody {
		t.Fatal("valid exact E9 preflight refused")
	}
	stable := clonePublisherRegistrationInputs(in)
	publisherCoreMutateInputs(in)
	if publisherCoreInputDigests(popPlan.inputs) != originalDigests || !reflect.DeepEqual(popPlan.inputs, stable) {
		t.Fatal("PoP plan retained caller-owned original or complete-pair buffers")
	}
	popBorrow := cloneMaterial(material)
	defer popBorrow.Clear()
	popBefore := cloneMaterial(popBorrow)
	defer popBefore.Clear()
	pop, code, cleanup := signPublisherPrepared(popPlan, popBorrow)
	defer clear(pop)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(pop) == 0 || len(pop) > publisherMemberCapacity {
		t.Fatal("fixed E9 signing or postcondition failed")
	}
	equalMaterial(t, popBorrow, popBefore)
	popMember, err := ynxbatch.InspectPublisherRegistrationPoPMember(pop, stable.publisher, stable.public, stable.principal, stable.command, stable.registration, stable.atMS)
	must(t, err)
	publisherCoreFrame(t, popMember.Message, [][]byte{[]byte("YNX-IDE-PUBLISHER-REGISTRATION/v1"), []byte("YNX-BATCH/v0.1"),
		[]byte("ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"), []byte("IDE-PUBLISHER-REGISTRATION"), expectedNetwork,
		[]byte(publisher.SubjectOwner), []byte(publisher.PublisherKeyVersion), stable.public, stable.registration})
	publisherCoreVerify(t, pop, expectedNetwork, publisher.SubjectOwner, "IDE-PUBLISHER-REGISTRATION", publisher.PublisherKeyVersion, pair, 0)
	in = stable
	in.pop = bytes.Clone(pop)
	originalDigests = publisherCoreInputDigests(in)
	custodianPlan, code := preparePublisherCustodian(in, publisherMemberCapacity)
	if code != resultOK || !custodianPlan.custody {
		t.Fatal("valid full AND PoP did not reach fixed E12 preflight")
	}
	stable = clonePublisherRegistrationInputs(in)
	publisherCoreMutateInputs(in)
	if publisherCoreInputDigests(custodianPlan.inputs) != originalDigests || !reflect.DeepEqual(custodianPlan.inputs, stable) {
		t.Fatal("custodian plan retained a caller original, PoP or complete pair")
	}
	custodianBorrow := cloneMaterial(otherMaterial)
	defer custodianBorrow.Clear()
	custodianBefore := cloneMaterial(custodianBorrow)
	defer custodianBefore.Clear()
	custodian, code, cleanup := signPublisherPrepared(custodianPlan, custodianBorrow)
	defer clear(custodian)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(custodian) == 0 || len(custodian) > publisherMemberCapacity {
		t.Fatal("fixed E12 signing or postcondition failed")
	}
	equalMaterial(t, custodianBorrow, custodianBefore)
	custodianMember, err := ynxbatch.InspectPublisherRegistrationCustodianMember(custodian, stable.custodian, stable.publisher,
		stable.public, stable.principal, stable.command, stable.registration, stable.pop, stable.atMS)
	must(t, err)
	publisherCoreFrame(t, custodianMember.Message, [][]byte{[]byte("YNX-AUTH-PROTECTED-PUBLISHER-REGISTRATION/v1"), []byte("YNX-BATCH/v0.1"),
		[]byte("ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"), []byte("AUTH-PUBLISHER-REGISTRATION"), expectedNetwork,
		[]byte(stable.custodian.Owner), []byte(stable.custodian.KeyVersion), []byte(stable.custodian.ExecutionHeight), stable.principal, stable.command, stable.registration, []byte(publisherCoreSHA(pop))})
	height, err := strconv.ParseUint(stable.custodian.ExecutionHeight, 10, 64)
	must(t, err)
	publisherCoreVerify(t, custodian, expectedNetwork, stable.custodian.Owner, "AUTH-PUBLISHER-REGISTRATION", stable.custodian.KeyVersion, otherPair, height)
	t.Run("public rejection precedes private borrow", func(t *testing.T) {
		for _, change := range []string{"expired", "original", "shared A", "shared B", "bad PoP A", "bad PoP B", "Whole PoP"} {
			bad := clonePublisherRegistrationInputs(stable)
			switch change {
			case "expired":
				bad.atMS = 20000
			case "original":
				bad.registration = append(bad.registration, '\n')
			case "shared A":
				bad.custodian.PKA = bytes.Clone(bad.publisher.PKA)
			case "shared B":
				bad.custodian.PKB = bytes.Clone(bad.publisher.PKB)
			case "bad PoP A", "bad PoP B":
				m, err := ynxbatch.DecodeMember(bad.pop)
				must(t, err)
				if change == "bad PoP A" {
					m.Certificate.SigmaA[0] ^= 1
				} else {
					m.Certificate.SigmaB[0] ^= 1
				}
				bad.pop, err = ynxbatch.EncodeMember(m)
				must(t, err)
			case "Whole PoP":
				bad.pop, err = ynxbatch.EncodeWhole(ynxbatch.Whole{Certificate: popMember.Certificate, Messages: [][]byte{popMember.Message}})
				must(t, err)
			}
			if rejected, code := preparePublisherCustodian(bad, publisherMemberCapacity); code != resultPublicBinding || len(rejected.message) != 0 {
				t.Fatal("invalid public context or PoP reached private signing preflight", change)
			}
		}
	})
	t.Run("wrong and inconsistent borrowed private pair", func(t *testing.T) {
		publisherCoreRequireSignFailure(t, popPlan, otherMaterial, resultKeyMaterial, cleanupLogicalComplete)
		publisherCoreRequireSignFailure(t, custodianPlan, material, resultKeyMaterial, cleanupLogicalComplete)
		for _, which := range []string{"A seed", "B root", "truncated A"} {
			bad := cloneMaterial(material)
			switch which {
			case "A seed":
				bad.PKCS8A[22] ^= 1
			case "B root":
				bad.PKCS8B[118] ^= 1
			case "truncated A":
				bad.PKCS8A = bad.PKCS8A[:len(bad.PKCS8A)-1]
			}
			state := cleanupLogicalComplete
			if which == "truncated A" {
				state = cleanupNotRequired
			}
			publisherCoreRequireSignFailure(t, popPlan, bad, resultKeyMaterial, state)
			bad.Clear()
		}
	})
	t.Run("real signing cannot release altered prepared message", func(t *testing.T) {
		bad := popPlan
		bad.message = bytes.Clone(popPlan.message)
		bad.message[len(bad.message)-1] ^= 1
		publisherCoreRequireSignFailure(t, bad, material, resultOutputValidation, cleanupLogicalComplete)
	})
	if !bytes.Equal(private, privateBefore) || !bytes.Equal(public, publicBefore) {
		t.Fatal("Import or signing mutated Main's original generated transfer buffers")
	}
}

func TestPublisherCoreFixedCapacitiesAndPublicBounds(t *testing.T) {
	identity := publisherCoreIdentity()
	for _, capacity := range []uint64{0, 16383, 16385, math.MaxUint64} {
		if _, code := preparePublisherGenerate(identity, capacity, 8192); code != resultCapacity {
			t.Fatal("generation accepted a nonfixed private capacity")
		}
	}
	for _, capacity := range []uint64{0, 8191, 8193, math.MaxUint64} {
		if _, code := preparePublisherGenerate(identity, 16384, capacity); code != resultCapacity {
			t.Fatal("generation accepted a nonfixed public capacity")
		}
	}
	for _, change := range []string{"network", "owner", "account", "version"} {
		bad := publisherCoreIdentity()
		switch change {
		case "network":
			bad.NetworkID = bad.NetworkID[:31]
		case "owner":
			bad.SubjectOwner = "not-a-canonical-owner"
		case "account":
			bad.Account = ""
		case "version":
			bad.PublisherKeyVersion = "01"
		}
		if _, code := preparePublisherGenerate(bad, 16384, 8192); code != resultPublicBinding {
			t.Fatal("invalid original identity reached generation", change)
		}
	}
	public := ynxbatch.ArtifactPublisherRegistration{NetworkID: identity.NetworkID, SubjectOwner: identity.SubjectOwner, Account: identity.Account,
		ProjectID: identity.ProjectID, PublisherID: identity.PublisherID, PublisherKeyVersion: identity.PublisherKeyVersion,
		PKA: bytes.Repeat([]byte{0x53}, 2592), PKB: bytes.Repeat([]byte{0x75}, 64)}
	in := publisherCoreInputs(t, public)
	if _, code := preparePublisherPoP(in, 131072); code != resultOK || publisherPoPMemberMaximum > 131072 || publisherCustodianMemberMaximum > 131072 {
		t.Fatal("valid fixed public profile does not fit its ABI capacity")
	}
	for _, capacity := range []uint64{0, 131071, 131073, math.MaxUint64} {
		if _, code := preparePublisherPoP(in, capacity); code != resultCapacity {
			t.Fatal("PoP accepted a nonfixed output capacity")
		}
		if _, code := preparePublisherCustodian(in, capacity); code != resultCapacity {
			t.Fatal("custodian accepted a nonfixed output capacity")
		}
	}
	for _, operand := range []string{"public", "principal", "command", "registration", "pop"} {
		bad := clonePublisherRegistrationInputs(in)
		switch operand {
		case "public":
			bad.public = make([]byte, 8193)
		case "principal":
			bad.principal = make([]byte, ynxbatch.MaxProjectControlPrincipalBytes+1)
		case "command":
			bad.command = make([]byte, ynxbatch.MaxProjectControlCommandBytes+1)
		case "registration":
			bad.registration = make([]byte, ynxbatch.MaxPublisherRegistrationBodyBytes+1)
		case "pop":
			bad.pop = []byte{1}
		}
		if _, code := preparePublisherPoP(bad, publisherMemberCapacity); code != resultBounds {
			t.Fatal("oversized original or extra PoP reached publisher preflight", operand)
		}
	}
	for _, change := range []string{"expired", "changed original", "changed pair"} {
		bad := clonePublisherRegistrationInputs(in)
		switch change {
		case "expired":
			bad.atMS = 20000
		case "changed original":
			bad.public[len(bad.public)-1] ^= 1
		case "changed pair":
			bad.publisher.PKB[0] ^= 1
		}
		if _, code := preparePublisherPoP(bad, publisherMemberCapacity); code != resultPublicBinding {
			t.Fatal("expired or altered original reached PoP preflight", change)
		}
	}
	in.pop = make([]byte, ynxbatch.MaxPublisherRegistrationPoPMemberBytes+1)
	if _, code := preparePublisherCustodian(in, publisherMemberCapacity); code != resultBounds {
		t.Fatal("oversized original PoP reached mathematical verification")
	}
}

func TestPublisherCoreGenerationCleanupClearsBothCandidates(t *testing.T) {
	steps := 0
	if runLogicalCleanup(func() { steps++ }, func() { steps++; panic("synthetic cleanup failure") }, func() { steps++ }) || steps != 3 {
		t.Fatal("failed cleanup skipped a remaining owned allocation")
	}
	for _, test := range []struct {
		code            resultCode
		panicked, clean bool
		wantCode        resultCode
		wantCleanup     cleanupCode
	}{
		{resultKeyMaterial, false, true, resultKeyMaterial, cleanupLogicalComplete},
		{resultOutputValidation, false, true, resultOutputValidation, cleanupLogicalComplete},
		{resultOK, true, true, resultInternal, cleanupUnknown},
		{resultOK, false, false, resultCleanup, cleanupFailed},
		{resultOK, true, false, resultCleanup, cleanupFailed},
	} {
		privateCandidate, publicCandidate := []byte{1, 2, 3, 4}, []byte{5, 6, 7}
		private, public, code, cleanup := finishPublisherGeneration(privateCandidate, publicCandidate, test.code, test.panicked, test.clean)
		if private != nil || public != nil || code != test.wantCode || cleanup != test.wantCleanup ||
			!bytes.Equal(privateCandidate, make([]byte, len(privateCandidate))) || !bytes.Equal(publicCandidate, make([]byte, len(publicCandidate))) {
			t.Fatal("uncertain generation released or retained a candidate buffer")
		}
	}
	privateCandidate, publicCandidate := []byte{1, 2}, []byte{3, 4}
	private, public, code, cleanup := finishPublisherGeneration(privateCandidate, publicCandidate, resultOK, false, true)
	if code != resultOK || cleanup != cleanupLogicalComplete || !bytes.Equal(private, privateCandidate) || !bytes.Equal(public, publicCandidate) ||
		&private[0] != &privateCandidate[0] || &public[0] != &publicCandidate[0] {
		t.Fatal("completed logical cleanup did not return the exact first generated candidates")
	}
	clear(private)
	clear(public)
}
