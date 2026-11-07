package ynxbatch

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"strconv"
)

const AITaskV6FixedPurpose = "PRODUCT-SESSION-AI-TASK-ACTION"
const AITaskV6FixedDomain = "YNX-PRODUCT-SESSION-AI-TASK-ACTION/v6"
const AITaskV6MemberCapacity = 98304

// This is fixed signing MATH only, not full request-body/Source/current/once
// verification. Native invokes sole SDK canonical35 parser before this call;
// actual prepared producer already validated same original body and journal.
type AITaskV6FixedSignInput struct {
	UnsignedOriginal, MessageOriginal, NetworkHex, KeyEpoch []byte
	Material                                                KeyMaterial
}
type AITaskV6FixedSignOutcome struct {
	Member  []byte
	Cleanup uint32
	Code    int32
}

func aiV6FixedBinding(in AITaskV6FixedSignInput) ([]byte, string, error) {
	if len(in.UnsignedOriginal) == 0 || len(in.UnsignedOriginal) > 16384 || len(in.MessageOriginal) > 16384 || len(in.NetworkHex) != 64 || len(in.KeyEpoch) == 0 || len(in.KeyEpoch) > 20 || !productPairPendingCanonicalJSON(in.UnsignedOriginal) {
		return nil, "", invalid("AI V6 fixed input")
	}
	network, err := hex.DecodeString(string(in.NetworkHex))
	if err != nil || hex.EncodeToString(network) != string(in.NetworkHex) {
		return nil, "", invalid("AI V6 network")
	}
	epoch, err := strconv.ParseUint(string(in.KeyEpoch), 10, 64)
	if err != nil || epoch == 0 || strconv.FormatUint(epoch, 10) != string(in.KeyEpoch) {
		return nil, "", invalid("AI V6 agent epoch")
	}
	fields, err := DecodeFields(in.MessageOriginal, 5, 16384)
	if err != nil || string(fields[0]) != AITaskV6FixedDomain || !bytes.Equal(fields[1], []byte{0, 0, 0, 6}) || !bytes.Equal(fields[2], network) || !bytes.Equal(fields[4], in.UnsignedOriginal) {
		return nil, "", invalid("AI V6 exact E5")
	}
	var body map[string]json.RawMessage
	if json.Unmarshal(in.UnsignedOriginal, &body) != nil || len(body) != 35 {
		return nil, "", invalid("AI V6 canonical35")
	}
	names := []string{"version", "sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "canonicalOwner", "deviceId", "deviceRegistrationId", "deviceRegistrationRevision", "deviceRegistrationDigest", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt", "audience", "action", "holder", "operationId", "policyRevision", "taskId", "taskRevision", "generation", "stepId", "runId", "contentType", "bodyBytes", "creationBinding", "platform"}
	// Purpose is fixed certificate metadata, never caller-selected.
	for _, n := range names {
		if _, ok := body[n]; !ok {
			return nil, "", invalid("AI V6 exact fields")
		}
	}
	var version, owner string
	if json.Unmarshal(body["version"], &version) != nil || version != "6" || json.Unmarshal(body["canonicalOwner"], &owner) != nil || len(owner) != 42 || owner[:2] != "0x" || !productDeviceV4Hex(owner[2:], 20) || string(fields[3]) != owner {
		return nil, "", invalid("AI V6 owner")
	}
	return network, owner, nil
}
func InspectOriginalAITaskActionV6FixedMemberDATA(member []byte, in AITaskV6FixedSignInput) error {
	network, owner, err := aiV6FixedBinding(in)
	if err != nil {
		return err
	}
	m, err := DecodeMember(member)
	if err != nil {
		return err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != AITaskV6FixedPurpose || c.Owner != owner || !bytes.Equal(c.ChainID, network) || !bytes.Equal(c.PKA, in.Material.PKA) || !bytes.Equal(c.PKB, in.Material.PKB) || !bytes.Equal(m.Message, in.MessageOriginal) {
		return invalid("AI V6 fixed N1")
	}
	v, err := NewVerifier(VerifierOptions{ChainID: network, Purpose: AITaskV6FixedPurpose, CacheEntries: 0, ResolveTrustedOwner: func(r TrustRequest) (Registration, error) {
		return Registration{Enabled: true, AlgorithmVersion: Version, Owner: owner, Purpose: AITaskV6FixedPurpose, ChainID: network, PKA: in.Material.PKA, PKB: in.Material.PKB, PolicyRevision: "AI-V6-FIXED-MATH-ONLY", ActiveFrom: 0}, nil
	}})
	if err != nil {
		return err
	}
	defer v.Clear()
	return v.VerifyOne(member, 0)
}
func SignOriginalAITaskActionV6FixedMath(in AITaskV6FixedSignInput) (out AITaskV6FixedSignOutcome) {
	out.Code = 1
	out.Cleanup = 2
	network, owner, err := aiV6FixedBinding(in)
	if err != nil {
		return
	}
	if len(in.Material.PKCS8A) != PKCS8ASize || len(in.Material.PKCS8B) != PKCS8BSize || len(in.Material.PKA) != PublicKeyASize || len(in.Material.PKB) != PublicKeyBSize {
		return
	}
	var owned KeyMaterial
	var key *PrivateKey
	var batch *Batch
	defer func() {
		if recover() != nil {
			out.Code = 7
			out.Cleanup = 0
		}
		clean := func(f func()) {
			defer func() {
				if recover() != nil {
					out.Code = 7
					out.Cleanup = 0
				}
			}()
			f()
		}
		if batch != nil {
			clean(batch.Discard)
		}
		if key != nil {
			clean(key.Destroy)
		}
		clean(owned.Clear)
	}()
	owned.PKCS8A = bytes.Clone(in.Material.PKCS8A)
 owned.PKCS8B = bytes.Clone(in.Material.PKCS8B)
 owned.PKA = bytes.Clone(in.Material.PKA)
 owned.PKB = bytes.Clone(in.Material.PKB)
	key, _, err = ImportKeyMaterial(owned)
	if err != nil {
		out.Code = 2
		return
	}
	batch, err = BatchSign(key, Metadata{ChainID: network, Owner: owner, Purpose: AITaskV6FixedPurpose}, [][]byte{in.MessageOriginal}, SignOptions{Optimized: true})
	if err != nil {
		out.Code = 3
		return
	}
	member, err := Extract(batch, 0)
	if err != nil {
		out.Code = 4
		return
	}
	out.Member, err = EncodeMember(member)
	if err != nil || len(out.Member) > AITaskV6MemberCapacity {
		clear(out.Member)
		out.Member = nil
		out.Code = 4
		return
	}
	if InspectOriginalAITaskActionV6FixedMemberDATA(out.Member, in) != nil {
		out.Code = 5
		return
	}
	out.Code = 0
	return
}
