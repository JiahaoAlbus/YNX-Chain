package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Public syntax vectors were encoded independently with E(field count, each
// big-endian byte length and bytes), BigInt high/low U32 pairs and SHA-256.
// Their hash-shaped fields are deliberately not a second trusted code registry.
func contractActionVectors() []actionVector {
	deploy := func(name string) ContractDeployPayload {
		return ContractDeployPayload{Name: name, SourceHash: strings.Repeat("ab", 32), DeployedBytecodeHash: strings.Repeat("cd", 32), CompilerConfigHash: strings.Repeat("ef", 32), ConstructorArgs: []uint64{math.MaxUint64}}
	}
	execute := func(name, calldata string) ContractExecutePayload {
		return ContractExecutePayload{Name: name, Target: qaTo, SourceHash: strings.Repeat("ab", 32), DeployedBytecodeHash: strings.Repeat("cd", 32), CompilerConfigHash: strings.Repeat("ef", 32), ExpectedStorageCommitment: strings.Repeat("01", 32), Calldata: calldata}
	}
	return []actionVector{
		{ActionContractDeploy, deploy(ContractCounterName), 9, []int{4, 5, 6, 7, 8}, 462, "031252926a6222bbdd371726ec4cf78e93d71f0232dcd376d05156cec70ea634"},
		{ActionContractExecute, execute(ContractCounterName, "0x7cf5dab0"+strings.Repeat("f", 64)), 9, []int{7, 8}, 631, "956422593a04447ea54ea4e4899b067172ad471b50b74c1497066c4a660087e6"},
		{ActionContractDeploy, deploy(ContractERC20Name), 9, []int{4, 5, 6, 7, 8}, 466, "8c29ba429d2154a3b0460e619b03cd648bfdb2853d926c3f88e8576be4dcb2c2"},
		{ActionContractExecute, execute(ContractERC20Name, "0xa9059cbb"+strings.Repeat("0", 24)+strings.TrimPrefix(qaTo, "0x")+strings.Repeat("f", 64)), 9, []int{7, 8}, 699, "57b5e42970c80acb86b73d54cc3aabbca8b403f56259dbbc5601a34ef8112c9d"},
	}
}

func contractVectorAction(t testing.TB, v actionVector) Action {
	t.Helper()
	a := vectorAction(t, v)
	a.Fee = ContractExecuteFee
	if v.kind == ActionContractDeploy {
		a.Fee = ContractDeployFee
	}
	return a
}

func TestContractActionIndependentVectorsAndCanonicalRoundtrip(t *testing.T) {
	for i, v := range contractActionVectors() {
		a := contractVectorAction(t, v)
		wire, err := a.SigningBytes()
		authOK(t, err)
		digest := sha256.Sum256(wire)
		if len(wire) != v.wireLength || hex.EncodeToString(digest[:]) != v.sha256 {
			t.Fatalf("vector %d differs from independent encoding: len=%d sha256=%x", i, len(wire), digest)
		}
		decoded, err := DecodeAction(wire)
		authOK(t, err)
		if !reflect.DeepEqual(decoded, a) {
			t.Fatal("action roundtrip changed identity, uint64 or payload bytes")
		}
		p, err := DecodeActionPayload(a.Kind, decoded.Payload)
		authOK(t, err)
		if !reflect.DeepEqual(p, v.payload) {
			t.Fatal("typed contract payload changed in roundtrip")
		}
		wire[len(wire)-1] ^= 1
		if !bytes.Equal(decoded.Payload, a.Payload) {
			t.Fatal("decoded payload aliases its input frame")
		}
	}
	// The constructor subset supports the full u64 range, including values above
	// the JSON safe-integer and int64 boundaries, but does not promise u256 init.
	for _, value := range []uint64{0, 1, 1<<32 + 1, 1<<53 + 1, 1<<63 + 1, math.MaxUint64} {
		p := contractActionVectors()[0].payload.(ContractDeployPayload)
		p.ConstructorArgs = []uint64{value}
		wire, err := EncodeActionPayload(ActionContractDeploy, p)
		authOK(t, err)
		decoded, err := DecodeActionPayload(ActionContractDeploy, wire)
		authOK(t, err)
		if decoded.(ContractDeployPayload).ConstructorArgs[0] != value {
			t.Fatal("constructor argument narrowed")
		}
	}
}

func TestContractActionRejectsNoncanonicalFieldsAndABI(t *testing.T) {
	for _, tc := range []struct {
		vector int
		field  string
		value  any
	}{
		{0, "Name", "Other"}, {0, "Name", " " + ContractCounterName}, {0, "Name", ContractCounterName + "\n"}, {0, "Name", "\xff"},
		{0, "SourceHash", strings.Repeat("AB", 32)}, {0, "SourceHash", "0x" + strings.Repeat("ab", 32)}, {0, "SourceHash", strings.Repeat("a", 63)},
		{0, "DeployedBytecodeHash", strings.Repeat("g", 64)}, {0, "CompilerConfigHash", strings.Repeat("f", 65)}, {0, "CompilerConfigHash", "\xff" + strings.Repeat("a", 63)},
		{0, "ConstructorArgs", []uint64(nil)}, {0, "ConstructorArgs", []uint64{}}, {0, "ConstructorArgs", []uint64{1, 2}}, {0, "Value", uint64(1)}, {0, "Value", uint64(math.MaxUint64)},
		{1, "Name", "SampleEVMWriteCounter\x00"}, {1, "Target", qaFrom[2:]}, {1, "Target", strings.ToUpper(qaTo)}, {1, "Target", "0x" + strings.Repeat("0", 40)}, {1, "Target", qaTo + " "},
		{1, "SourceHash", ""}, {1, "DeployedBytecodeHash", strings.Repeat("C", 64)}, {1, "CompilerConfigHash", strings.Repeat("e", 63)}, {1, "ExpectedStorageCommitment", "0x" + strings.Repeat("01", 32)}, {1, "ExpectedStorageCommitment", strings.Repeat("x", 64)},
		{1, "Calldata", "0x"}, {1, "Calldata", "0x7cf5dab0"}, {1, "Calldata", "0x7cf5dab0" + strings.Repeat("f", 63)}, {1, "Calldata", "0x7cf5dab0" + strings.Repeat("F", 64)},
		{1, "Calldata", "0x06661abd" + strings.Repeat("0", 64)}, {1, "Calldata", "0x7cf5dab0" + strings.Repeat("0", 66)}, {1, "Calldata", "0x7cf5dab0" + strings.Repeat("0", 63) + "\xff"}, {1, "Value", uint64(1)},
		{3, "Calldata", "0xa9059cbb" + "1" + strings.Repeat("0", 127)}, {3, "Calldata", "0xa9059cbb" + strings.Repeat("0", 127)}, {3, "Calldata", "0xa9059cbb" + strings.Repeat("0", 130)},
		{3, "Calldata", "0xdeadbeef" + strings.Repeat("0", 128)}, {3, "Value", uint64(math.MaxUint64)},
	} {
		v := contractActionVectors()[tc.vector]
		p := reflect.New(reflect.TypeOf(v.payload)).Elem()
		p.Set(reflect.ValueOf(v.payload))
		p.FieldByName(tc.field).Set(reflect.ValueOf(tc.value))
		_, err := EncodeActionPayload(v.kind, p.Interface())
		actionReject(t, err)
	}
	for _, v := range contractActionVectors() {
		for _, value := range []any{map[string]any{"name": ContractCounterName}, &v.payload, []byte("{}"), nil} {
			_, err := EncodeActionPayload(v.kind, value)
			actionReject(t, err)
		}
		_, err := EncodeActionPayload(ActionStake, v.payload)
		actionReject(t, err)
		a := contractVectorAction(t, v)
		for _, fee := range []uint64{0, 1, 3, 11, math.MaxInt64, math.MaxUint64} {
			a.Fee = fee
			_, err := a.SigningBytes()
			actionReject(t, err)
		}
	}
}

func TestContractActionRejectsMalformedFrames(t *testing.T) {
	for _, v := range contractActionVectors() {
		a := contractVectorAction(t, v)
		fields := authFields(t, a.Payload, 9)
		for _, invalid := range [][][]byte{fields[:8], append(fields, []byte("extra"))} {
			_, err := DecodeActionPayload(v.kind, authFrame(t, invalid))
			actionReject(t, err)
		}
		for _, i := range v.numeric {
			for _, width := range []int{0, 3, 5, 8} {
				f := authFields(t, a.Payload, 9)
				f[i] = make([]byte, width)
				_, err := DecodeActionPayload(v.kind, authFrame(t, f))
				actionReject(t, err)
			}
		}
		if v.kind == ActionContractDeploy {
			for _, count := range []uint32{0, 2, math.MaxUint32} {
				f := authFields(t, a.Payload, 9)
				f[4] = ynxbatch.U32(count)
				_, err := DecodeActionPayload(v.kind, authFrame(t, f))
				actionReject(t, err)
			}
		}
		for _, invalid := range [][]byte{a.Payload[:len(a.Payload)-1], append(bytes.Clone(a.Payload), 0), make([]byte, MaxActionPayloadBytes+1)} {
			_, err := DecodeActionPayload(v.kind, invalid)
			actionReject(t, err)
		}
		wire, err := a.SigningBytes()
		authOK(t, err)
		f := authFields(t, wire, 12)
		f[9] = ynxbatch.U32(1)
		_, err = DecodeAction(authFrame(t, f))
		actionReject(t, err)
	}
}

func TestContractActionSyntaxDoesNotGrantCodeOrExecutionAuthority(t *testing.T) {
	// Unknown-to-executor hash values still have a unique signing representation.
	// Only a ledger adapter can compare them with actual pinned code/prestate.
	for _, v := range contractActionVectors() {
		a := contractVectorAction(t, v)
		_, err := a.SigningBytes()
		authOK(t, err)
	}
}

func contractSignedMembers(t testing.TB, key *ynxbatch.PrivateKey, network []byte, owner string, messages [][]byte) [][]byte {
	t.Helper()
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	authOK(t, err)
	defer batch.Discard()
	members := make([][]byte, len(messages))
	for i := range messages {
		member, err := ynxbatch.Extract(batch, uint32(i))
		authOK(t, err)
		members[i], err = ynxbatch.EncodeMember(member)
		authOK(t, err)
	}
	return members
}

func TestContractActionRealDualProofAndHistoricalAuthority(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	messages := make([][]byte, 4)
	for i, v := range contractActionVectors() {
		a := contractVectorAction(t, v)
		a.ChainID, a.Owner, a.NativeChainID, a.Nonce = f.state.NetworkID, f.owner, 6425, uint64(42+i)
		var err error
		messages[i], err = a.SigningBytes()
		authOK(t, err)
	}
	members := contractSignedMembers(t, f.first, state.NetworkID, f.owner, messages)
	proposed := contractSignedMembers(t, f.next, state.NetworkID, f.owner, messages)
	for i, message := range messages {
		authOK(t, state.VerifyMember(f.owner, TransactionPurpose, message, members[i], 20))
		authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, members[i], 19))
		authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, proposed[i], 20))
		for _, branch := range []string{"A", "B"} {
			member, err := ynxbatch.DecodeMember(members[i])
			authOK(t, err)
			if branch == "A" {
				member.Certificate.SigmaA[0] ^= 1
			} else {
				member.Certificate.SigmaB[0] ^= 1
			}
			wire, err := ynxbatch.EncodeMember(member)
			authOK(t, err)
			authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, wire, 20))
		}
		// Every valid textual commitment and constructor/calldata position is
		// inside the actual signed leaf, not metadata attached after verification.
		a, err := DecodeAction(message)
		authOK(t, err)
		indices := []int{1, 2, 3, 6}
		if a.Kind == ActionContractExecute {
			indices = []int{1, 2, 3, 4, 5, 6}
		}
		for _, index := range indices {
			changed := authFields(t, a.Payload, 9)
			at := len(changed[index]) - 1
			if a.Kind == ActionContractDeploy && index == 6 {
				changed[index][at] ^= 1
			} else if changed[index][at] == '0' {
				changed[index][at] = '1'
			} else {
				changed[index][at] = '0'
			}
			other := a
			other.Payload = authFrame(t, changed)
			otherMessage, err := other.SigningBytes()
			authOK(t, err)
			member, err := ynxbatch.DecodeMember(members[i])
			authOK(t, err)
			member.Message = otherMessage
			wire, err := ynxbatch.EncodeMember(member)
			authOK(t, err)
			authReject(t, state.VerifyMember(f.owner, TransactionPurpose, otherMessage, wire, 20))
		}
	}
	_, wrongPurpose := authProof(t, f.first, state.NetworkID, f.owner, MigrationPurpose, [][]byte{messages[0]})
	authReject(t, state.VerifyMember(f.owner, TransactionPurpose, messages[0], wrongPurpose, 20))
	rotation := authSignMigration(t, authIntent(f, f.nextPublic, 1, 43, 30), nil, f.first, f.next)
	rotated, err := state.AdmitMigration(rotation, 20, 42)
	authOK(t, err)
	intent := revokeIntent(f, 2, 2, 44, 30)
	intent.PKA, intent.PKB = bytes.Clone(f.nextPublic.PKA), bytes.Clone(f.nextPublic.PKB)
	revoked, err := rotated.AdmitRevocation(signRevocation(t, intent, f.next), 30, 43)
	authOK(t, err)
	for i, message := range messages {
		authOK(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, members[i], 20))
		authReject(t, rotated.VerifyMember(f.owner, TransactionPurpose, message, members[i], 30))
		authOK(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, proposed[i], 30))
		authReject(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, proposed[i], 31))
	}
	authReject(t, revoked.RequireLegacy(f.owner, 31))
	// These assertions exercise account policy cryptography only. No chain
	// executor/fee/nonce/balance/storage transition is implied by a Member pass.
}

func FuzzContractActionCanonicalDecode(f *testing.F) {
	for _, v := range contractActionVectors() {
		wire, err := contractVectorAction(f, v).SigningBytes()
		authOK(f, err)
		f.Add(wire)
	}
	f.Fuzz(func(t *testing.T, wire []byte) {
		a, err := DecodeAction(wire)
		if err != nil {
			return
		}
		canonical, err := a.SigningBytes()
		authOK(t, err)
		if !bytes.Equal(canonical, wire) {
			t.Fatal("contract decoder accepted noncanonical wire")
		}
	})
}
