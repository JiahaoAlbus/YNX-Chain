package bftgateway

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestNativeTransferMetadataGatewayUsesCommittedBootstrapAndColdRead(t *testing.T) {
	f := newPQIdentityFixture(t)
	_, server := identityGateway(t, f)
	read := func() chain.NativeTransferMetadata {
		t.Helper()
		code, raw := identityRead(t, server.URL, "/node/native-transfer-metadata")
		var got struct {
			Metadata            chain.NativeTransferMetadata
			Source              string
			Identity            consensus.PQWalletIdentityView
			IndependentFinality bool
		}
		if code != http.StatusOK || json.Unmarshal(raw, &got) != nil || got.IndependentFinality || got.Source != "configured-abci-bootstrap" {
			t.Fatal("metadata query invented trust", code, string(raw))
		}
		if err := chain.ValidateNativeTransferMetadata(got.Metadata, f.migration.Network.ChainID, f.migration.OriginalGenesisHash); err != nil {
			t.Fatal(err)
		}
		if got.Identity.NativeGenesisHash != got.Metadata.Genesis || got.Identity.NativeChainID != got.Metadata.NativeChainID || got.Identity.CometGenesisSHA256 == got.Metadata.Genesis {
			t.Fatal("native and Comet genesis identities confused")
		}
		return got.Metadata
	}
	v := read()
	reopened, err := consensus.NewPersistentApplicationWithBootstrap(f.migration, f.statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	f.app = reopened
	if got := read(); got != v {
		t.Fatal("cold metadata changed", got, v)
	}
	if f.commitReads != 0 {
		t.Fatal("immutable metadata performed unrelated finality reads")
	}
	code, _ := identityRead(t, server.URL, "/node/native-transfer-metadata?unitVersion=2")
	if code != http.StatusBadRequest {
		t.Fatal("caller-selected metadata accepted", code)
	}
	f.mode = "no-bootstrap"
	code, _ = identityRead(t, server.URL, "/node/native-transfer-metadata")
	if code != http.StatusBadGateway {
		t.Fatal("missing bootstrap metadata succeeded", code)
	}
}
