package appgateway

import "github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"

func normalizeAccountAddress(account string) (string, error) {
	return accountaddress.Normalize(account)
}
