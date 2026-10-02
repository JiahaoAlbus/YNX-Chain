These three fixtures are exact public-only bytes from the retired Root2/54 observation and the failed, unsigned55 receipt proposal. They contain no issuer private key, user token or credential. The missing three Finance provider boundary fields are deliberately preserved as the original failure input. Tests mutate copies into fresh controlled observations solely for a pure validator regression; those copies are not public acceptance evidence.

Original SHA256 values:
- retired-root2-config54.json: f91b90987c59f9b6aea07b1ed151d56d5b53e6db9b467dc2cffed662dc0586da
- retired55-gateway-receipt.json: 6678089eb6c0c9bffff86291e53d1c7cafa82b8a4e74babf46efa9fc14bcf478
- retired55-finance-receipt-missing-boundaries.json: 4e29d994edf0cdb396c3b07ec9f288537082f01e76541f145c40bf9032bb6f12

The lifecycle helper only authenticates the historical anchor at its actual signed issuance time. It explicitly reports currentAuthorityVerified=false and activated=false. New trust requires an independent reviewed new Root3 pin and real current-time validation; these fixtures cannot authorize live service.
