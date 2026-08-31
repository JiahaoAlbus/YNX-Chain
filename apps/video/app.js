import {connectVideoWallet, WALLET_INSTALLATION_OPTIONS, discoverWalletCandidates, walletChoiceNeedsResolution, walletCandidatesFromError} from "./wallet-connection.js";
import {ready as i18nReady, t} from "./i18n.js";
import {YNX_TESTNET} from "./ynx-dapp-connect-sdk/constants.js";

const publicAPI = `${location.origin}/video/api`, localAPI = "http://127.0.0.1:8423";
const API = localStorage.getItem("ynx.video.api") || ((location.hostname === "127.0.0.1" || location.hostname === "localhost") ? localAPI : publicAPI);
const $ = selector => document.querySelector(selector);
const savedWalletStateKey = "ynx.video.walletState";

let currentWallet = null;
let currentVideo = null;
let lastWatchPosition = 0;
let unsubscribeEvents = [];

const storageState = {
  read() {
    try { return JSON.parse(sessionStorage.getItem(savedWalletStateKey) || "null"); } catch { return null; }
  },
  write(state) {
    if (!state) return sessionStorage.removeItem(savedWalletStateKey);
    sessionStorage.setItem(savedWalletStateKey, JSON.stringify(state));
  },
  clear() {
    sessionStorage.removeItem(savedWalletStateKey);
  },
};

function maskAccount(account) {
  return `${account?.slice(0, 6)}…${account?.slice(-4)}`;
}

function clearLegacySession() {
  sessionStorage.removeItem("ynx.video.session");
  if (new URLSearchParams(location.hash.slice(1)).has("gateway_session")) history.replaceState(null, "", location.pathname + location.search);
}

function showInstallOptions(show) {
  const box = $("#wallet-install");
  const ynx = `<a href="${WALLET_INSTALLATION_OPTIONS.ynxWallet}">Download YNX Wallet</a>`;
  const meta = `<a href="${WALLET_INSTALLATION_OPTIONS.metaMask}">Download MetaMask</a>`;
  box.hidden = !show;
  box.innerHTML = show ? `<span>No compatible Wallet detected.</span><br/>${ynx} · ${meta}` : "";
}

function getWalletName(state) {
  return state?.walletLabel || state?.walletName || state?.walletBrand || "Standard Wallet";
}

function setConnectionMessage(message) {
  $("#session").textContent = message;
}

function resetWallet(message = "Wallet disconnected. Guest playback remains available.") {
  currentWallet = null;
  setConnectionMessage(message + " Private actions remain unavailable until Product Session v2 is accepted.");
  $("#signin").textContent = "Connect Wallet";
  $("#revoke").hidden = true;
  $("#wallet-status").classList.remove("wallet-connected");
  for (const unsub of unsubscribeEvents) {
    try { unsub?.(); } catch {}
  }
  unsubscribeEvents = [];
  storageState.clear();
}

function renderWalletState(state) {
  $("#signin").textContent = `${getWalletName(state)} · ${maskAccount(state.account)}`;
  $("#wallet-status").classList.add("wallet-connected");
  $("#revoke").hidden = false;
  setConnectionMessage(`Connected to ${getWalletName(state)} on YNX Testnet (${state.chainId}). ` +
    "Public actions are available; private actions still require Product Session v2.");
  $("#wallet-install").hidden = true;
  storageState.write({
    walletId: state.walletId,
    account: state.account,
    chainId: state.chainId,
    walletName: getWalletName(state),
    walletKind: state.walletKind,
    providerKey: state.providerKey,
  });
}

