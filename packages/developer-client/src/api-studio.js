import { DeveloperError, invariant } from "./errors.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
const PARAMETER_LOCATIONS = new Set(["path", "query", "header"]);
const MAX_SPEC_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const CREDENTIAL_REFERENCE = /^credential-ref:[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/iu;
const SAFE_OPERATION_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;

const CONNECTORS = Object.freeze({
  walletconnect: { label: "WalletConnect", owner: "02-wallet-auth", method: "post", path: "/v1/walletconnect/sessions", operationId: "createWalletConnectSession", summary: "Create a bounded WalletConnect session request", body: true },
  bridge: { label: "Bridge", owner: "21-bridge", method: "post", path: "/v1/bridge/quotes", operationId: "createBridgeQuote", summary: "Request a non-settlement bridge quote", body: true },
  card: { label: "Card", owner: "06-card", method: "post", path: "/v1/card/sandbox/authorizations", operationId: "createCardSandboxAuthorization", summary: "Create an issuer-sandbox authorization request", body: true },
  search: { label: "Search", owner: "23-search", method: "get", path: "/v1/search", operationId: "searchPublicIndex", summary: "Search an explicitly selected public index", query: [{ name: "q", required: true }] },
  storage: { label: "Storage", owner: "20-cloud", method: "post", path: "/v1/storage/objects", operationId: "createStorageObjectIntent", summary: "Create an object-upload intent without embedding credentials", body: true },
  mail: { label: "Mail", owner: "25-mail", method: "post", path: "/v1/mail/drafts", operationId: "createMailDraft", summary: "Create a reviewable mail draft; this does not send it", body: true },
  shipping: { label: "Shipping", owner: "09-shop", method: "post", path: "/v1/shipping/quotes", operationId: "createShippingQuote", summary: "Request a provider quote without marking fulfillment", body: true },
  oracle: { label: "Oracle", owner: "19-oracle-market-data", method: "get", path: "/v1/oracle/prices/{symbol}", operationId: "getOraclePrice", summary: "Read a source-versioned Oracle price", pathParameters: [{ name: "symbol", required: true }] },
});

const byteLength = (value) => new TextEncoder().encode(value).byteLength;
const clone = (value) => JSON.parse(JSON.stringify(value));
const pointerToken = (value) => value.replace(/~1/gu, "/").replace(/~0/gu, "~");

function resolveLocal(document, value, context) {
  if (!value || typeof value !== "object" || !("$ref" in value)) return value;
  invariant(typeof value.$ref === "string" && value.$ref.startsWith("#/"), "external_reference_rejected", `${context} must use a local OpenAPI reference.`);
  const target = value.$ref.slice(2).split("/").map(pointerToken).reduce((current, key) => current?.[key], document);
  invariant(target && typeof target === "object", "openapi_reference_missing", `${context} references a missing component.`, { reference: value.$ref });
  return target;
}

function rejectExternalReferences(value, path = "document") {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && !value.$ref.startsWith("#/")) throw new DeveloperError("external_reference_rejected", `${path} contains an external reference. Import dependencies explicitly before review.`, { reference: value.$ref });
  for (const [key, child] of Object.entries(value)) rejectExternalReferences(child, `${path}.${key}`);
}

function parseDocument(source) {
  if (typeof source === "string") {
    invariant(byteLength(source) <= MAX_SPEC_BYTES, "openapi_spec_too_large", `OpenAPI input exceeds ${MAX_SPEC_BYTES} bytes.`);
    try { return JSON.parse(source); }
    catch (error) {
      const code = /^\s*openapi\s*:/iu.test(source) ? "openapi_json_required" : "openapi_json_invalid";
      throw new DeveloperError(code, "YNX API Studio imports reviewed OpenAPI JSON. Convert YAML explicitly so the exact document can be diffed.", { cause: error instanceof Error ? error.message : String(error) });
    }
  }
  invariant(source && typeof source === "object" && !Array.isArray(source), "openapi_document_required", "An OpenAPI JSON object is required.");
  const serialized = JSON.stringify(source);
  invariant(byteLength(serialized) <= MAX_SPEC_BYTES, "openapi_spec_too_large", `OpenAPI input exceeds ${MAX_SPEC_BYTES} bytes.`);
  return clone(source);
}

