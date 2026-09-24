package finance

import (
	"context"
	"errors"
)

// BrokerReadOnlyAccountResolver is a snapshot of one existing owner mapping.
// It cannot migrate, bootstrap, save, or refresh the Finance state repository.
type BrokerReadOnlyAccountResolver struct {
	owner     string
	accountID string
}

func (r BrokerReadOnlyAccountResolver) ResolveBrokerAccount(_ context.Context, owner, provider, environment string) (string, error) {
	if owner != r.owner || provider != FinanceOrderProvider || environment != FinanceOrderTradingEnv || !financeProviderUUIDPattern.MatchString(r.accountID) {
		return "", errors.New("Broker account is not linked to this Finance subject")
	}
	return r.accountID, nil
}

// InspectBrokerAccountResolverReadOnly loads the already-persisted mapping
// without invoking OpenStoreWithDatabase, which can run DDL and bootstrap a
// database. The caller may use this resolver for bounded official reads only.
func InspectBrokerAccountResolverReadOnly(ctx context.Context, statePath, databaseURL, owner string) (BrokerReadOnlyAccountResolver, string, error) {
	if _, err := DeriveFinanceSubjectID(owner); err != nil {
		return BrokerReadOnlyAccountResolver{}, "", errors.New("Finance activation owner is invalid")
	}
	state, backend, err := loadFinanceStateReadOnly(ctx, statePath, databaseURL)
	if err != nil {
		return BrokerReadOnlyAccountResolver{}, "", err
	}
	accountState, ok := state.Accounts[owner]
	if !ok {
		return BrokerReadOnlyAccountResolver{}, "", errors.New("Broker account is not linked to this Finance subject")
	}
	mapping, ok := accountState.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)]
	if !ok || mapping.Account != owner || mapping.Provider != FinanceOrderProvider || mapping.TradingEnvironment != FinanceOrderTradingEnv || mapping.Status != "active" || !financeProviderUUIDPattern.MatchString(mapping.BrokerAccountID) {
		return BrokerReadOnlyAccountResolver{}, "", errors.New("Broker account is not linked to this Finance subject")
	}
	for otherOwner, otherState := range state.Accounts {
		if otherOwner == owner {
			continue
		}
		if otherState.Brokerage.Mappings[brokerMappingKey(FinanceOrderProvider, FinanceOrderTradingEnv)].BrokerAccountID == mapping.BrokerAccountID {
			return BrokerReadOnlyAccountResolver{}, "", errors.New("Broker account mapping is ambiguous")
		}
	}
	return BrokerReadOnlyAccountResolver{owner: owner, accountID: mapping.BrokerAccountID}, backend, nil
}
