//go:build pay_pq && pay_cloud && pay_auth_source

package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct/nativehost"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"time"
)

type operatorPayProducts = nativehost.BFTPrivateProducts

func openOperatorPayProducts(ctx context.Context, app *consensus.Application, n *node.Node, path string, logger log.Logger) *operatorPayProducts {
	if path == "" {
		return nil
	}
	input, cfg, err := nativehost.ReadOperatorConfig(path)
	if err != nil {
		logger.Error("pay_product_unavailable", "reason", "PAY_OPERATOR_CONFIG_INVALID")
		return nil
	}
	if n == nil || app == nil {
		logger.Error("pay_product_unavailable", "reason", "PAY_ORIGINAL_NODE_APP_NOT_SUPPLIED")
		return nil
	}
	view, err := n.ProofSourceView()
	if err != nil {
		logger.Error("pay_product_unavailable", "reason", "PAY_ORIGINAL_CHECKPOINT_UNAVAILABLE")
		return nil
	}
	state, err := view.LoadState()
	if err != nil {
		logger.Error("pay_product_unavailable", "reason", "PAY_ORIGINAL_CHECKPOINT_UNAVAILABLE")
		return nil
	}
	if state.ChainID != input.ExpectedChainID {
		logger.Error("pay_product_unavailable", "reason", "PAY_OPERATOR_NETWORK_MISMATCH")
		return nil
	}
	h, err := nativehost.OpenBFTPrivateProducts(ctx, app, n, cfg, buildinfo.Info{}, nil)
	if err != nil {
		logger.Error("pay_product_unavailable", "reason", "PAY_ORIGINAL_COMPOSITION_FAILED")
		closeOperatorPayProducts(h, logger)
		return nil
	}
	if sourceErr := h.NativeSourceStatus(); sourceErr != nil {
		reason := "PAY_AUTH_SOURCE_NOT_READY"
		switch sourceErr.Error() {
		case "PAY_ORIGINAL_BUSINESS_SOURCE_COMMISSIONING_NOT_SUPPLIED", "PAY_ORIGINAL_TYPED_PARENT_RESOURCES_NOT_SUPPLIED", "PAY_HOST_ORIGINAL_ENGINE_RESOURCES_NOT_SUPPLIED":
			reason = sourceErr.Error()
		}
		logger.Info("pay_product_source_unavailable", "reason", reason)
	} else {
		logger.Info("pay_product_source_ready")
	}
	return h
}

func closeOperatorPayProducts(h *operatorPayProducts, logger log.Logger) {
	if h == nil {
		return
	}
	h.Retire()
	for !h.CoreReleased() {
		_ = h.Shutdown(context.Background())
		if !h.CoreReleased() {
			logger.Error("pay_product_cleanup_pending")
			time.Sleep(time.Second)
		}
	}
	if h.Err() != nil {
		logger.Error("pay_product_first_failure_retained")
	}
}
