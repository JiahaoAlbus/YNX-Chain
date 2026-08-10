import { assertPublicOutboundUrl } from "./network.js";

function stripHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function titleOf(html, url) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/<[^>]+>/g, " ").trim() || new URL(url).hostname;
}

export function robotsAllows(text, path, userAgent = "YNXSearchBot") {
  let relevant = false;
  let allowed = true;
  let best = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (field.toLowerCase() === "user-agent") {
      relevant = value === "*" || value.toLowerCase() === userAgent.toLowerCase();
      continue;
    }
    if (!relevant) continue;
    if (["allow", "disallow"].includes(field.toLowerCase()) && path.startsWith(value) && value.length >= best) {
      best = value.length;
      allowed = field.toLowerCase() === "allow";
    }
  }
  return allowed;
}

function nextEligibleAt(now, source) {
  return new Date(now.getTime() + source.crawlPolicy.backoffSeconds * 1000).toISOString();
}

async function failSource(store, source, now, error) {
  await store.setSourceStatus(source.id, "failed", {
    lastError: error.name === "TimeoutError" ? "source request timeout" : error.message,
    nextEligibleAt: nextEligibleAt(now, source),
  });
}

export async function indexRegisteredSource(
  store,
  source,
  { fetchImpl = fetch, userAgent = "YNXSearchBot/0.2", resolveHost, allowLocal = false, clock = () => new Date() } = {},
) {
  const now = clock();
  if (source.nextEligibleAt && Date.parse(source.nextEligibleAt) > now.getTime()) {
    return store.setSourceStatus(source.id, "backoff", { lastError: "source crawl backoff is active" });
  }

  try {
    const sourceUrl = await assertPublicOutboundUrl(source.url, { allowLocal, resolveHost });
    await store.setSourceStatus(source.id, "checking-robots", { lastAttemptAt: now.toISOString(), lastError: null });

    if (source.robots.policy === "respect") {
      const robotsUrl = new URL("/robots.txt", sourceUrl);
      await assertPublicOutboundUrl(robotsUrl, { allowLocal, resolveHost });
      const robotsResponse = await fetchImpl(robotsUrl, {
        headers: { "user-agent": userAgent },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (robotsResponse.ok && !robotsAllows(await robotsResponse.text(), sourceUrl.pathname)) {
        return store.setSourceStatus(source.id, "blocked-by-robots", {
          lastError: "robots.txt disallows this path",
          nextEligibleAt: null,
        });
      }
    }

    await store.setSourceStatus(source.id, "indexing");
    const response = await fetchImpl(source.url, {
      headers: { "user-agent": userAgent, accept: "text/html,text/plain;q=0.9" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);

    const responseUrl = await assertPublicOutboundUrl(response.url || source.url, { allowLocal, resolveHost });
    if (responseUrl.origin !== source.origin) throw new Error("source response escaped registered origin");

    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    if (!["text/html", "text/plain", "application/json"].includes(contentType)) throw new Error(`unsupported content type ${contentType}`);
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("source response exceeds 2 MB");
    const text = contentType === "text/html" ? stripHtml(body) : body;
    const document = await store.indexDocument(source.id, {
      url: responseUrl.href,
      title: contentType === "text/html" ? titleOf(body, source.url) : source.label,
      text,
      dataClass: source.dataPolicy.defaultClass,
      contentType,
      fetchedAt: now.toISOString(),
    });
    await store.setSourceStatus(source.id, "ready", {
      nextEligibleAt: new Date(now.getTime() + source.crawlPolicy.freshnessSloSeconds * 1000).toISOString(),
    });
    return document;
  } catch (error) {
    await failSource(store, source, now, error);
    throw error;
  }
}
