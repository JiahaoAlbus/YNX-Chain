//go:build !pay_pq || !pay_cloud || !pay_auth_source

package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
)

type operatorPayProducts struct{}

func openOperatorPayProducts(_ context.Context, _ *consensus.Application, _ *node.Node, path string, logger log.Logger) *operatorPayProducts {
	if path != "" {
		logger.Error("pay_product_unavailable", "reason", "PAY_SOURCE_NOT_LINKED")
	}
	return nil
}
func closeOperatorPayProducts(_ *operatorPayProducts, _ log.Logger) {}
