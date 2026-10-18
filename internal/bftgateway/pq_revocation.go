package bftgateway

import (
	"bytes"
	"errors"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func isPQSingleIngressKind(kind string) bool {
	return kind == consensus.PQTransferType || kind == consensus.PQMigrationType || kind == consensus.PQRevocationType
}

func decodeIngressPQRevocation(wire []byte) (string, error) {
	if len(wire) == 0 || len(wire) > ynxauth.MaxRevocationBytes {
		return "", errors.New("revocation exceeds protocol bound")
	}
	revocation, err := ynxauth.DecodeRevocation(wire)
	if err != nil {
		return "", err
	}
	canonical, err := revocation.Encode()
	if err != nil || !bytes.Equal(canonical, wire) {
		return "", errors.New("noncanonical revocation original")
	}
	member, err := ynxbatch.DecodeMember(revocation.CurrentPQProof)
	if err != nil {
		return "", err
	}
	message, err := revocation.Intent.SigningBytes()
	if err != nil {
		return "", err
	}
	if member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 || member.Certificate.Purpose != ynxauth.RevocationPurpose || member.Certificate.Owner != revocation.Intent.Owner || !bytes.Equal(member.Certificate.ChainID, revocation.Intent.ChainID) || !bytes.Equal(member.Message, message) {
		return "", errors.New("expected canonical N1 ACCOUNT-REVOCATION current-pair proof")
	}
	// Framing is not authorization. The real Application resolves the current
	// full pair and verifies both signatures, nonce, height and complete schedule.
	return revocation.Intent.Owner, nil
}

func (g *Gateway) handlePQRevocationBroadcast(w http.ResponseWriter, r *http.Request) {
	g.handlePQSingleBroadcast(w, r, consensus.PQRevocationType)
}
