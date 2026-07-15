import { DeveloperError, invariant } from "./errors.js";

function estimate(files, prompt) {
  const chars = files.reduce((sum, file) => sum + file.content.length, 0) + prompt.length;
  return { estimatedInputTokens: Math.ceil(chars / 4), estimatedYNXT: null, note: "Token estimate is local; monetary/resource cost is unavailable until the provider reports usage." };
}

export class AICodingAgent {
  constructor({ gatewayURL = "http://127.0.0.1:6429", fetcher = fetch, clock = Date.now } = {}) { this.gatewayURL = gatewayURL.replace(/\/$/, ""); this.fetcher = fetcher; this.clock = clock; this.controller = null; this.audit = []; }
  async status() {
    const response = await this.fetcher(`${this.gatewayURL}/health`);
    const value = await response.json().catch(() => ({}));
    return { available: response.ok && value.ok === true && value.providerConfigured === true, providerConfigured: value.providerConfigured === true, model: value.model || "unavailable", active: value.active ?? 0, error: response.ok ? value.error : `HTTP ${response.status}`, truthfulStatus: value.truthfulStatus || "unavailable" };
  }
  prepare({ intent, project, approvedPaths }) {
    intent = String(intent ?? "").trim();
    invariant(intent.length >= 4 && intent.length <= 4000, "invalid_ai_intent", "AI request must be 4-4000 characters.");
    invariant(Array.isArray(approvedPaths) && approvedPaths.length > 0, "context_approval_required", "Select and approve project files before sending context to AI.");
    const files = approvedPaths.map((path) => { invariant(path in project.files, "file_not_found", `Approved file is missing: ${path}`); return { path, content: project.files[path] }; });
    const prompt = ["You are the YNX Developer coding agent. Use only the approved files below. Cite sources as path:line. Propose a unified diff and tests; do not claim commands ran.", `Intent: ${intent}`, ...files.map((file) => `\n--- ${file.path}\n${file.content}`)].join("\n");
    invariant(prompt.length <= 7800, "ai_context_too_large", "Approved AI context exceeds the YNX AI Gateway 8,000-character request limit. Select fewer files or a smaller source excerpt.");
    return { intent, files, privacyPreview: files.map(({ path, content }) => ({ path, bytes: new TextEncoder().encode(content).byteLength })), estimate: estimate(files, intent), prompt };
  }
  async stream(prepared, { accessToken, sessionId = crypto.randomUUID(), approved = false, onToken = () => {} } = {}) {
    invariant(approved, "ai_permission_required", "AI Gateway request requires explicit context and cost approval.");
    invariant(typeof accessToken === "string" && accessToken.length >= 8, "gateway_token_required", "A session-only YNX AI Gateway access token is required.");
    this.controller = new AbortController();
    const url = `${this.gatewayURL}/ai/stream?session=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(prepared.prompt)}`;
    const at = new Date(this.clock()).toISOString();
    try {
      const response = await this.fetcher(url, { headers: { "X-YNX-AI-Key": accessToken, accept: "text/event-stream" }, signal: this.controller.signal });
      if (!response.ok) throw new DeveloperError("provider_unavailable", `YNX AI Gateway returned HTTP ${response.status}. Retry without applying any patch.`);
      invariant(response.body, "stream_unavailable", "AI Gateway did not return a stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let output = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const event of events) for (const line of event.split("\n")) if (line.startsWith("data: ")) {
          const payload = JSON.parse(line.slice(6)); if (payload.text) { output += payload.text; onToken(payload.text); }
        }
      }
      invariant(output.trim(), "empty_provider_result", "Provider returned no coding result.");
      this.audit.push({ at, event: "ai.result.review-required", sessionId, approvedPaths: prepared.files.map((f) => f.path), outputBytes: output.length });
      return { status: "review-required", output, sessionId };
    } catch (error) {
      const cancelled = this.controller?.signal.aborted;
      this.audit.push({ at, event: cancelled ? "ai.cancelled" : "ai.failed", sessionId, error: error instanceof Error ? error.message : String(error) });
      if (cancelled) throw new DeveloperError("ai_cancelled", "AI request was cancelled; no patch was applied.");
      throw error;
    } finally { this.controller = null; }
  }
  cancel() { invariant(this.controller, "ai_not_streaming", "No AI stream is active."); this.controller.abort(); }
  review(result, decision) {
    invariant(result?.status === "review-required", "invalid_ai_result", "Only provider-backed review results can be accepted or rejected.");
    invariant(decision === "apply" || decision === "reject", "invalid_review", "Choose apply or reject.");
    this.audit.push({ at: new Date(this.clock()).toISOString(), event: `ai.${decision}`, sessionId: result.sessionId });
    return { ...result, status: decision === "apply" ? "approved-for-diff-application" : "rejected" };
  }
}
