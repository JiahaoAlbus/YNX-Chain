package chain

import (
	"errors"
	"regexp"
	"strconv"
)

const FaucetRequestVersion = "ynx-faucet-request-v1"

var ErrFaucetRequestConflict = errors.New("faucet request ID conflicts with an existing request")
var faucetRequestIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{32,128}$`)

// FaucetRequestHash gives a persisted client intent a stable lookup hash even
// when its HTTP acknowledgement is lost. IDs must be generated with at least
// 128 random bits before the first request and retained for identical retries.
// The accepted transaction binds its recipient and amount; changing either
// under the same ID is a conflict. The history already persists this binding.
func FaucetRequestHash(chainID int64, requestID string) (string, error) {
	if !faucetRequestIDPattern.MatchString(requestID) {
		return "", errors.New("faucet request ID must contain 32 to 128 ASCII letters, digits, underscores or hyphens")
	}
	return "0x" + hashParts(FaucetRequestVersion, strconv.FormatInt(chainID, 10), requestID), nil
}

func (d *Devnet) FaucetWithRequest(address string, amount int64, requestID string) (Transaction, bool, error) {
	hash, err := FaucetRequestHash(d.cfg.ChainID, requestID)
	if err != nil {
		return Transaction{}, false, err
	}
	return d.faucet(address, amount, hash)
}