function generatedOperationId(method, path) {
  const words = path.replace(/[{}]/gu, "").split(/[^A-Za-z0-9]+/u).filter(Boolean);
  const suffix = words.map((word, index) => index === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1)}`).join("");
  return `${method.toLowerCase()}${suffix ? `${suffix[0].toUpperCase()}${suffix.slice(1)}` : "Root"}`;
}

function parameter(document, raw, context) {
  const value = resolveLocal(document, raw, context);
  invariant(value && typeof value === "object" && typeof value.name === "string" && value.name, "openapi_parameter_invalid", `${context} is invalid.`);
  invariant(PARAMETER_LOCATIONS.has(value.in), "openapi_parameter_location_unsupported", `${context} uses unsupported location ${value.in}.`);
  if (value.in === "path") invariant(value.required === true, "openapi_path_parameter_required", `${context} path parameters must be required.`);
  return { name: value.name, in: value.in, required: value.required === true, schema: value.schema && typeof value.schema === "object" ? clone(value.schema) : {} };
}

function securitySchemes(document) {
  const output = {};
  for (const [name, unresolved] of Object.entries(document.components?.securitySchemes ?? {})) {
    const value = resolveLocal(document, unresolved, `security scheme ${name}`);
    invariant(value && typeof value === "object", "openapi_security_scheme_invalid", `Security scheme ${name} is invalid.`);
    if (value.type === "apiKey") {
      invariant(["header", "query"].includes(value.in) && typeof value.name === "string" && value.name, "openapi_security_scheme_invalid", `API key scheme ${name} must use a named header or query parameter.`);
      output[name] = { type: "apiKey", in: value.in, name: value.name };
    } else if (value.type === "http") {
      invariant(String(value.scheme).toLowerCase() === "bearer", "openapi_security_scheme_unsupported", `HTTP scheme ${name} must be bearer.`);
      output[name] = { type: "http", scheme: "bearer" };
    } else if (["oauth2", "openIdConnect"].includes(value.type)) output[name] = { type: value.type };
    else throw new DeveloperError("openapi_security_scheme_unsupported", `Security scheme ${name} uses unsupported type ${value.type}.`);
  }
  return output;
}

function security(document, operation, schemes, context) {
  const requirements = operation.security ?? document.security ?? [];
  invariant(Array.isArray(requirements), "openapi_security_invalid", `${context} security must be an array.`);
  return requirements.map((requirement, index) => {
    invariant(requirement && typeof requirement === "object" && !Array.isArray(requirement), "openapi_security_invalid", `${context} security requirement ${index + 1} is invalid.`);
    const output = {};
    for (const [name, scopes] of Object.entries(requirement)) {
      invariant(schemes[name], "openapi_security_scheme_missing", `${context} references missing security scheme ${name}.`);
      invariant(Array.isArray(scopes), "openapi_security_invalid", `${context} scopes for ${name} must be an array.`);
      output[name] = [...scopes];
    }
    return output;
  });
}

function requestBody(document, raw, context) {
  if (!raw) return null;
  const value = resolveLocal(document, raw, context);
  invariant(value && typeof value === "object", "openapi_request_body_invalid", `${context} request body is invalid.`);
  invariant(Object.hasOwn(value.content ?? {}, "application/json"), "openapi_json_body_required", `${context} must expose an application/json request body.`);
  return { required: value.required === true };
}

function normalize(source) {
  const document = parseDocument(source);
  rejectExternalReferences(document);
  invariant(typeof document.openapi === "string" && /^3\.(0|1)\./u.test(document.openapi), "openapi_version_unsupported", "YNX API Studio supports OpenAPI 3.0.x and 3.1.x JSON documents.");
  invariant(document.info && typeof document.info.title === "string" && document.info.title.trim(), "openapi_info_invalid", "OpenAPI info.title is required.");
  invariant(typeof document.info.version === "string" && document.info.version.trim(), "openapi_info_invalid", "OpenAPI info.version is required.");
  invariant(document.paths && typeof document.paths === "object" && !Array.isArray(document.paths), "openapi_paths_required", "OpenAPI paths are required.");
  const schemes = securitySchemes(document);
  const operations = [];
  const ids = new Set();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    invariant(path.startsWith("/") && !path.includes("..") && !/[?#]/u.test(path), "openapi_path_invalid", `OpenAPI path ${path} is invalid.`);
    invariant(pathItem && typeof pathItem === "object", "openapi_path_invalid", `OpenAPI path ${path} is invalid.`);
    const inherited = Array.isArray(pathItem.parameters) ? pathItem.parameters.map((item, index) => parameter(document, item, `${path} parameter ${index + 1}`)) : [];
    for (const method of METHODS) {
      const raw = pathItem[method];
      if (!raw) continue;
      invariant(raw && typeof raw === "object", "openapi_operation_invalid", `${method.toUpperCase()} ${path} is invalid.`);
      const operationId = raw.operationId ?? generatedOperationId(method, path);
      invariant(SAFE_OPERATION_ID.test(operationId), "openapi_operation_id_invalid", `${method.toUpperCase()} ${path} has an invalid operationId.`);
      invariant(!ids.has(operationId), "openapi_operation_id_duplicate", `Duplicate operationId ${operationId}.`);
      ids.add(operationId);
      invariant(raw.responses && typeof raw.responses === "object" && Object.keys(raw.responses).length, "openapi_responses_required", `${operationId} must declare responses.`);
      const own = Array.isArray(raw.parameters) ? raw.parameters.map((item, index) => parameter(document, item, `${operationId} parameter ${index + 1}`)) : [];
      const parameters = [...inherited, ...own];
      const unique = new Set();
      for (const item of parameters) {
        const key = `${item.in}:${item.name.toLowerCase()}`;
        invariant(!unique.has(key), "openapi_parameter_duplicate", `${operationId} repeats parameter ${item.name}.`);
        unique.add(key);
      }
      operations.push({ operationId, method: method.toUpperCase(), path, summary: typeof raw.summary === "string" ? raw.summary : "", parameters, requestBody: requestBody(document, raw.requestBody, operationId), security: security(document, raw, schemes, operationId) });
    }
  }
  invariant(operations.length, "openapi_operations_required", "OpenAPI document has no supported operations.");
  return { document, schemes, operations };
}

function normalizedURL(value, fallback) {
  const url = new URL(value, fallback);
  invariant(!url.username && !url.password, "api_target_credentials_rejected", "API target URLs cannot embed credentials.");
  invariant(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)), "api_target_protocol_rejected", "API targets must use HTTPS, except localhost sandbox targets.");
  return url;
}

function parameterValue(values, item, operationId) {
  const value = values?.[item.name];
  if (item.required) invariant(value !== undefined && value !== null && value !== "", "openapi_parameter_required", `${operationId} requires ${item.in} parameter ${item.name}.`);
  return value;
}

function appendQuery(searchParams, name, value) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) for (const item of value) searchParams.append(name, String(item));
  else searchParams.set(name, typeof value === "object" ? JSON.stringify(value) : String(value));
}

function selectSecurity(operation, schemes, references) {
  if (!operation.security.length) return [];
  for (const requirement of operation.security) {
    const names = Object.keys(requirement);
    if (!names.length) return [];
    if (names.every((name) => CREDENTIAL_REFERENCE.test(references?.[name] ?? ""))) return names.map((name) => ({ scheme: name, reference: references[name], definition: schemes[name], scopes: requirement[name] }));
  }
  throw new DeveloperError("credential_reference_required", `${operation.operationId} requires credential-ref: references; inline credentials are rejected.`);
}

function inspectHeaders(headers) {
  const output = {};
  for (const [name, value] of headers.entries()) output[name] = SENSITIVE_HEADER.test(name) ? "[redacted]" : value;
  return output;
}

function safeIdentifier(value) {
  const output = String(value).replace(/[^A-Za-z0-9_$]/gu, "_");
  return /^[A-Za-z_$]/u.test(output) ? output : `operation_${output}`;
}

async function boundedText(response, limit) {
  const text = await response.text();
  invariant(byteLength(text) <= limit, "api_response_too_large", `Sandbox response exceeds ${limit} bytes.`);
  return text;
}

export function listConnectorTemplates() {
  return Object.entries(CONNECTORS).map(([id, value]) => ({ id, label: value.label, owner: value.owner }));
}

export function createConnectorTemplate(id) {
  const definition = CONNECTORS[id];
  invariant(definition, "connector_template_unknown", `Unknown connector template ${id}.`);
  const parameters = [
    ...(definition.pathParameters ?? []).map((item) => ({ ...item, in: "path", schema: { type: "string" } })),
    ...(definition.query ?? []).map((item) => ({ ...item, in: "query", schema: { type: "string" } })),
  ];
  const operation = {
    operationId: definition.operationId,
    summary: definition.summary,
    parameters,
    responses: { "200": { description: "Adapter response" }, "429": { description: "Rate limited" }, "503": { description: "Provider unavailable" } },
    security: [{ providerReference: [] }],
  };
  if (definition.body) operation.requestBody = { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } };
  return {
    openapi: "3.1.0",
    info: { title: `YNX ${definition.label} Adapter Template`, version: "1.0.0", description: "Reviewed adapter contract template only. It does not claim provider affiliation, credentials, connectivity, settlement, or production status." },
    servers: [{ url: "/api-sandbox", description: "Same-origin reviewed sandbox gateway" }],
    paths: { [definition.path]: { [definition.method]: operation } },
    components: { securitySchemes: { providerReference: { type: "http", scheme: "bearer" } } },
    "x-ynx-owner": definition.owner,
    "x-ynx-source-class": "reviewed-adapter-template",
    "x-ynx-affiliation-claim": false,
  };
}

export class OpenAPIStudio {
  constructor({ fetcher = globalThis.fetch, credentialBroker = null, allowedOrigins = [], defaultOrigin = "http://127.0.0.1", clock = () => new Date().toISOString(), timeoutMs = 10_000, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
    invariant(typeof fetcher === "function", "api_fetcher_required", "API Studio requires a fetch-compatible sandbox transport.");
    this.fetcher = fetcher;
    this.credentialBroker = credentialBroker;
    this.defaultOrigin = normalizedURL(defaultOrigin, "http://127.0.0.1").origin;
    this.allowedOrigins = new Set((allowedOrigins.length ? allowedOrigins : [this.defaultOrigin]).map((value) => normalizedURL(value, this.defaultOrigin).origin));
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.document = null;
    this.schemes = {};
    this.operations = [];
  }

  import(source) {
    const value = normalize(source);
    this.document = value.document;
    this.schemes = value.schemes;
    this.operations = value.operations;
    return { title: this.document.info.title, version: this.document.info.version, openapi: this.document.openapi, operationCount: this.operations.length, operations: this.listOperations(), externalReferences: false, importedAt: this.clock() };
  }

  listOperations() {
    return this.operations.map(({ operationId, method, path, summary }) => ({ operationId, method, path, summary }));
  }

  operation(operationId) {
    const value = this.operations.find((item) => item.operationId === operationId);
    invariant(value, "openapi_operation_unknown", `Unknown API operation ${operationId}. Import a reviewed specification first.`);
    return value;
  }

  preview({ operationId, baseURL, path = {}, query = {}, headers = {}, body, credentialReferences = {} }) {
    invariant(this.document, "openapi_spec_not_imported", "Import and validate an OpenAPI document first.");
    const operation = this.operation(operationId);
    const target = normalizedURL(baseURL || this.document.servers?.[0]?.url || "/", this.defaultOrigin);
    let resolvedPath = operation.path;
    for (const item of operation.parameters.filter((entry) => entry.in === "path")) {
      const value = parameterValue(path, item, operation.operationId);
      if (value !== undefined) resolvedPath = resolvedPath.replaceAll(`{${item.name}}`, encodeURIComponent(String(value)));
    }
    invariant(!/\{[^}]+\}/u.test(resolvedPath), "openapi_path_parameter_required", `${operation.operationId} has unresolved path parameters.`);
    target.pathname = `${target.pathname.replace(/\/$/u, "")}${resolvedPath}`.replace(/\/{2,}/gu, "/");
    target.search = "";
    target.hash = "";
    for (const item of operation.parameters.filter((entry) => entry.in === "query")) appendQuery(target.searchParams, item.name, parameterValue(query, item, operation.operationId));

    const reviewedHeaders = {};
    const allowedHeaders = new Set(operation.parameters.filter((entry) => entry.in === "header").map((entry) => entry.name.toLowerCase()));
    for (const item of operation.parameters.filter((entry) => entry.in === "header")) {
      const value = parameterValue(headers, item, operation.operationId);
      if (value !== undefined && value !== null && value !== "") {
        invariant(!SENSITIVE_HEADER.test(item.name), "inline_credential_rejected", `${item.name} must use a credential reference.`);
        reviewedHeaders[item.name] = String(value);
      }
    }
    for (const name of Object.keys(headers)) invariant(allowedHeaders.has(name.toLowerCase()), "openapi_header_not_declared", `Header ${name} is not declared by ${operation.operationId}.`);

    const selectedSecurity = selectSecurity(operation, this.schemes, credentialReferences);
    let serializedBody;
    if (operation.requestBody) {
      if (operation.requestBody.required) invariant(body !== undefined, "openapi_request_body_required", `${operation.operationId} requires a JSON request body.`);
      if (body !== undefined) { serializedBody = JSON.stringify(body); reviewedHeaders["content-type"] = "application/json"; }
    } else invariant(body === undefined, "openapi_request_body_undeclared", `${operation.operationId} does not declare a request body.`);
    reviewedHeaders.accept = "application/json";

    return {
      kind: "ynx.api-studio.request-preview.v1",
      operationId: operation.operationId,
      method: operation.method,
      url: target.toString(),
      headers: reviewedHeaders,
      body: serializedBody,
      credentialReferences: selectedSecurity.map(({ scheme, reference, definition, scopes }) => ({ scheme, reference, type: definition.type, location: definition.in ?? "authorization", scopes })),
      source: { title: this.document.info.title, version: this.document.info.version, openapi: this.document.openapi },
      createdAt: this.clock(),
      approvalRequired: true,
    };
  }

  async execute(preview, { approved = false } = {}) {
    invariant(preview?.kind === "ynx.api-studio.request-preview.v1", "api_preview_required", "A reviewed API request preview is required.");
    invariant(approved === true, "api_sandbox_approval_required", "Sandbox requests require explicit approval after preview.");
    const target = normalizedURL(preview.url, this.defaultOrigin);
    invariant(this.allowedOrigins.has(target.origin), "api_origin_not_allowed", `Sandbox origin ${target.origin} is not in the reviewed allowlist.`);

    let response;
    if ((preview.credentialReferences ?? []).length) {
      invariant(this.credentialBroker && typeof this.credentialBroker.send === "function", "credential_broker_unavailable", "A host credential broker must send secured requests; browser JavaScript never resolves credential values.");
      response = await this.credentialBroker.send({ request: clone(preview), allowedOrigin: target.origin, timeoutMs: this.timeoutMs });
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try { response = await this.fetcher(target.toString(), { method: preview.method, headers: preview.headers, body: preview.body, signal: controller.signal, credentials: "omit", redirect: "error" }); }
      catch (error) {
        if (controller.signal.aborted) throw new DeveloperError("api_sandbox_timeout", `Sandbox request exceeded ${this.timeoutMs} ms.`);
        throw new DeveloperError("api_sandbox_network_failed", "Sandbox request failed before a response was received.", { cause: error instanceof Error ? error.message : String(error) });
      } finally { clearTimeout(timer); }
    }
    invariant(response instanceof Response, "api_sandbox_response_invalid", "Sandbox transport did not return a Response.");
    const text = await boundedText(response, this.maxResponseBytes);
    let responseBody = text;
    if ((response.headers.get("content-type") ?? "").includes("application/json") && text) {
      try { responseBody = JSON.parse(text); } catch { /* keep malformed provider JSON inspectable */ }
    }
    return {
      kind: "ynx.api-studio.response-inspector.v1",
      request: { operationId: preview.operationId, method: preview.method, url: preview.url, headers: inspectHeaders(new Headers(preview.headers)), body: preview.body },
      response: { status: response.status, statusText: response.statusText, ok: response.ok, headers: inspectHeaders(response.headers), body: responseBody },
      receivedAt: this.clock(),
      credentialValuesPersisted: false,
    };
  }

  simulate(preview, scenario) {
    invariant(preview?.kind === "ynx.api-studio.request-preview.v1", "api_preview_required", "A reviewed API request preview is required.");
    const cases = {
      "rate-limit": { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "60", "x-ynx-simulation": "rate-limit" }, body: { code: "provider_rate_limited", retryAfterSeconds: 60 } },
      timeout: { status: 0, statusText: "Timeout", headers: { "x-ynx-simulation": "timeout" }, body: { code: "provider_timeout", retryable: true } },
      "server-error": { status: 503, statusText: "Service Unavailable", headers: { "retry-after": "15", "x-ynx-simulation": "server-error" }, body: { code: "provider_unavailable", retryable: true } },
      "network-error": { status: 0, statusText: "Network Error", headers: { "x-ynx-simulation": "network-error" }, body: { code: "provider_network_failed", retryable: true } },
    };
    invariant(cases[scenario], "api_simulation_unknown", `Unknown API simulation ${scenario}.`);
    const value = cases[scenario];
    return { kind: "ynx.api-studio.response-inspector.v1", simulated: true, request: { operationId: preview.operationId, method: preview.method, url: preview.url, headers: inspectHeaders(new Headers(preview.headers)), body: preview.body }, response: { ...clone(value), ok: value.status >= 200 && value.status < 300 }, receivedAt: this.clock(), credentialValuesPersisted: false };
  }

  generateTypeScriptClient({ className = "YNXGeneratedAPIClient" } = {}) {
    invariant(this.document, "openapi_spec_not_imported", "Import and validate an OpenAPI document first.");
    const methods = this.operations.map((operation) => `  async ${safeIdentifier(operation.operationId)}(input: APIRequestInput = {}): Promise<unknown> {\n    return this.transport.request(${JSON.stringify(operation.operationId)}, input);\n  }`).join("\n\n");
    return `// Generated by YNX API Studio from ${this.document.info.title} ${this.document.info.version}.\n// Credential values remain in the approved host broker.\nexport type APIRequestInput = {\n  baseURL?: string;\n  path?: Record<string, string | number>;\n  query?: Record<string, unknown>;\n  headers?: Record<string, string>;\n  body?: unknown;\n  credentialReferences?: Record<string, string>;\n};\n\nexport interface ReviewedAPITransport {\n  request(operationId: string, input: APIRequestInput): Promise<unknown>;\n}\n\nexport class ${safeIdentifier(className)} {\n  constructor(private readonly transport: ReviewedAPITransport) {}\n\n${methods}\n}\n`;
  }

  generateAdapterManifest({ connector = "custom" } = {}) {
    invariant(this.document, "openapi_spec_not_imported", "Import and validate an OpenAPI document first.");
    return {
      schemaVersion: "1.0.0",
      connector,
      owner: CONNECTORS[connector]?.owner ?? this.document["x-ynx-owner"] ?? "unassigned-review-required",
      source: { title: this.document.info.title, version: this.document.info.version, openapi: this.document.openapi },
      sourceClass: this.document["x-ynx-source-class"] ?? "user-imported-reviewed-openapi",
      affiliationClaim: false,
      credentialMode: "reference-only-host-broker",
      networkMode: "explicit-preview-approval-origin-allowlist",
      operations: this.listOperations(),
      failureSemantics: ["provider_rate_limited", "provider_timeout", "provider_unavailable", "provider_network_failed"],
      releaseStatus: "implementedLocal",
      generatedAt: this.clock(),
    };
  }
}
