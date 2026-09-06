import jsQR from "jsqr";

const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16 * 1024 * 1024;

export function decodeWalletConnectQR({ bytes, mimeType, createImage, decode = jsQR }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES || !ACCEPTED_MIME_TYPES.has(mimeType)) throw qrError("INVALID_QR_IMAGE", "Choose a PNG, JPEG or WebP image up to 10 MB");
  const image = createImage(bytes);
  if (!image || image.isEmpty()) throw qrError("QR_DECODE_FAILED", "The image could not be decoded locally");
  const { width, height } = image.getSize();
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) throw qrError("INVALID_QR_DIMENSIONS", "QR image dimensions exceed the local decoder limit");
  const bgra = image.toBitmap();
  if (!Buffer.isBuffer(bgra) || bgra.length !== width * height * 4) throw qrError("QR_DECODE_FAILED", "Decoded image pixels were invalid");
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let index = 0; index < bgra.length; index += 4) {
    rgba[index] = bgra[index + 2];
    rgba[index + 1] = bgra[index + 1];
    rgba[index + 2] = bgra[index];
    rgba[index + 3] = bgra[index + 3];
  }
  const decoded = decode(rgba, width, height, { inversionAttempts: "attemptBoth" });
  const uri = decoded?.data?.trim();
  if (typeof uri !== "string" || !/^wc:[0-9a-f-]+@2\?/.test(uri) || uri.length > 8192) throw qrError("INVALID_WALLETCONNECT_QR", "A WalletConnect v2 QR code is required");
  return Object.freeze({ uri, format: "qr_code", decodedLocally: true, uploaded: false });
}

function qrError(code, message) { return Object.assign(new Error(message), { code }); }
