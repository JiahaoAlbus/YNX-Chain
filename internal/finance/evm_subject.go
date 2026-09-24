package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const financeEVMSubjectDomain = "YNX_FINANCE_EVM_ONLY_SUBJECT_V1"

// DeriveFinanceEVMSubjectID reserves a separate Finance subject namespace for
// a canonical EVM account. It is an identifier only: calling it never proves
// wallet control, links a native account, or grants a private Finance scope.
func DeriveFinanceEVMSubjectID(account string) (string, error) {
	if !accountaddress.IsCanonical(account) {
		return "", errors.New("Finance EVM-only subject account is not canonical")
	}
	digest := sha256.Sum256([]byte(financeEVMSubjectDomain + "\n" + FinanceOrderApplicationID + "\n" + account))
	return "evm_subject_" + hex.EncodeToString(digest[:]), nil
}
