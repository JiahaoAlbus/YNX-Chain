module github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go

go 1.26.10

require (
	github.com/JiahaoAlbus/YNX-Chain v0.0.0
	github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go v0.0.0
	ynx.local/authgrantpolicy v0.0.0
)

require golang.org/x/sys v0.48.0 // indirect

replace github.com/JiahaoAlbus/YNX-Chain => ../../..

replace github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go => ../../open-protocol/go

replace ynx.local/authgrantpolicy => ../../auth-grant-policy/go
