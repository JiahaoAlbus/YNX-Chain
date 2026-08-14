#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { canonicalJSON } from "../src/canonical.js";
import { createDeploymentArtifactIntegrity, verifyDeploymentArtifactIntegrity } from "../src/deployment-artifact-integrity.js";

const mode = required("YNX_WALLET_DEPLOYMENT_ARTIFACT_INTEGRITY_MODE");
const manifest = await readFile(required("YNX_WALLET_ERC4337_DEPLOYMENT_MANIFEST"), "utf8");
const sourceCommit = required("SOURCE_COMMIT");
if (mode === "create") console.log(canonicalJSON(createDeploymentArtifactIntegrity(manifest, sourceCommit)));
else if (mode === "verify") {
  const sidecar = await readFile(required("YNX_WALLET_ERC4337_DEPLOYMENT_INTEGRITY"), "utf8");
  console.log(canonicalJSON(verifyDeploymentArtifactIntegrity(manifest, sidecar, sourceCommit)));
} else throw new Error("YNX_WALLET_DEPLOYMENT_ARTIFACT_INTEGRITY_MODE must be create or verify");

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
