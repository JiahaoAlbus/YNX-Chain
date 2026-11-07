package main

import "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"

// Public, detached, per-call DATA; no key, Root, Source, session or cache.
type sourceStatementV2Inputs struct {
	registration registeredN1Inputs
	body         []byte
	frame        string
	role         ynxbatch.AuthSourceStatementV2Role
	issuedHeight uint64
}

func verifySourceStatementV2(in sourceStatementV2Inputs) registeredN1VerifyCode {
	b := ynxbatch.AuthSourceStatementV2Binding{Role: in.role, Frame: in.frame, NetworkID: in.registration.network,
		Owner: in.registration.owner, KeyVersion: in.registration.policyRevision, IssuedHeight: in.issuedHeight}
	message, err := ynxbatch.BuildAuthSourceStatementV2(in.body, b)
	if err != nil {
		return registeredN1Argument
	}
	// The expected current full pair must also have been active at issuance.
	// Current statements are for the exact independently observed height only.
	if in.issuedHeight > in.registration.observedHeight || in.issuedHeight < in.registration.activeFrom ||
		in.role == ynxbatch.AuthSourceCurrentV2 && in.issuedHeight != in.registration.observedHeight {
		return registeredN1TrustDenied
	}
	in.registration.message = message
	in.registration.purpose, _ = ynxbatch.AuthSourceStatementV2Purpose(in.role)
	return verifyRegisteredANDMemberN1Bounded(in.registration, ynxbatch.AuthSourceStatementV2MessageMaximum, ynxbatch.AuthSourceStatementV2MemberMaximum)
}
