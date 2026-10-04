module.exports = function unavailable(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.statusCode = 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ok:false,error:"MEDIA_PRIVATE_SOURCE_NOT_CONFIGURED",release:"testnet-preview-20261004",cryptoActivated:false}));
};
