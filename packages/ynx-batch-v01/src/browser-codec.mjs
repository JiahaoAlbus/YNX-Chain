// Syntax/resource validation only; decoding does not authenticate or authorize.
import {createCodec} from './codec-core.mjs';
import {publicByteRuntime} from './public-bytes.mjs';
export {VERSION, SUITE, LIMIT, ProtocolError, requireThat} from './codec-core.mjs';
const codec = createCodec(publicByteRuntime);
export const {bytes, exact, u32, batchCount, encodeFields, encodeContext, decodeContext,
  encodeDescriptor, decodeDescriptor, encodeCertificate, decodeCertificate, validateMessages,
  encodeProof, decodeProof, encodeWhole, decodeWhole, encodeMember, decodeMember} = codec;
