package governance

func publicVoteRecordFrom(proposal Proposal, vote Vote, current bool) PublicVoteRecord {
	record := PublicVoteRecord{
		ProposalID:          proposal.ID,
		Scope:               proposal.Input.Scope,
		ChainID:             vote.ChainID,
		Domain:              vote.Domain,
		Voter:               vote.Voter,
		Choice:              vote.Choice,
		Power:               vote.Power,
		Operation:           vote.Operation,
		Revision:            vote.Revision,
		Nonce:               vote.Nonce,
		PublicKey:           vote.PublicKey,
		Signature:           vote.Signature,
		SignedAt:            vote.SignedAt,
		ExpiresAt:           vote.ExpiresAt,
		CastAt:              vote.CastAt,
		SupersedesAuditHash: vote.SupersedesAuditHash,
		AuditHash:           vote.AuditHash,
		CurrentRevision:     current,
	}
	if proposal.Electorate != nil {
		record.ElectorateEvidence = proposal.Electorate.EvidenceHash
		record.ElectorateVersion = proposal.Electorate.SourceVersion
		record.ElectorateSnapshot = proposal.Electorate.SnapshotAsOf
	}
	return record
}
