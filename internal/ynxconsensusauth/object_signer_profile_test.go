//go:build unix

package ynxconsensusauth

import (
	"bytes"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmttypes "github.com/cometbft/cometbft/types"
	"testing"
)

func TestObjectSigningStateProfileDetachedPUBLIC(t *testing.T) {
	genesis := bytes.Repeat([]byte{1}, 32)
	address := bytes.Repeat([]byte{2}, 20)
	chain := "test-chain"
	wire, err := (ynxpq.ConsensusProfile{GenesisID: genesis, ChainID: chain, ParamsUpdateHeight: 10, ActivationHeight: 13, ScheduleHash: bytes.Repeat([]byte{3}, 32), RegistryRoot: bytes.Repeat([]byte{4}, 32)}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	params := *cmttypes.DefaultConsensusParams()
	params.Validator.PubKeyTypes = []string{ed25519.KeyType, ynxpq.KeyType}
	params.YNXProfile = bytes.Clone(wire)
	source := &objectStateFixture{state: ObjectSigningState{GenesisID: bytes.Clone(genesis), ChainID: chain, Height: 20, Round: 0, ValidatorAddress: bytes.Clone(address), ValidatorIndex: 0, ProposerAddress: bytes.Clone(address), Params: params}}
	core := &objectSignerCore{source: source, chainID: chain, genesisID: bytes.Clone(genesis), address: bytes.Clone(address)}
	got, err := core.stateAt(chain, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	source.state.Params.YNXProfile[0] ^= 1
	if !bytes.Equal(got.Params.YNXProfile, wire) {
		t.Fatal("source mutation rewrote trusted captured consensus profile")
	}
	got.Params.YNXProfile[1] ^= 1
	if source.state.Params.YNXProfile[1] != wire[1] {
		t.Fatal("returned snapshot mutation reached source profile")
	}
}
