package commerce

import (
	"bytes"
	"context"

	policy "ynx.local/authgrantpolicy"
)

// originalShopSDKResultEncoder implements Auth's actual registered Shop result
// contract: HTTP Body is exact SDK ResponseOriginal, not a new proof envelope.
// The ORIGINAL held response authority must independently validate and attest
// this result under its protected operation/remote association before return.
// Its proof remains with that original receipt owner; the Auth receiver MUST
// invoke its protected VerifyOriginalResponse, not promote SDK DATA/HTTP200.
type originalShopSDKResultEncoder struct{}

func (originalShopSDKResultEncoder) EncodeShopOrderRead(ctx context.Context, response OriginalShopTaskOrderResponse, attest OriginalShopTaskOrderAttest) (OriginalShopTaskOrderEncoding, error) {
	var zero OriginalShopTaskOrderEncoding
	if ctx == nil || attest == nil || !validShopTaskOperation(response.Operation) || response.AuthScope != policy.EgressOnlyReadFence {
		return zero, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	// Reuse the sole SDK rather than trusting detached JSON supplied by any
	// adapter. This also validates original ref/rev/label/fields/fence and Source
	// binding against the actual projection supplied by the locked Store.
	frozen, err := encodeOriginalShopOrderDATA(copyShopTaskResponse(response))
	if err != nil {
		return zero, err
	}
	if !bytes.Equal(response.ResponseOriginal, frozen.ResponseOriginal) || !bytes.Equal(response.SourceBytes, frozen.SourceBytes) {
		return zero, ErrConflict
	}
	if response.ResponseBinding != (policy.Bind{Bytes: frozen.ResponseBinding.Bytes, SHA3_512: frozen.ResponseBinding.SHA3_512, SHA512: frozen.ResponseBinding.SHA512}) {
		return zero, ErrConflict
	}
	proof, err := attest(ctx, bytes.Clone(frozen.SourceBytes), bytes.Clone(frozen.ResponseOriginal))
	if err != nil {
		return zero, err
	}
	// These are only completeness checks. Actual signature/receipt authority
	// belongs to the held original producer and its independent Auth verifier.
	if proof.Purpose == "" || len(proof.Wire) == 0 || len(proof.Wire) > maxBody || !bytes.Equal(proof.Payload, frozen.ResponseOriginal) {
		return zero, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	return OriginalShopTaskOrderEncoding{
		ResponseOriginal: bytes.Clone(frozen.ResponseOriginal), SourceBytes: bytes.Clone(frozen.SourceBytes),
		Body: bytes.Clone(frozen.ResponseOriginal), ContentType: "application/json",
	}, nil
}

// OpenOriginalShopTaskOrdersSDKResult is the normal producer matching Auth's
// registered SDK-result client. It supplies the real encoder locally; actual
// original Source/channel/receipt authority are still required and cannot be
// installed by HTTP, ENV or DATA. The zero-input native factory stays closed.
func OpenOriginalShopTaskOrdersSDKResult(ctx context.Context, channels OriginalShopTaskOrderOuterChannelAuthority, responses OriginalShopTaskOrderResponseAuthority, target policy.Sink, kind string) (*PreparedOriginalShopTaskOrders, error) {
	return OpenOriginalShopTaskOrdersSDK(ctx, originalShopSDKResultEncoder{}, channels, responses, target, kind)
}