function bindWalletEvents(walletState) {
  const provider = walletState.connection?.provider || walletState.provider;
  if (!provider || typeof provider.on !== "function") return;

  const onAccountsChanged = (accounts) => {
    const account = Array.isArray(accounts) ? accounts[0] || null : null;
    if (!account) {
      setConnectionMessage("Wallet account was revoked. Reconnect to continue.");
      revokeWallet("accountsChanged-empty");
      return;
    }
    currentWallet = {...currentWallet, account};
    renderWalletState(currentWallet);
    setConnectionMessage(`Account changed. Reconnected as ${maskAccount(account)}.`);
  };

  const onChainChanged = (chainId) => {
    if (String(chainId).toLowerCase() !== YNX_TESTNET.evmChainHex) {
      setConnectionMessage(`Wallet chain changed away from ${YNX_TESTNET.evmChainHex}; reconnect or switch back in your Wallet to continue.`);
      return;
    }
    currentWallet = {...currentWallet, chainId: String(chainId).toLowerCase()};
    renderWalletState(currentWallet);
    setConnectionMessage(`Wallet switched back to ${currentWallet.chainId}.`);
  };

  const onDisconnect = () => {
    setConnectionMessage("Provider disconnected. Reconnect to continue.");
    revokeWallet("provider-disconnect");
  };

  unsubscribeEvents.push(() => provider.removeListener?.("accountsChanged", onAccountsChanged));
  unsubscribeEvents.push(() => provider.removeListener?.("chainChanged", onChainChanged));
  unsubscribeEvents.push(() => provider.removeListener?.("disconnect", onDisconnect));
  provider.on("accountsChanged", onAccountsChanged);
  provider.on("chainChanged", onChainChanged);
  provider.on("disconnect", onDisconnect);
}

