//go:build pay_pq

package paynativesource

import (
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"github.com/cometbft/cometbft/node"
)

type OriginalPayEngine string

const (
	OriginalPayNativeEngine OriginalPayEngine = "native"
	OriginalPayBFTEngine    OriginalPayEngine = "bft"
)

var ErrPayEngineRequired = errors.New("PAY_ORIGINAL_ENGINE_REQUIRED")
var ErrPayEngineResources = errors.New("PAY_ORIGINAL_ENGINE_RESOURCE_MISMATCH")
var ErrNativeBFTProofUnsupported = errors.New("PAY_NATIVE_ENGINE_BFT_PROOF_NOT_SUPPORTED")
var ErrNativeInvoiceUnsupported = errors.New("PAY_NATIVE_ENGINE_INVOICE_TRANSPORT_NOT_SUPPORTED")

// Concrete mutually exclusive original hosts. The node owns its BlockStore;
// callers cannot pair an unrelated open DB or Devnet with a BFT Application.
// These resources prove neither Root permission nor correspondence to a
// requested native handler; normal host composition must bind its real engine.
type OriginalNativePayResources struct {
	Engine         OriginalPayEngine
	PayStore       *payproduct.Store
	CloudBills     *cloud.IDEUsageBillReader
	Native         *chain.Devnet
	BFTApplication *consensus.Application
	BFTNode        *node.Node
}
type originalPayEngineResources struct {
	engine      OriginalPayEngine
	native      *chain.Devnet
	application *consensus.Application
	node        *node.Node
	view        *node.ProofSourceView
}

// Implementation capabilities only, NOT a Source/Root approval or a statement
// that a given handler/runtime has been commissioned. Native lacks BFT proof.
type OriginalPayEngineFeaturesDATA struct {
	Engine              OriginalPayEngine
	AccountRegistration bool
	InvoiceAuthority    bool
	InvoiceSubmission   bool
	BFTTransactionProof bool
}

func OriginalPayEngineFeatures(engine OriginalPayEngine) (OriginalPayEngineFeaturesDATA, error) {
	switch engine {
	case OriginalPayNativeEngine:
		return OriginalPayEngineFeaturesDATA{Engine: engine, AccountRegistration: true}, nil
	case OriginalPayBFTEngine:
		return OriginalPayEngineFeaturesDATA{Engine: engine, AccountRegistration: true, InvoiceAuthority: true, InvoiceSubmission: true, BFTTransactionProof: true}, nil
	default:
		return OriginalPayEngineFeaturesDATA{}, ErrPayEngineRequired
	}
}

func selectOriginalPayEngine(r OriginalNativePayResources) (*originalPayEngineResources, error) {
	out := &originalPayEngineResources{engine: r.Engine}
	switch r.Engine {
	case OriginalPayNativeEngine:
		if r.Native == nil || r.BFTApplication != nil || r.BFTNode != nil {
			return out, ErrPayEngineResources
		}
		out.native = r.Native
	case OriginalPayBFTEngine:
		if r.Native != nil || r.BFTApplication == nil || r.BFTNode == nil {
			return out, ErrPayEngineResources
		}
		out.application = r.BFTApplication
		out.node = r.BFTNode
		v, e := r.BFTNode.ProofSourceView()
		out.view = v
		if e != nil {
			return out, e
		}
	default:
		return out, ErrPayEngineRequired
	}
	return out, nil
}
