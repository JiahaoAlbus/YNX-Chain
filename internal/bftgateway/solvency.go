package bftgateway

import (
	"math"
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handleSolvencySnapshot(w http.ResponseWriter, r *http.Request) {
	var snapshot consensus.BFTSolvencySnapshot
	if err := g.queryABCIJSON(r.Context(), "/solvency/snapshot", &snapshot); err != nil {
		writeJSON(w, http.StatusBadGateway, solvencyFailure(err.Error()))
		return
	}
	if !validSolvencySnapshot(snapshot) {
		writeJSON(w, http.StatusBadGateway, solvencyFailure("solvency snapshot violated fail-closed reconciliation or external-coverage boundaries"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": 1, "source": snapshot.Source, "asOf": map[string]any{"blockHeight": snapshot.AsOfBlockHeight, "stateHash": snapshot.StateHash}, "version": snapshot.PolicyVersion, "coverage": snapshot.CustodyCoverage, "failure": false, "solvency": snapshot})
}

func (g *Gateway) handleSolvencyLiabilityProof(w http.ResponseWriter, r *http.Request) {
	address := strings.TrimSpace(r.PathValue("address"))
	if !consensus.IsNativeAddress(address) {
		writeJSON(w, http.StatusBadRequest, solvencyFailure("canonical YNX liability address is required"))
		return
	}
	var proof consensus.BFTSolvencyLiabilityProof
	if err := g.queryABCIJSON(r.Context(), "/solvency/liabilities/"+address, &proof); err != nil {
		writeJSON(w, http.StatusNotFound, solvencyFailure("solvency liability proof not found"))
		return
	}
	var snapshot consensus.BFTSolvencySnapshot
	if err := g.queryABCIJSON(r.Context(), "/solvency/snapshot", &snapshot); err != nil {
		writeJSON(w, http.StatusBadGateway, solvencyFailure("matching solvency snapshot unavailable"))
		return
	}
	if proof.Source != "ynx-consensus-abci" || proof.Leaf.Address != address || !validSolvencyLeaf(proof.Leaf) || !proof.Verified || !consensus.VerifySolvencyLiabilityProof(proof) || !validSolvencySnapshot(snapshot) || proof.AsOfBlockHeight != snapshot.AsOfBlockHeight || proof.StateHash != snapshot.StateHash || proof.LiabilityMerkleRoot != snapshot.LiabilityMerkleRoot {
		writeJSON(w, http.StatusBadGateway, solvencyFailure("solvency liability proof evidence mismatch"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": 1, "source": proof.Source, "asOf": map[string]any{"blockHeight": proof.AsOfBlockHeight, "stateHash": proof.StateHash}, "version": consensus.SolvencyPolicyVersion, "coverage": "exact-native-consensus-liability-leaf", "failure": false, "proof": proof})
}

func validSolvencySnapshot(snapshot consensus.BFTSolvencySnapshot) bool {
	liabilities := snapshot.Liabilities
	return snapshot.Source == "ynx-consensus-abci" && !snapshot.Failure && snapshot.Reconciled && snapshot.NativeAsset == "YNXT" && snapshot.OnChainReconciliationBPS == 10_000 && snapshot.ConsensusIssuedAssetsYNXT >= 0 && liabilities.LiquidYNXT >= 0 && liabilities.TotalYNXT == snapshot.ConsensusIssuedAssetsYNXT && liabilities.TotalYNXT >= liabilities.LiquidYNXT && snapshot.EncumberedYNXT == liabilities.TotalYNXT-liabilities.LiquidYNXT && snapshot.WithdrawalCapacity.OnChainTransferableYNXT == liabilities.LiquidYNXT && snapshot.LiabilityLeafCount >= 0 && blockHashPattern.MatchString(snapshot.StateHash) && blockHashPattern.MatchString(snapshot.LiabilityMerkleRoot) && !snapshot.ExternalReserveRatio.Available && snapshot.ExternalReserveRatio.ValueBPS == nil && !snapshot.WithdrawalCapacity.ExternalRedemptionAvailable
}

func validSolvencyLeaf(leaf consensus.SolvencyLiabilityLeaf) bool {
	values := []int64{leaf.LiquidYNXT, leaf.StakedYNXT, leaf.PendingUnbondingYNXT, leaf.StrategyVaultYNXT, leaf.PaymasterBudgetYNXT}
	var total int64
	for _, value := range values {
		if value < 0 || total > math.MaxInt64-value {
			return false
		}
		total += value
	}
	return leaf.TotalYNXT > 0 && leaf.TotalYNXT == total
}

func solvencyFailure(message string) map[string]any {
	return map[string]any{"error": message, "source": "ynx-consensus-abci", "version": consensus.SolvencyPolicyVersion, "coverage": "none", "failure": true}
}
