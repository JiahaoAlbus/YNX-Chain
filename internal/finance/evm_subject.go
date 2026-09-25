package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const financeEVMSubjectDomain = "YNX_FINANCE_EVM_ONLY_SUBJECT_V1"

// EVMSubjectRecord is a durable identity reservation, not an authorization.
// NativeAccount is intentionally null; a later explicit dual-sign link is a
// separate record and must never rewrite this EVM-only subject's history.
type EVMSubjectRecord struct {
	SubjectID     string    `json:"subjectId"`
	EVMAccount    string    `json:"evmAccount"`
	AccountType   string    `json:"accountType"`
	ChainID       int       `json:"chainId"`
	NativeAccount *string   `json:"nativeAccount"`
	CreatedAt     time.Time `json:"createdAt"`
}

func evmSubjectKey(account string) string { return "6423:" + account }

func validateEVMSubjectRecord(key string, record EVMSubjectRecord) error {
	derived, err := DeriveFinanceEVMSubjectID(record.EVMAccount)
	if err != nil || key != evmSubjectKey(record.EVMAccount) || record.SubjectID != derived || (record.AccountType != "eoa" && record.AccountType != "contract") || record.ChainID != 6423 || record.NativeAccount != nil || record.CreatedAt.IsZero() {
		return errors.New("Finance EVM-only subject identity is invalid")
	}
	return nil
}

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
