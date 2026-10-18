package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"os"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestPQRemoteSourceRequiresFreshFileInsteadOfHistoricalCache(t *testing.T) {
	f, app, auth, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	source, err := NewPQEngineFileSource(f.migration, path, f.bootstrap, auth)
	if err != nil {
		t.Fatal(err)
	}
	chain := f.doc.ChainID
	oldHeight := app.committed.Height
	oldHash, err := hex.DecodeString(app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	prior, err := source.ConsensusAuthorityForSigning(chain, oldHeight, oldHash)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		chain  string
		height int64
		hash   []byte
	}{
		{"foreign", oldHeight, oldHash}, {chain, oldHeight + 1, oldHash}, {chain, oldHeight, nil}, {chain, oldHeight, bytes.Repeat([]byte{9}, 32)},
	} {
		if _, err = source.ConsensusAuthorityForSigning(tc.chain, tc.height, tc.hash); err == nil {
			t.Fatal("untrusted checkpoint authorized signing")
		}
	}
	unchanged, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, unchanged) {
		t.Fatal("read-only source modified state", err)
	}
	next, err := prior.(*PQEngineSnapshot).ExpectedValidatorHash(schedule.AuthorizedAt + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt, NextValidatorsHash: next}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	newHash, err := hex.DecodeString(app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.ConsensusAuthorityForSigning(chain, oldHeight, oldHash); err == nil {
		t.Fatal("cached old authority signed after file advanced")
	}
	if _, err = source.ConsensusAuthorityForSigning(chain, app.committed.Height, newHash); err != nil {
		t.Fatal(err)
	}
	if retained, err := source.ConsensusAuthorityForState(chain, oldHeight, oldHash); err != nil || retained != prior {
		t.Fatal("fresh signing destroyed valid historical engine cache", err)
	}
	// Advance to H3, then evict both historical cache slots using real H0/H2
	// files and the actual historical source API. A cache-only guard would now
	// accept H2, so this isolates the permanent signing high-water requirement.
	var middleFile, middleHash []byte
	var middleHeight int64
	for i := 0; i < 2; i++ {
		snapshot, e := app.CommittedPQEngineSnapshot()
		if e != nil {
			t.Fatal(e)
		}
		h := app.committed.Height + 1
		next, e := snapshot.ExpectedValidatorHash(h + 1)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, NextValidatorsHash: next}); e != nil {
			t.Fatal(e)
		}
		if _, e = app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
			t.Fatal(e)
		}
		if i == 0 {
			middleFile, e = os.ReadFile(path)
			if e != nil {
				t.Fatal(e)
			}
			middleHash, e = hex.DecodeString(app.committed.AppHash)
			if e != nil {
				t.Fatal(e)
			}
			middleHeight = app.committed.Height
		}
	}
	high := app.committed.Height
	highHash, e := hex.DecodeString(app.committed.AppHash)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = source.ConsensusAuthorityForSigning(chain, high, highHash); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(path, before, 0600); e != nil {
		t.Fatal(e)
	} // isolated fixture only
	if _, e = source.ConsensusAuthorityForState(chain, oldHeight, oldHash); e != nil {
		t.Fatal("historical H0 was not exercised", e)
	}
	if e = os.WriteFile(path, middleFile, 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = source.ConsensusAuthorityForState(chain, middleHeight, middleHash); e != nil {
		t.Fatal("historical H2 was not exercised", e)
	}
	for _, checkpoint := range source.checkpoints {
		if checkpoint.height >= high {
			t.Fatal("fixture did not evict high-water entry from both cache slots")
		}
	}
	if _, e = source.ConsensusAuthorityForSigning(chain, middleHeight, middleHash); e == nil {
		t.Fatal("history-cache eviction reopened old signing authority")
	}
}
