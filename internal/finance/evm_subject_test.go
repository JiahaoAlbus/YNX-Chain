package finance

import (
	"strings"
	"testing"

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