export async function api(path, options = {}) {
  const headers = {...(options.headers || {})};
  const method = (options.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers["Idempotency-Key"] ||= crypto.randomUUID();
  }
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(API + path, {...options, headers});
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  const data = await response.json().catch(() => ({error: "Invalid service response"}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const json = body => ({method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});

function notice(message, bad = false) {
  const node = $("#notice");
  node.textContent = message;
  node.style.color = bad ? "#8b1e2d" : "#344054";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function empty(title, detail = "No placeholder records are shown.", retry = false) {
  $("#content").innerHTML = `<div class="empty"><h2>${esc(title)}</h2><p>${esc(detail)}</p>${retry ? `<button id="retry-load">${esc(t("retry"))}</button>` : ""}</div>`;
  $("#retry-load")?.addEventListener("click", () => loadVideos($("#query").value));
}

function activate(button) {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x === button));
}

function videoCard(video) {
  const article = document.createElement("article");
  article.className = "card";
  const thumb = video.thumbnail_key ? `<img class="thumb image" src="${API}/media/${encodeURI(video.thumbnail_key)}" alt="">` : "";
  const state = video.takedown?.state ? `Takedown: ${video.takedown.state}` : `${video.status} · ${video.visibility}`;
  article.innerHTML = `<button class="card-open" aria-label="Play ${esc(video.title)}">${thumb}</button><h2>${esc(video.title)}</h2><p class="meta">${esc(state)}</p><p>${esc(video.description || "No description")}</p>`;
  article.querySelector("button").onclick = () => openVideo(video);
  return article;
}

function renderVideos(videos, title) {
  const box = $("#content");
  box.replaceChildren();
  if (!videos.length) {
    empty(title);
    return;
  }
  box.append(...videos.map(videoCard));
}

async function loadVideos(query = "") {
  $("#content").setAttribute("aria-busy", "true");
  try {
    const videos = await api(`/v1/videos?q=${encodeURIComponent(query)}`);
    renderVideos(videos, query ? "No matching published videos" : t("empty"));
    notice("");
  } catch (error) {
    empty(t("unavailable"), navigator.onLine ? t("unavailable") : t("offline"), true);
    notice(error.message, true);
  } finally {
    $("#content").setAttribute("aria-busy", "false");
  }
}

function renderWalletChoices(candidates) {
  const chooser = $("#wallet-chooser");
  $("#wallet-choices").replaceChildren();

  for (const candidate of candidates) {
    const walletId = candidate.info?.uuid || candidate.uuid || candidate.providerId || "";
    if (!walletId) continue;
    const item = document.createElement("button");
    item.className = "wallet-choice";
    item.type = "button";
    item.dataset.walletId = walletId;
    item.dataset.walletBrand = candidate.isYNXWallet ? "YNX Wallet" : candidate.isMetaMask ? "MetaMask" : "EIP-1193";
    item.dataset.walletRdns = candidate.info?.rdns || "";
    const icon = candidate.providerInfo?.icon || candidate.icon || candidate.info?.icon || "";
    const iconMarkup = icon ? `<img src="${icon}" alt="${esc(candidate.label)}" />` : "";
    const label = candidate.label || candidate.name || "Wallet";
    const role = candidate.isYNXWallet ? "ynx" : candidate.isMetaMask ? "metamask" : "eip1193";
    const extra = candidate.isYNXWallet ? " · YNX Wallet" : candidate.isMetaMask ? " · MetaMask" : "";
    item.setAttribute("title", `${esc(candidate.label || label)} · ${item.dataset.walletBrand}`);
    item.innerHTML = `<span class="wallet-choice-logo ${role}" aria-hidden="true">${iconMarkup}</span><span>${esc(label + extra)}</span>`;
    item.onclick = async () => {
      chooser.close();
      await connectVideoWalletInteractive(walletId);
    };
    $("#wallet-choices").append(item);
  }
  $("#wallet-chooser-close").onclick = () => chooser.close();
  chooser.showModal();
}

function walletChoiceOptions(error, autoCandidates = []) {
  const candidates = autoCandidates.length ? autoCandidates : walletCandidatesFromError(error);
  const sorted = [...candidates].sort((a,b)=>{
    const aName = String(a.label || a.name || a.walletName || a.info?.name || "");
    const bName = String(b.label || b.name || b.walletName || b.info?.name || "");
    return aName.localeCompare(bName);
  });
  renderWalletChoices(sorted);
}

async function connectVideoWalletInteractive(walletId = null) {
  try {
    $("#signin").disabled = true;
    showInstallOptions(false);
    const result = await connectVideoWallet(window, {timeoutMs: 1500, walletId});
    currentWallet = {...result, walletKind: result.walletBrand, providerKey: result.providerInfo?.uuid};
    renderWalletState(currentWallet);
    bindWalletEvents(currentWallet);
    notice("Wallet connection succeeded. Guest playback remains available; no private Product Session was fabricated.");
  } catch (error) {
    if (walletChoiceNeedsResolution(error)) {
      walletChoiceOptions(error);
      setConnectionMessage("Select YNX Wallet or MetaMask before continuing.");
      return;
    }
    if (error?.code === "WALLET_NOT_INSTALLED") {
      showInstallOptions(true);
    }
    resetWallet(error?.code === "WALLET_USER_REJECTED" ? "Wallet approval was rejected." : error.message || "Wallet connection failed.");
    notice(error.message || "Wallet connection failed", true);
  } finally {
    $("#signin").disabled = false;
  }
}

async function restoreWalletFromSession() {
  const state = storageState.read();
  if (!state?.walletId || !state?.account) return;
  const candidates = await discoverWalletCandidates(window, {timeoutMs: 1500});
  const selected = candidates.find(candidate => candidate.info.uuid === state.walletId || candidate.label === state.walletName || candidate.info.rdns === state.providerKey);
  if (!selected) return;
  const provider = selected.provider;
  const request = provider.request;
  if (typeof request !== "function") return;
  try {
    const accounts = await request({method: "eth_accounts"});
    const chainId = await request({method: "eth_chainId"});
    if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== state.account.toLowerCase()) return;
    if (String(chainId).toLowerCase() !== YNX_TESTNET.evmChainHex) return;
    currentWallet = {
      account: accounts[0],
      chainId: String(chainId).toLowerCase(),
      walletId: selected.info.uuid,
      walletName: state.walletName || selected.label,
      walletLabel: state.walletName || selected.label,
      walletBrand: selected.isYNXWallet ? "YNX Wallet" : selected.isMetaMask ? "MetaMask" : selected.label,
      walletKind: selected.isYNXWallet ? "ynx" : selected.isMetaMask ? "metamask" : "eip1193",
      providerKey: selected.info.uuid,
      provider,
      connection: {provider},
    };
    renderWalletState(currentWallet);
    bindWalletEvents(currentWallet);
    notice("Wallet connection restored from last session.");
  } catch {
    resetWallet("Refresh found no approved session. Choose a provider to continue.");
  }
}

async function revokeWallet(reason = "user") {
  const state = storageState.read();
  if (!state?.account || !currentWallet) return;
  try {
    await api("/v1/wallet/revoke", json({reason, account: state.account}));
  } catch {}
  resetWallet(`Wallet ${reason.replace(/-/g, " ")} was revoked.`);
}

async function openVideo(video) {
  currentVideo = video;
  lastWatchPosition = 0;
  $("#player-title").textContent = video.title;
  $("#player-state").textContent = video.takedown ? `Unavailable: ${video.takedown.reason}` : `${video.captions?.length || 0} caption track(s) · ${video.status}`;

  const media = $("#video");
  media.replaceChildren();
  const hls = video.variants?.find(v => v.mime === "application/vnd.apple.mpegurl");
  const fallback = video.variants?.find(v => v.name === "original-fallback");
  const chosen = hls && media.canPlayType(hls.mime) ? hls : fallback || hls;
  if (chosen) media.src = `${API}/media/${chosen.object_key}`;
  else media.removeAttribute("src");

  for (const caption of video.captions || []) {
    if (!caption.human_approved) continue;
    const track = document.createElement("track");
    track.kind = "captions";
    track.label = caption.label;
    track.srclang = caption.language;
    track.src = `${API}/media/${caption.object_key}`;
    media.append(track);
  }
  await loadComments();
  $("#player").showModal();
}

async function loadComments() {
  if (!currentVideo) return;
  try {
    const comments = await api(`/v1/videos/${currentVideo.id}/comments`);
    $("#comments").innerHTML = comments.length ? comments.map(c => `<article><b>${esc(c.Author || c.author)}</b><p>${esc(c.Body || c.body)}</p></article>`).join("") : '<p class="meta">No comments yet.</p>';
  } catch (error) {
    $("#comments").textContent = error.message;
  }
}

async function flushWatch(completed = false) {
  if (!currentVideo || !currentWallet) return;
  const position = Math.floor($("#video").currentTime || 0);
  const seconds = Math.max(0, position - lastWatchPosition);
  if (seconds < 1) return;
  lastWatchPosition = position;
  try {
    await api(`/v1/videos/${currentVideo.id}/watch`, json({seconds, completed}));
  } catch (error) {
    notice(`Watch history not saved: ${error.message}`, true);
  }
}

async function showSubscriptions(button) {
  activate(button);
  try {
    const channels = await api("/v1/subscriptions");
    const box = $("#content");
    box.replaceChildren();
    if (!channels.length) {
      empty("Subscriptions are empty");
      return;
    }
    for (const channel of channels) {
      const article = document.createElement("article");
      article.className = "card";
      article.innerHTML = `<div class="thumb thumb-fallback">Channel</div><h2>${esc(channel.Name || channel.name)}</h2><p class="meta">@${esc(channel.Handle || channel.handle)}</p><button>Open channel</button>`;
      article.querySelector("button").onclick = () => showChannel(channel.ID || channel.id);
      box.append(article);
    }
  } catch (error) {
    notice(error.message, true);
  }
}

async function showChannel(channelID) {
  try {
    const view = await api(`/v1/channels/${channelID}`);
    const channel = view.channel;
    renderVideos(view.videos || [], `@${channel.Handle || channel.handle} has no published videos`);
    notice(`${channel.Name || channel.name} · ${view.subscribers} persisted subscriber(s)`);
    $("#player")?.open && $("#player").close();
  } catch (error) {
    notice(error.message, true);
  }
}

async function showPlaylists(button) {
  activate(button);
  try {
    const lists = await api("/v1/playlists");
    const box = $("#content");
    box.replaceChildren();
    if (!lists.length) {
      empty("Playlists are empty");
      return;
    }
    for (const list of lists) {
      const ids = list.VideoIDs || list.video_ids || [];
      const article = document.createElement("article");
      article.className = "card";
      article.innerHTML = `<div class="thumb thumb-fallback">Playlist</div><h2>${esc(list.Name || list.name)}</h2><p class="meta">${ids.length} saved video(s)</p>`;
      box.append(article);
    }
  } catch (error) {
    notice(error.message, true);
  }
}

async function showHistory(button) {
  activate(button);
  try {
    const events = await api("/v1/history");
    const box = $("#content");
    box.replaceChildren();
    if (!events.length) {
      empty("History is empty");
      return;
    }
    for (const event of events) {
      const article = document.createElement("article");
      article.className = "card";
      article.innerHTML = `<h2>${esc(event.VideoID || event.video_id)}</h2><p>${event.Seconds || event.seconds} watched second(s)</p><p class="meta">${esc(event.CreatedAt || event.created_at)}</p>`;
      box.append(article);
    }
  } catch (error) {
    notice(error.message, true);
  }
}

$("#signin").onclick = async () => {
  try {
    const candidates = await discoverWalletCandidates(window, {timeoutMs: 250});
    const ynxCount = candidates.filter(c => c.isYNXWallet).length;
    const mmCount = candidates.filter(c => c.isMetaMask).length;
    if ((ynxCount >= 1 && mmCount >= 1) || candidates.length > 1) {
      const choices = candidates.map(entry => ({
        info: entry.info,
        label: entry.label,
        isYNXWallet: entry.isYNXWallet,
        isMetaMask: entry.isMetaMask,
        icon: entry.icon,
      }));
      walletChoiceOptions(null, choices);
      return;
    }
    await connectVideoWalletInteractive();
  } catch (error) {
    if (error?.code === "WALLET_NOT_INSTALLED") showInstallOptions(true);
    resetWallet(error.message || "No provider discovered.");
  }
};

$("#revoke").onclick = () => revokeWallet("user-requested");
$("#search").onsubmit = event => { event.preventDefault(); loadVideos($("#query").value); };
$("#close").onclick = async () => { await flushWatch(false); $("#video").pause(); $("#player").close(); };
$("#video").addEventListener("pause", () => flushWatch(false));
$("#video").addEventListener("ended", () => flushWatch(true));
$("#channel").onclick = () => currentVideo && showChannel(currentVideo.channel_id);
$("#subscribe").onclick = async () => {
  try {
    await api(`/v1/channels/${currentVideo.channel_id}/subscription`, {method: "POST"});
    notice("Subscription state persisted.");
  } catch (error) {
    notice(error.message, true);
  }
};

$("#playlist").onclick = async () => {
  if (!currentVideo) return;
  try {
    const lists = await api("/v1/playlists");
    let selected;
    if (!lists.length) {
      const name = prompt("Create a playlist");
      if (!name) return;
      selected = await api("/v1/playlists", json({name}));
    } else {
      const choice = prompt(lists.map((p, i) => `${i + 1}. ${p.Name || p.name}`).join("\n"), "1");
      if (!choice) return;
      selected = lists[Number(choice) - 1];
    }
    const playlistId = selected.ID || selected.id;
    if (!playlistId) throw new Error("Invalid playlist selection");
    await api(`/v1/playlists/${playlistId}/videos`, json({video_id: currentVideo.id}));
    notice("Video added to the persisted playlist.");
  } catch (error) {
    notice(error.message, true);
  }
};

$("#report").onclick = async () => {
  const reason = prompt("Reason for human review");
  if (!reason) return;
  try {
    await api(`/v1/videos/${currentVideo.id}/reports`, json({reason, details: "Submitted from YNX Video viewer"}));
    notice("Report submitted for human review. No automatic takedown occurred.");
  } catch (error) {
    notice(error.message, true);
  }
};

$("#comment").onsubmit = async event => {
  event.preventDefault();
  try {
    await api(`/v1/videos/${currentVideo.id}/comments`, json({body: event.target.elements[0].value}));
    event.target.reset();
    await loadComments();
    notice("Comment persisted.");
  } catch (error) {
    notice(error.message, true);
  }
};

const nav = [...document.querySelectorAll("nav button")];
nav.find(b => b.dataset.view === "discover").onclick = event => { activate(event.currentTarget); loadVideos(); };
nav.find(b => b.dataset.view === "subscriptions").onclick = event => showSubscriptions(event.currentTarget);
nav.find(b => b.dataset.view === "playlists").onclick = event => showPlaylists(event.currentTarget);
nav.find(b => b.dataset.view === "history").onclick = event => showHistory(event.currentTarget);

$("#privacy").onclick = async () => {
  if (!confirm("Delete your persisted watch history, subscriptions, playlists, and comment text? Minimal deletion audit evidence remains.")) return;
  try {
    const result = await api("/v1/privacy/account-data", {method: "DELETE"});
    notice(`Viewer data deleted: ${Object.entries(result).map(([key, value]) => `${key} ${value}`).join(", ")}`);
    loadVideos();
  } catch (error) {
    notice(error.message, true);
  }
};

clearLegacySession();
await i18nReady.catch(() => null);
await restoreWalletFromSession();
if (!currentWallet) {
  resetWallet("Wallet not connected. Guest playback is available.");
}

const linkedVideo = new URLSearchParams(location.search).get("video");
if (linkedVideo) {
  api(`/v1/videos/${encodeURIComponent(linkedVideo)}`).then(openVideo).catch(error => {notice(error.message, true); loadVideos();});
} else {
  loadVideos();
}
