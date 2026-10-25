package types

import (
	"bytes"
	"testing"

	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/tmhash"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
)

func profileUpdate(t *testing.T) *cmtproto.ConsensusParams {
	t.Helper()
	wire, err := (ynxpq.ConsensusProfile{GenesisID: bytes.Repeat([]byte{1}, 32), ChainID: "ynx-profile-qa", ParamsUpdateHeight: 10, ActivationHeight: 13, ScheduleHash: bytes.Repeat([]byte{2}, 32), RegistryRoot: bytes.Repeat([]byte{3}, 32)}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	return &cmtproto.ConsensusParams{YnxProfile: wire, Validator: &cmtproto.ValidatorParams{PubKeyTypes: []string{ed25519.KeyType, ynxpq.KeyType}}}
}

func TestYNXProfilePreservesOldHashAndCommitsCompleteNewParams(t *testing.T) {
	old := *DefaultConsensusParams()
	hp := cmtproto.HashedParams{BlockMaxBytes: old.Block.MaxBytes, BlockMaxGas: old.Block.MaxGas}
	oldWire, err := hp.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(old.Hash(), tmhash.Sum(oldWire)) {
		t.Fatal("pre-profile ConsensusHash changed")
	}
	update := profileUpdate(t)
	if err := old.ValidateUpdate(update, 10); err != nil {
		t.Fatal(err)
	}
	active := old.Update(update)
	if err := active.ValidateBasic(); err != nil {
		t.Fatal(err)
	}
	if len(old.YNXProfile) != 0 || bytes.Equal(active.Hash(), old.Hash()) {
		t.Fatal("new profile not committed independently")
	}
	for _, mutate := range []func(*ConsensusParams){
		func(p *ConsensusParams) { p.YNXProfile[len(p.YNXProfile)-1] ^= 1 },
		func(p *ConsensusParams) { p.YNXProfile[len(p.YNXProfile)-40] ^= 1 },
		func(p *ConsensusParams) { p.Validator.PubKeyTypes = []string{ed25519.KeyType} },
		func(p *ConsensusParams) { p.ABCI.VoteExtensionsEnableHeight = 20 },
		func(p *ConsensusParams) { p.Evidence.MaxBytes-- },
		func(p *ConsensusParams) { p.Version.App++ },
	} {
		changed := active.Update(nil)
		mutate(&changed)
		if bytes.Equal(changed.Hash(), active.Hash()) {
			t.Fatal("security-relevant actual params omitted from ConsensusHash")
		}
	}
	pb := active.ToProto()
	restored := ConsensusParamsFromProto(pb)
	if !bytes.Equal(restored.Hash(), active.Hash()) {
		t.Fatal("profile lost on state proto restoration")
	}
	pb.YnxProfile[0] ^= 1
	if !bytes.Equal(restored.Hash(), active.Hash()) {
		t.Fatal("restored params alias transport")
	}
	update.YnxProfile[0] ^= 1
	if err := active.ValidateBasic(); err != nil {
		t.Fatal("caller mutated admitted params:", err)
	}
}

func TestYNXProfileActualUpdateHeightImmutabilityAndAllowlist(t *testing.T) {
	old := *DefaultConsensusParams()
	update := profileUpdate(t)
	for _, h := range []int64{9, 11} {
		if old.ValidateUpdate(update, h) == nil {
			t.Fatal("profile accepted outside actual declared Finalize height")
		}
	}
	active := old.Update(update)
	changed := profileUpdate(t)
	changed.YnxProfile[len(changed.YnxProfile)-1] ^= 1
	if active.ValidateUpdate(changed, 11) == nil {
		t.Fatal("committed initial registry root rewritten")
	}
	if err := active.ValidateUpdate(update, 11); err != nil {
		t.Fatal("identical profile restatement rejected:", err)
	}
	retained := active.Update(&cmtproto.ConsensusParams{YnxProfile: []byte{}})
	if !bytes.Equal(retained.YNXProfile, active.YNXProfile) {
		t.Fatal("omission/empty update cleared committed profile")
	}
	missing := old.Update(&cmtproto.ConsensusParams{Validator: update.Validator})
	if missing.ValidateBasic() == nil {
		t.Fatal("PQ allowlist admitted without actual profile")
	}
	for _, keys := range [][]string{{ed25519.KeyType}, {ynxpq.KeyType, ed25519.KeyType}, {ed25519.KeyType, ynxpq.KeyType, ynxpq.KeyType}} {
		bad := active
		bad.Validator.PubKeyTypes = keys
		if bad.ValidateBasic() == nil {
			t.Fatal("profile allowlist drift accepted")
		}
	}
}
