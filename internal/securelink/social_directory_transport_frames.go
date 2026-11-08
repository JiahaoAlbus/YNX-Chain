package securelink

import (
	"crypto/subtle"
	"encoding/binary"
	"errors"
)

// Fixed SDK R2 contract: EARLY_ACK_CONTRACT_R2.json, 3985 bytes, SHA-256
// fa7f268391e1a2a776df015aca8fb31a6c348106fb619918cf31e26ce24291bd.
// These frames carry closure observations on the existing registered L/C
// private channel. Their hashes are metadata, never Root/Source/Principal
// admission, a new signature domain, or proof of the channel's identity.
const (
	socialDirectoryReadReleaseFrameBytes = 74
	socialDirectoryClosedAckFrameBytes   = 81
)

var errSocialDirectoryAckFrame = errors.New("secure link: invalid Social directory R2 closure frame")

// socialDirectoryAck keeps physical closure independent from late failure.
// ErrorKind 1 preserves every exact int32 code, including numeric zero. Kind 2
// says the actual original first cause remains privately retained by its owner;
// this codec neither constructs an error from metadata nor replaces that cause.
type socialDirectoryAck struct {
	Closed, ErrorPresent bool
	ErrorKind            byte
	ErrorCode            int32
}

// encodeSocialDirectoryReadRelease encodes W only. The caller must already have
// observed the actual completed read and own the SAME outstanding response on
// the SAME private channel; a frame cannot establish either lifecycle fact.
func encodeSocialDirectoryReadRelease(reqSHA, responseSHA [32]byte) [74]byte {
	var frame [socialDirectoryReadReleaseFrameBytes]byte
	frame[0] = 'W'
	binary.BigEndian.PutUint32(frame[1:5], 69)
	// metadataLength at [5:9] is the fixed zero value, never caller metadata.
	frame[9] = 1
	copy(frame[10:42], reqSHA[:])
	copy(frame[42:74], responseSHA[:])
	return frame
}

// decodeSocialDirectoryClosedAck accepts exactly one fixed R2 A frame bound to
// the retained original request and response hashes. It returns no observation
// on any malformed or mismatched frame. In particular old A80 is not accepted.
// A valid Closed=false or Closed=true/ErrorPresent=true remains a physical
// observation; usable completion also needs the owner's current/loan checks,
// original first cause, and actual LINK drain outside this pure codec.
func decodeSocialDirectoryClosedAck(frame []byte, reqSHA, responseSHA [32]byte) (socialDirectoryAck, error) {
	if len(frame) != socialDirectoryClosedAckFrameBytes || frame[0] != 'A' ||
		binary.BigEndian.Uint32(frame[1:5]) != 76 || binary.BigEndian.Uint32(frame[5:9]) != 0 || frame[9] != 1 {
		return socialDirectoryAck{}, errSocialDirectoryAckFrame
	}
	if subtle.ConstantTimeCompare(frame[10:42], reqSHA[:])&subtle.ConstantTimeCompare(frame[42:74], responseSHA[:]) != 1 {
		return socialDirectoryAck{}, errSocialDirectoryAckFrame
	}
	if frame[74] > 1 || frame[75] > 1 {
		return socialDirectoryAck{}, errSocialDirectoryAckFrame
	}
	ack := socialDirectoryAck{
		Closed: frame[74] == 1, ErrorPresent: frame[75] == 1,
		ErrorKind: frame[76], ErrorCode: int32(binary.BigEndian.Uint32(frame[77:81])),
	}
	if !ack.ErrorPresent {
		if ack.ErrorKind != 0 || ack.ErrorCode != 0 {
			return socialDirectoryAck{}, errSocialDirectoryAckFrame
		}
	} else {
		switch ack.ErrorKind {
		case 1: // Exact numeric code, including zero, remains present.
		case 2:
			if ack.ErrorCode != 0 {
				return socialDirectoryAck{}, errSocialDirectoryAckFrame
			}
		default:
			return socialDirectoryAck{}, errSocialDirectoryAckFrame
		}
	}
	return ack, nil
}
