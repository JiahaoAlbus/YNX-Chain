//go:build unix

package consensus

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Alter public signatures only, retaining the real original block/header,
// registry, proposer, index and complete second signature branch.
type pqLabLiveCorruptCommit struct {
	proofHostBlocks
	height int64
	branch int
}

func (b pqLabLiveCorruptCommit) LoadBlockCommit(h int64) *cmttypes.Commit {
	c := b.proofHostBlocks.LoadBlockCommit(h)
	if c == nil {
		c = b.proofHostBlocks.LoadSeenCommit(h)
	}
	if c == nil || h != b.height {
		return c
	}
	c = c.Clone()
	e, err := ynxconsensusauth.ParseEnvelope(c.Signatures[0].Signature)
	if err != nil {
		panic("fixture expected real PQ commit")
	}
	if b.branch == 0 {
		e.MLDSA87[0] ^= 1
	} else {
		e.SLHDSASHA2256f[0] ^= 1
	}
	c.Signatures[0].Signature, err = e.MarshalBinary()
	if err != nil {
		panic(err)
	}
	return c
}

func TestPQLabLiveMaterialsIndependentAnchorAndEitherBranchRefusal(t *testing.T) {
	root := os.Getenv("YNX_PQ_LAB_LIVE_FIXTURE_ROOT")
	var setup PQLabLiveMaterialsSetup
	_, fixtureErr := os.Stat(filepath.Join(root, "live-command-input.json"))
	if root == "" || os.IsNotExist(fixtureErr) {
		// This test is order-independent. The command fixture producer may not
		// have run yet; build separate real synthetic stores, never its output.
		root = filepath.Join(pqLabWorkloadTemp(t), "lab")
		_, _, setup = pqLabLiveMaterialsFixture(t, root)
	} else {
		raw, err := os.ReadFile(filepath.Join(root, "live-command-input.json"))
		if err != nil || json.Unmarshal(raw, &setup) != nil {
			t.Fatal("explicit original fixture unavailable", err)
		}
	}
	in, err := loadPQLabLiveMaterialsPolicy(setup.Policy.Path, setup.Policy.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	defer in.close()
	source, err := openPQLabStoppedSource(in.plan.Nodes[0])
	if err != nil {
		t.Fatal(err)
	}
	defer source.close()
	_, _, b, err := loadPQLab(root, in.policy.PlanSHA256)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(in.schedule, in.activation.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	state, err := readPQEngineCommittedState(in.plan.Nodes[0].StatePath, in.migration, b, auth, nil)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := newPQEngineSnapshot(b, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
	if err != nil {
		t.Fatal(err)
	}
	target := in.activation.ActivationHeight + 1
	if trusted, e := in.advanceAnchor(source.ledger, snapshot, target, time.Now().UTC()); e != nil || trusted.Height != target-1 {
		t.Fatal("normal original R→PQ anchor transition", e)
	}
	// The independently captured TIP commit may legitimately contain 3/4
	// votes while the next block retains 4/4 for the exact same BlockID.
	alternate := *in
	alternate.anchor = in.anchor
	lb, err := DecodePQTrustedLightBlock(in.anchor.LightBlock)
	if err != nil {
		t.Fatal(err)
	}
	lb.Commit = lb.Commit.Clone()
	lb.Commit.Signatures[len(lb.Commit.Signatures)-1] = cmttypes.NewCommitSigAbsent()
	alternate.anchor.LightBlock, err = cmtjson.Marshal(lb)
	if err != nil {
		t.Fatal(err)
	}
	if err = alternate.validateAnchor(); err != nil {
		t.Fatal("valid original three-of-four anchor", err)
	}
	if _, err = alternate.advanceAnchor(source.ledger, snapshot, target, time.Now().UTC()); err != nil {
		t.Fatal("canonical R last commit rejected a valid independently pinned seen-commit subset", err)
	}
	for branch := 0; branch < 2; branch++ {
		bad := source.ledger
		bad.blocks = pqLabLiveCorruptCommit{proofHostBlocks: source.blocks, height: in.activation.ActivationHeight, branch: branch}
		if _, err = in.advanceAnchor(bad, snapshot, target, time.Now().UTC()); err == nil {
			t.Fatal("one invalid PQ branch promoted DATA to trusted predecessor", branch)
		}
	}
	bad := *in
	bad.anchor = in.anchor
	bad.anchor.AppHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if _, err = bad.advanceAnchor(source.ledger, snapshot, target, time.Now().UTC()); err == nil {
		t.Fatal("live history accepted another independent R AppHash")
	}
	if _, err = in.advanceAnchor(source.ledger, snapshot, target, time.Now().Add(2*time.Hour)); err == nil {
		t.Fatal("request rolled an expired original anchor forward")
	}
	bad = *in
	bad.anchor = in.anchor
	bad.anchor.Height++
	if err = bad.validateAnchor(); err == nil {
		t.Fatal("self-selected current checkpoint replaced original activation R")
	}
	wrong := setup.Policy.SHA256
	if wrong[0] == 'a' {
		wrong = "b" + wrong[1:]
	} else {
		wrong = "a" + wrong[1:]
	}
	if _, err = loadPQLabLiveMaterialsPolicy(setup.Policy.Path, wrong); err == nil {
		t.Fatal("original external policy pin ignored")
	}
}
