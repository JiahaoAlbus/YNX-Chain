module github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go

go 1.26.10

require (
	github.com/JiahaoAlbus/YNX-Chain v0.0.0
	github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go v0.0.0
	github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go v0.0.0
	ynx.local/authgrantpolicy v0.0.0
)

require (
	github.com/cloudflare/circl v1.6.5 // indirect
	golang.org/x/crypto v0.57.0 // indirect
	golang.org/x/net v0.60.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	golang.org/x/text v0.42.0 // indirect
)

replace github.com/JiahaoAlbus/YNX-Chain => ../../..

replace github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go => ../../open-protocol/go

replace ynx.local/authgrantpolicy => ../../auth-grant-policy/go

replace github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go => ../../auth-grant-runtime/go
