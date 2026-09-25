package finance

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func TestEVMOnlySubjectNeverAliasesNativeSubject(t *testing.T) {
	evmAccount := "0x" + strings.Repeat("a", 40)
	nativeAlias, err := accountaddress.Encode(evmAccount)
	if err != nil {
		t.Fatal(err)
	}
	evmSubject, err := DeriveFinanceEVMSubjectID(evmAccount)
	if err != nil {
		t.Fatal(err)
	}
	nativeSubject, err := DeriveFinanceSubjectID(nativeAlias)
	if err != nil {
		t.Fatal(err)
	}
	if evmSubject == nativeSubject || !strings.HasPrefix(evmSubject, "evm_subject_") || !strings.HasPrefix(nativeSubject, "subject_") {
		t.Fatalf("EVM and native subjects were not domain-separated: %q / %q", evmSubject, nativeSubject)
	}
	again, err := DeriveFinanceEVMSubjectID(evmAccount)
	if err != nil || again != evmSubject {
		t.Fatal("EVM-only subject derivation changed for one canonical account")
	}
	other, err := DeriveFinanceEVMSubjectID("0x" + strings.Repeat("b", 40))
	if err != nil || other == evmSubject {
		t.Fatal("different EVM accounts shared a Finance subject")
	}
	for _, invalid := range []string{nativeAlias, strings.ToUpper(evmAccount), "0x" + strings.Repeat("a", 39)} {
		if _, err := DeriveFinanceEVMSubjectID(invalid); err == nil {
			t.Fatalf("noncanonical EVM subject account %q was accepted", invalid)
		}
	}
}

func TestEVMOnlySubjectStateIsDurableAndFailsClosed(t *testing.T) {
	account := "0x" + strings.Repeat("a", 40)
	id, err := DeriveFinanceEVMSubjectID(account)
	if err != nil {
		t.Fatal(err)
	}
	record := EVMSubjectRecord{SubjectID: id, EVMAccount: account, AccountType: "eoa", ChainID: 6423, CreatedAt: time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)}
	key := evmSubjectKey(account)
	state := persistedState{Version: currentStateVersion, Accounts: map[string]AccountState{}, Nonces: map[string]time.Time{}, EVMSubjects: map[string]EVMSubjectRecord{key: record}}
	raw, _, err := encodeFinanceState(state)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"nativeAccount": null`)) {
		t.Fatal("EVM-only persisted subject did not retain an explicit null native account")
	}
	reopened, _, err := decodeFinanceState(raw)
	if err != nil || reopened.EVMSubjects[key] != record || len(reopened.Accounts) != 0 {
		t.Fatalf("EVM-only subject was not isolated across state reopen: %v %+v", err, reopened.EVMSubjects[key])
	}
	for name, mutate := range map[string]func(*EVMSubjectRecord){
		"wrong subject": func(value *EVMSubjectRecord) { value.SubjectID = "subject_native" },
		"wrong type":    func(value *EVMSubjectRecord) { value.AccountType = "unknown" },
		"wrong chain":   func(value *EVMSubjectRecord) { value.ChainID = 1 },
		"native alias":  func(value *EVMSubjectRecord) { native := "ynx1forbidden"; value.NativeAccount = &native },
		"no creation":   func(value *EVMSubjectRecord) { value.CreatedAt = time.Time{} },
	} {
		value := record
		mutate(&value)
		state.EVMSubjects[key] = value
		if _, _, err := encodeFinanceState(state); err == nil {
			t.Fatalf("%s EVM-only subject state was accepted", name)
		}
	}
	state.EVMSubjects = map[string]EVMSubjectRecord{"6423:0xwrong": record}
	if _, _, err := encodeFinanceState(state); err == nil {
		t.Fatal("EVM subject was accepted under a foreign account key")
	}
	legacy := persistedState{Version: currentStateVersion, Accounts: map[string]AccountState{}, Nonces: map[string]time.Time{}}
	legacyRaw, _, err := encodeFinanceState(legacy)
	if err != nil || bytes.Contains(legacyRaw, []byte(`"evmSubjects"`)) {
		t.Fatal("empty EVM subject schema rewrote legacy state")
	}
}
