# YNX Chain Environment Intake Form

Fill this once the code, templates, scripts, and documents are ready for real deployment. Sensitive values must be sent through a secure channel and must not be committed.

| Module | Env var | Required | Purpose | Format | Sensitive | File | Services | Missing impact | Verification command |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| General | TESTNET_DOMAIN | yes | Real deployment value for TESTNET_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | WEBSITE_DOMAIN | yes | Real deployment value for WEBSITE_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | EXPLORER_DOMAIN | yes | Real deployment value for EXPLORER_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | RPC_DOMAIN | yes | Real deployment value for RPC_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | EVM_RPC_DOMAIN | yes | Real deployment value for EVM_RPC_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | FAUCET_DOMAIN | yes | Real deployment value for FAUCET_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | API_DOMAIN | yes | Real deployment value for API_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | AI_GATEWAY_DOMAIN | yes | Real deployment value for AI_GATEWAY_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | TRUST_API_DOMAIN | yes | Real deployment value for TRUST_API_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | PAY_API_DOMAIN | yes | Real deployment value for PAY_API_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | IDE_DOMAIN | yes | Real deployment value for IDE_DOMAIN. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | SERVER_HOST | yes | Real deployment value for SERVER_HOST. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | SERVER_USER | yes | Real deployment value for SERVER_USER. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | SSH_KEY_PATH | yes | Real deployment value for SSH_KEY_PATH. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | DEPLOY_TARGET | yes | Real deployment value for DEPLOY_TARGET. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | CHAIN_ID | yes | Real deployment value for CHAIN_ID. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | CHAIN_NAME | yes | Real deployment value for CHAIN_NAME. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | NATIVE_COIN_NAME | yes | Real deployment value for NATIVE_COIN_NAME. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | NATIVE_SYMBOL | yes | Real deployment value for NATIVE_SYMBOL. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | GENESIS_VALIDATOR_NAME | yes | Real deployment value for GENESIS_VALIDATOR_NAME. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | VALIDATOR_KEY_PATH | yes | Real deployment value for VALIDATOR_KEY_PATH. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | FAUCET_PRIVATE_KEY | yes | Real deployment value for FAUCET_PRIVATE_KEY. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | DEPLOYER_PRIVATE_KEY | yes | Real deployment value for DEPLOYER_PRIVATE_KEY. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | TREASURY_ADDRESS | yes | Real deployment value for TREASURY_ADDRESS. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | FOUNDATION_ADDRESS | yes | Real deployment value for FOUNDATION_ADDRESS. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | TEAM_VESTING_ADDRESS | yes | Real deployment value for TEAM_VESTING_ADDRESS. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | POSTGRES_URL | yes | Real deployment value for POSTGRES_URL. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | REDIS_URL | yes | Real deployment value for REDIS_URL. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | OBJECT_STORAGE_ENDPOINT | yes | Real deployment value for OBJECT_STORAGE_ENDPOINT. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | OBJECT_STORAGE_BUCKET | yes | Real deployment value for OBJECT_STORAGE_BUCKET. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | OBJECT_STORAGE_ACCESS_KEY | yes | Real deployment value for OBJECT_STORAGE_ACCESS_KEY. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | OBJECT_STORAGE_SECRET_KEY | yes | Real deployment value for OBJECT_STORAGE_SECRET_KEY. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | OPENAI_API_KEY | yes | Real deployment value for OPENAI_API_KEY. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | AI_MODEL_NAME | yes | Real deployment value for AI_MODEL_NAME. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | EMAIL_PROVIDER | yes | Real deployment value for EMAIL_PROVIDER. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | EMAIL_API_KEY | yes | Real deployment value for EMAIL_API_KEY. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | WEBHOOK_SECRET | yes | Real deployment value for WEBHOOK_SECRET. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | JWT_SECRET | yes | Real deployment value for JWT_SECRET. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | SESSION_SECRET | yes | Real deployment value for SESSION_SECRET. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | RATE_LIMIT_SECRET | yes | Real deployment value for RATE_LIMIT_SECRET. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | PAY_MERCHANT_SECRET | yes | Real deployment value for PAY_MERCHANT_SECRET. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | TRUST_REPORT_SIGNING_KEY | yes | Real deployment value for TRUST_REPORT_SIGNING_KEY. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | MONITORING_ADMIN_PASSWORD | yes | Real deployment value for MONITORING_ADMIN_PASSWORD. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | BACKUP_STORAGE_PATH | yes | Real deployment value for BACKUP_STORAGE_PATH. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | SSL_EMAIL | yes | Real deployment value for SSL_EMAIL. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | NGINX_SERVER_NAME | yes | Real deployment value for NGINX_SERVER_NAME. | service-specific string | no | matching .env.* | deployment stack | related service refuses to start | make env-check |
| General | GITHUB_REPO_TOKEN | yes | Real deployment value for GITHUB_REPO_TOKEN. | service-specific string | yes | matching .env.* | deployment stack | related service refuses to start | make env-check |

