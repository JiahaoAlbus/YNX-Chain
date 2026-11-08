//go:build link_registered_receiver_interop && (darwin || linux)

package grantruntime

// Test-only adaptation of the supplier's place/signPUBLIC seam. Never supplied
// to normal builds; no admittedOriginalGrantReleases entry is installed. The
// selected projection and ephemeral signers are PUBLIC, not genuine Root/Source.
import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	core "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

func PUBLICOriginalReceiverGrantForP08Test(dir string, s policy.Snapshot, op string) (*Runtime, open.BoundGrantV1, policy.Proof, policy.Proof, string, error) {
	var g open.BoundGrantV1
	var gp, hp policy.Proof
	ref := func(v policy.Ref) open.LegacyGrantRefV1 {
		return open.LegacyGrantRefV1{Realm: v.Realm, Tenant: v.Tenant, Kind: v.Kind, ID: v.ID, Rev: v.Revision}
	}
	bind := func(v policy.Bind) open.GrantBindV1 {
		return open.GrantBindV1{Bytes: v.Bytes, SHA3_512: v.SHA3_512, SHA512: v.SHA512}
	}
	b := s.Grant.Binding
	g = open.BoundGrantV1{Version: open.BoundGrantDataVersion, ID: b.GrantID, Rev: b.GrantRevision, Realm: b.Realm, Tenant: b.Tenant, Issuer: ref(s.Issuer.Ref), IssuerEpoch: s.Issuer.Epoch, Holder: ref(b.Holder), HolderEpoch: b.HolderEpoch, Audience: b.Audience, Operation: b.Tool.Operation, Cap: s.Grant.Cap, SingleMax: s.Grant.SingleMax, ValidFrom: s.Grant.ValidFrom, Expires: s.Grant.Expires, Nonce: "11111111111111111111111111111111", NonDelegable: true, ApprovalID: "PUBLIC-receiver-fixture-approval"}
	g.Binding = open.GrantStepBindingV1{Task: ref(b.Task), Generation: b.Generation, StepID: b.StepID, Input: bind(b.Input), Tool: open.GrantToolV1{ID: b.Tool.ID, Version: b.Tool.Version, Schema: bind(b.Tool.Schema)}, Purpose: b.Tool.Purpose, Risk: b.Tool.Risk, HolderSession: open.GrantSessionV1{ID: b.SessionID, Epoch: b.SessionEpoch, Channel: b.ChannelBinding}, Target: open.GrantTargetV1{Service: b.Target.Service, Tenant: b.Target.Tenant, Origin: b.Target.Origin, Path: b.Target.Path, Region: b.Target.Region, Operation: b.Target.Operation}}
	for _, v := range b.Resources {
		g.Resources = append(g.Resources, ref(v))
	}
	for _, v := range b.Sources {
		g.Binding.Sources = append(g.Binding.Sources, open.GrantSourceV1{Ref: ref(v.Resource), Fields: append([]string(nil), v.Fields...), Label: v.Label, Binding: bind(v.Binding)})
	}
	s.Effect = policy.EffectState{State: "NEW", Slot: b.Slot()}
	p := authorityProjection{Version: "AUTH-ORIGINAL-GRANT-PROJECTION/private-v1", ChainID: bytes.Repeat([]byte{0xaa}, 32), Height: 1, Snapshot: s, AuthorizationRef: "PUBLIC_QUERY_REF"}
	ik, ip, e := core.KeyGen()
	if e != nil {
		return nil, g, gp, hp, "", e
	}
	defer ik.Destroy()
	hk, hpub, e := core.KeyGen()
	if e != nil {
		return nil, g, gp, hp, "", e
	}
	defer hk.Destroy()
	p.Issuer = principalRegistration{Principal: s.Issuer.Ref, Epoch: s.Issuer.Epoch, Role: "human", PKA: ip.PKA, PKB: ip.PKB}
	p.Holder = principalRegistration{Principal: b.Holder, Epoch: b.HolderEpoch, Role: "agent", PKA: hpub.PKA, PKB: hpub.PKB}
	sign := func(k *core.PrivateKey, owner, purpose string, raw []byte) (policy.Proof, error) {
		batch, e := core.BatchSign(k, core.Metadata{ChainID: p.ChainID, Owner: owner, Purpose: purpose}, [][]byte{raw}, core.SignOptions{})
		if e != nil {
			return policy.Proof{}, e
		}
		m, e := core.Extract(batch, 0)
		if e != nil {
			return policy.Proof{}, e
		}
		w, e := core.EncodeMember(m)
		return policy.Proof{Payload: raw, Wire: w, Purpose: purpose}, e
	}
	raw, e := open.EncodeBoundGrant(g)
	if e != nil {
		return nil, g, gp, hp, "", fmt.Errorf("PUBLIC original grant: %w", e)
	}
	gp, e = sign(ik, g.Issuer.ID, open.BoundGrantDomain, raw)
	if e != nil {
		return nil, g, gp, hp, "", e
	}
	raw, e = open.EncodeGrantEffect(g, g.Binding)
	if e != nil {
		return nil, g, gp, hp, "", e
	}
	hp, e = sign(hk, g.Holder.ID, open.GrantEffectDomain, raw)
	if e != nil {
		return nil, g, gp, hp, "", e
	}
	p.GrantProof, p.HolderProof = gp, hp
	raw, e = json.Marshal(p)
	if e != nil {
		return nil, g, gp, hp, "", e
	}
	file := filepath.Join(dir, "PUBLIC-projection.json")
	if e = os.WriteFile(file, raw, 0600); e != nil {
		return nil, g, gp, hp, "", e
	}
	hash := sha256.Sum256(raw)
	r, e := openProtectedRuntime(releaseSelection{Projection: protectedRef{Path: file, SHA256: hex.EncodeToString(hash[:]), Bytes: int64(len(raw))}, Authority: s.Version.Authority, Realm: b.Realm, Tenant: b.Tenant})
	return r, g, gp, hp, file, e
}
