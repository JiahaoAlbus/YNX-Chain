const GATEWAY_URL = "https://api.ynxweb4.com";

export type SquarePost = {
  id: string;
  author: string;
  content: string;
  tags?: string[];
  commentCount: number;
  reactionCount: number;
  createdAt: string;
};

export type GatewayHealth = {
  ok: boolean;
  service: string;
  activeSessions: number;
  truthfulStatus: string;
  remoteDeployed: boolean;
  build?: { release?: string };
};

export async function fetchSquareFeed(signal?: AbortSignal): Promise<SquarePost[]> {
  const value = await requestJSON(`${GATEWAY_URL}/app/square/feed?limit=30`, signal);
  if (!isPlainObject(value) || !Array.isArray(value.posts)) throw new Error("Square feed returned an invalid payload");
  return value.posts.map(parsePost);
}

export async function fetchGatewayHealth(signal?: AbortSignal): Promise<GatewayHealth> {
  const value = await requestJSON(`${GATEWAY_URL}/app/health`, signal);
  if (!isPlainObject(value) || typeof value.ok !== "boolean" || typeof value.service !== "string" || typeof value.activeSessions !== "number" || typeof value.truthfulStatus !== "string" || typeof value.remoteDeployed !== "boolean") {
    throw new Error("Gateway health returned an invalid payload");
  }
  return value as GatewayHealth;
}

async function requestJSON(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 8000);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`YNX endpoint returned invalid JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(isPlainObject(value) && typeof value.error === "string" ? value.error : `YNX endpoint failed (${response.status})`);
  return value;
}

function parsePost(value: unknown): SquarePost {
  if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.author !== "string" || typeof value.content !== "string" || typeof value.commentCount !== "number" || typeof value.reactionCount !== "number" || typeof value.createdAt !== "string") {
    throw new Error("Square post returned an invalid payload");
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string"))) throw new Error("Square post tags are invalid");
  return value as SquarePost;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
