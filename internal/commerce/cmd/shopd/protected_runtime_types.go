package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	"net/http"
)

type originalShopFiles struct{ keyID, keyFile, sealFile string }

func (f originalShopFiles) empty() bool { return f.keyID == "" && f.keyFile == "" && f.sealFile == "" }

type originalShopRuntime interface {
	servers(context.Context, *commerce.Store, commerce.ServerConfig) (http.Handler, http.Handler, http.Handler, *commerce.Server, *commerce.Server, error)
}
type closedOriginalShopRuntime struct{}

func (closedOriginalShopRuntime) servers(context.Context, *commerce.Store, commerce.ServerConfig) (http.Handler, http.Handler, http.Handler, *commerce.Server, *commerce.Server, error) {
	return nil, nil, nil, nil, nil, nil
}
