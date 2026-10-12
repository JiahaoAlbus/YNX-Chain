import { DeveloperError, invariant } from "./errors.js";

export class WalletDeployment {
  constructor({ wallet = globalThis.ynxWallet, chainClient, clock = Date.now } = {}) { this.wallet = wallet; this.chainClient = chainClient; this.clock = clock; }
  review({ projectId, account, artifact, constructorArgs = [] }) {
    invariant(artifact && (artifact.artifactHash || artifact.bytecodeHash), "artifact_required", "Deployment review requires real compiler artifact evidence.");
    invariant(account?.startsWith("ynx1"), "native_account_required", "Wallet deployment requires a canonical ynx1 account.");
    return Object.freeze({ version: 1, action: "ynx.developer.deploy", projectId, chainId: "ynx_6423-1", evmChainId: 6423, nativeSymbol: "YNXT", account, artifactHash: artifact.artifactHash ?? null, bytecodeHash: artifact.bytecodeHash ?? null, constructorArgs: constructorArgs.map(String), createdAt: new Date(this.clock()).toISOString(), expiresAt: new Date(this.clock() + 5 * 60_000).toISOString(), warning: "Wallet signs and submits. YNX Developer never receives a private key." });
  }
  async authorize(review, { confirmed = false } = {}) {
    invariant(confirmed, "deployment_confirmation_required", "Deployment requires a separate human confirmation after review.");
    invariant(this.wallet && typeof this.wallet.authorizeDeployment === "function", "wallet_unavailable", "YNX Wallet deployment provider is unavailable. Web Product cannot sign or deploy.");
    const authorization = await this.wallet.authorizeDeployment(review);
    invariant(authorization?.status === "authorized" && authorization.requestId, "wallet_rejected", "YNX Wallet did not authorize this exact deployment.");
    return authorization;
  }
  async signAndSubmit(review, authorization, { approved = false } = {}) {
    invariant(approved, "deploy_approval_required", "Network deployment requires a separate final approval.");
    invariant(this.wallet && typeof this.wallet.signAndSubmitDeployment === "function", "wallet_unavailable", "YNX Wallet signing provider is unavailable.");
    const result = await this.wallet.signAndSubmitDeployment({ review, authorization });
    invariant(result?.submitted === true && /^0x[0-9a-f]{64}$/i.test(result.txHash), "invalid_deployment_evidence", "Wallet did not return a valid submitted transaction hash. Deployment success is not claimed.");
    return { status: "submitted-unconfirmed", txHash: result.txHash, submittedAt: new Date(this.clock()).toISOString() };
  }
  async confirm(submission) {
    const receipt = await this.chainClient.receipt(submission.txHash);
    invariant(receipt && receipt.transactionHash?.toLowerCase() === submission.txHash.toLowerCase(), "receipt_unavailable", "Authoritative deployment receipt is not available yet.");
    invariant(receipt.status === "0x1" || receipt.status === 1 || receipt.status === "success", "deployment_failed", "The authoritative receipt reports deployment failure.", { receipt });
    invariant(receipt.contractAddress, "contract_address_missing", "Receipt has no contract address; deployment is not confirmed.");
    return { status: "confirmed", txHash: submission.txHash, address: receipt.contractAddress, receipt };
  }
  async sourceMatch(confirmation, source) {
    const result = await this.chainClient.verify({ address: confirmation.address, source });
    const evidence = await this.chainClient.verifier(confirmation.address);
    const matched = result.verified === true && /matched/i.test(String(evidence.deployedBytecodeComparisonStatus ?? ""));
    return { status: matched ? "source-matched-local-evidence" : "source-not-matched", remotePublicProof: evidence.remotePublicProofStatus === "verified_remote_public_proof", result, evidence };
  }
}
