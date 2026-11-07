package ynxauth

// ValidateCurrentPQMigrationIntent checks original intent/schedule/revision/
// exact-next ledger nonce rules before reading the CURRENT private pair. The
// returned detached Record is public DATA, not a signing capability, approval,
// current-key proof or proposed-key possession. It cannot admit a migration.
// Legacy, pending and permanently revoked accounts have no fallback here.
func (s State) ValidateCurrentPQMigrationIntent(intent RegistrationIntent, height, currentNonce uint64) (Record, error) {
	if _, err := s.validateMigrationIntent(Migration{Intent: intent}, height, currentNonce); err != nil {
		return Record{}, err
	}
	if _, err := s.TrustedRegistration(intent.Owner, MigrationPurpose, height); err != nil {
		return Record{}, err
	}
	record, active := s.PolicyAt(intent.Owner, height)
	if !active {
		return Record{}, ErrPolicy
	}
	return record, nil
}
