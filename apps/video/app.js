import {connectVideoWallet, restoreVideoWallet, WALLET_INSTALLATION_OPTIONS, discoverWalletCandidates, walletChoiceNeedsResolution, walletCandidatesFromError} from "./wallet-connection.js";
import {ready as i18nReady, t} from "./i18n.js";
import {YNX_TESTNET} from "./ynx-dapp-connect-sdk/constants.js";
import {videoProductSession} from "./product-session.js";
import {createVideoAPI} from "./video-api.js";
import {createWatchProgress} from "./watch-progress.js";

const API = `${location.origin}/video/api`;
const $ = selector => document.querySelector(selector);
const savedWalletStateKey = "ynx.video.walletState";

let currentWallet = null;
let currentVideo = null;
let watchProgress = null;
let productState = {status: "guest"};
let productExpiryTimer;
let currentView = "discover";
let currentPlaylist = null;
let playlistTarget = null;
let libraryEpoch = 0;
let unsubscribeEvents = [];

const storageState = {
  read() {
    try { return JSON.parse(sessionStorage.getItem(savedWalletStateKey) || "null"); } catch { return null; }
  },
  write(state) {
    try {
      if (!state) return sessionStorage.removeItem(savedWalletStateKey);
      sessionStorage.setItem(savedWalletStateKey, JSON.stringify(state));
    } catch { /* An unavailable optional EVM cache cannot block playback. */ }
  },
  clear() {
    try {sessionStorage.removeItem(savedWalletStateKey);} catch {}
  },
};

function maskAccount(account) {
  return `${account?.slice(0, 6)}…${account?.slice(-4)}`;
}

function clearLegacySession() {
  try {sessionStorage.removeItem("ynx.video.session");} catch {}
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
  setConnectionMessage(message + " Your Video sign-in is separate.");
  $("#signin").textContent = "Connect EVM wallet";
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
    "This EVM connection does not sign in to your Video account.");
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

// Product Session v2 and the EVM provider are independent authorities.
export const api = createVideoAPI({baseURL: API,
  authorize: (path, method) => videoProductSession.authorization(path, method),
  onUnauthorized: () => renderProductState({status: "retry-required", message: "Your sign-in needs to be checked. Retry or sign in again."}),
});
const privateAPI = (path, options = {}) => api(path, {...options, private: true});

const json = body => ({method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});

function notice(message, bad = false) {
  const node = $("#notice");
  node.textContent = message;
  node.style.color = bad ? "#8b1e2d" : "#344054";
}

function productConnected() {
  return productState.status === "connected" && Date.parse(productState.session?.expiresAt || "") > Date.now();
}

function renderProductState(state) {
  const previousAccount = productState.session?.account;
  productState = state;
  clearTimeout(productExpiryTimer);
  const connected = productConnected();
  $("#product-status").textContent = connected
    ? `Signed in as ${maskAccount(state.session.account)}. Your playlists, subscriptions and history are available.`
    : state.message || "Sign in with YNX Wallet to save playlists, subscriptions and watch history.";
  $("#product-signin").textContent = connected ? "Video account" : "Sign in";
  $("#product-connect").textContent = connected ? "Switch Video account" : "Sign in with YNX Wallet";
  $("#product-disconnect").hidden = !connected && !["network-unavailable", "retry-required"].includes(state.status);
  $("#product-retry").hidden = !["network-unavailable", "retry-required"].includes(state.status);
  $("#product-launch").hidden = true;
  $("#comment button").disabled = !connected;
  $("#comment textarea").disabled = !connected;
  $("#comment-account-hint").hidden = connected;
  if (!connected || previousAccount && previousAccount !== state.session?.account) {
    watchProgress?.discard();
    if (["subscriptions", "playlists", "history", "settings"].includes(currentView)) {
      libraryEpoch++;
      renderAccountRequired();
    }
    if ($("#playlist-picker").open) $("#playlist-picker").close();
  }
  if (connected) productExpiryTimer = setTimeout(() => renderProductState({status: "retry-required", message: "Your sign-in expired. Sign in again to use your library."}), Math.max(0, Date.parse(state.session.expiresAt) - Date.now()));
  if (connected && currentVideo && previousAccount !== state.session.account) startWatchProgress(currentVideo);
  void refreshSubscriptionButton();
}

function focusSignIn() {
  if ($("#player").open) {$("#video").pause(); $("#player").close();}
  if ($("#playlist-picker").open) $("#playlist-picker").close();
  $("#video-account").scrollIntoView({behavior: "smooth", block: "center"});
  $("#product-connect").focus();
}

function requireAccount() {
  if (productConnected()) return true;
  notice("Sign in with YNX Wallet to use this action. You can keep watching as a guest.");
  focusSignIn();
  return false;
}

function renderAccountRequired() {
  $("#content").setAttribute("aria-busy", "false");
  $("#content").innerHTML = '<section class="empty"><h2>Your Video library</h2><p>Sign in with YNX Wallet to see your saved videos and history.</p><button id="library-signin">Go to sign in</button></section>';
  $("#library-signin").onclick = focusSignIn;
}

async function restoreVideoAccount() {
  if (!videoProductSession.atRegisteredOrigin()) {
    renderProductState({status: "guest", message: "Guest playback is available here. Open video.ynxweb4.com to sign in."});
    $("#canonical-signin").hidden = false;
    return;
  }
  $("#product-status").textContent = "Checking your saved sign-in. Guest playback is available.";
  try {
    const state = await videoProductSession.restore();
    renderProductState(state);
    if (productConnected()) void refreshLibraryView();
  } catch {
    renderProductState({status: "retry-required", message: "Video sign-in is unavailable. Retry when your connection is restored; guest playback remains available."});
  }
}

async function prepareVideoSignIn() {
  const button = $("#product-connect");
  button.disabled = true;
  $("#product-launch").hidden = true;
  try {
    if (productConnected()) {
      const disconnected = await videoProductSession.disconnect();
      renderProductState(disconnected);
      if (disconnected.status !== "disconnected") return;
    }
    const request = await videoProductSession.prepare();
    $("#product-launch").href = request.url;
    $("#product-launch").hidden = false;
    $("#product-status").textContent = "Your request is ready. Select Open YNX Wallet, approve the Video request there, and return here. If Wallet does not open, install it or continue as a guest.";
    clearTimeout(productExpiryTimer);
    productExpiryTimer = setTimeout(() => {
      $("#product-launch").hidden = true;
      $("#product-status").textContent = "This sign-in request expired. Select Sign in with YNX Wallet to start again.";
    }, Math.max(0, Date.parse(request.expiresAt) - Date.now()));
  } catch (error) {$("#product-status").textContent = error.message || "Sign-in could not start. Please retry.";}
  finally {button.disabled = false;}
}

async function refreshLibraryView() {
  const button = document.querySelector(`nav button[data-view="${currentView}"]`);
  if (currentView === "subscriptions") return showSubscriptions(button);
  if (currentView === "playlists") return currentPlaylist ? showPlaylist(currentPlaylist) : showPlaylists(button);
  if (currentView === "history") return showHistory(button);
  if (currentView === "settings") return showSettings();
}

function beginLibrary(view, button) {
  currentView = view;
  activate(button);
  $("#page-title").removeAttribute("data-i18n");
  $("#page-title").textContent = ({subscriptions: "Subscriptions", playlists: "Playlists", history: "Watch history", settings: "Settings"})[view];
  const epoch = ++libraryEpoch;
  $("#content").setAttribute("aria-busy", "false");
  if (!productConnected()) {renderAccountRequired(); return null;}
  $("#content").innerHTML = '<p class="meta">Loading your library…</p>';
  notice("");
  return epoch;
}

function libraryFailure(error, epoch, retry) {
  if (epoch !== libraryEpoch) return;
  if (!productConnected()) return renderAccountRequired();
  empty("Your library could not load", "Your saved items remain on the service. Retry when the connection is available.");
  const button = document.createElement("button");
  button.textContent = "Retry";
  button.onclick = retry;
  $("#content .empty").append(button);
  notice(error.message, true);
}

function field(value, lower, upper) {return value?.[lower] ?? value?.[upper];}

async function openSavedVideo(videoId) {
  try {await openVideo(await api(`/v1/videos/${encodeURIComponent(videoId)}`));}
  catch {notice("This saved video is private, unavailable or no longer published.", true);}
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function empty(title, detail = "Published videos will appear here.", retry = false) {
  $("#content").innerHTML = `<div class="empty"><h2>${esc(title)}</h2><p>${esc(detail)}</p>${retry ? `<button id="retry-load">${esc(t("retry"))}</button>` : ""}</div>`;
  $("#retry-load")?.addEventListener("click", () => loadVideos($("#query").value));
}

function activate(button) {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x === button));
}

function videoCard(video) {
  const article = document.createElement("article");
  article.className = "card";
  const thumb = video.thumbnail_key ? `<img class="thumb image" src="${API}/media/${encodeURI(video.thumbnail_key)}" alt="">` : '<span class="thumb thumb-fallback">Play video</span>';
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
  const epoch = ++libraryEpoch;
  currentView = "discover";
  currentPlaylist = null;
  $("#page-title").setAttribute("data-i18n", "discover");
  $("#page-title").textContent = t("discover");
  $("#content").setAttribute("aria-busy", "true");
  try {
    const videos = await api(`/v1/videos?q=${encodeURIComponent(query)}`);
    if (epoch !== libraryEpoch) return;
    renderVideos(videos, query ? "No matching published videos" : t("empty"));
    notice("");
  } catch (error) {
    if (epoch !== libraryEpoch) return;
    empty(t("unavailable"), navigator.onLine ? t("unavailable") : t("offline"), true);
    notice(error.message, true);
  } finally {
    if (epoch === libraryEpoch) $("#content").setAttribute("aria-busy", "false");
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
    notice("EVM wallet connected. Video sign-in is managed separately.");
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
  const restored = await restoreVideoWallet(state, window);
  if (!restored) return;
  currentWallet = restored;
  renderWalletState(currentWallet);
  bindWalletEvents(currentWallet);
  notice("Wallet connection restored from last session.");
}

async function revokeWallet(reason = "user") {
  resetWallet(reason === "user-requested" ? "EVM wallet disconnected from this page." : "EVM wallet connection ended.");
}

function startWatchProgress(video) {
  const previousProgress = watchProgress;
  void previousProgress?.flush(false).catch(() => {});
  const account = productState.session?.account;
  watchProgress = createWatchProgress({signedIn: () => productConnected() && productState.session?.account === account,
    send: body => privateAPI(`/v1/videos/${video.id}/watch`, json(body))});
}

async function openVideo(video) {
  currentVideo = video;
  startWatchProgress(video);
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
  $("#player").showModal();
  void loadComments();
  void refreshSubscriptionButton();
}

async function loadComments() {
  if (!currentVideo) return;
  const target = currentVideo;
  try {
    const comments = await api(`/v1/videos/${target.id}/comments`);
    if (target !== currentVideo) return;
    $("#comments").innerHTML = comments.length ? comments.map(c => `<article><b>${esc(c.Author || c.author)}</b><p>${esc(c.Body || c.body)}</p></article>`).join("") : '<p class="meta">No comments yet.</p>';
  } catch (error) {
    if (target === currentVideo) $("#comments").textContent = error.message;
  }
}

async function flushWatch(completed = false) {
  try {await watchProgress?.flush(completed);}
  catch {notice("Watch history could not be saved. Playback remains available.", true);}
}

async function showSubscriptions(button) {
  const epoch = beginLibrary("subscriptions", button);
  if (epoch === null) return;
  try {
    const channels = await privateAPI("/v1/subscriptions");
    if (epoch !== libraryEpoch) return;
    const box = $("#content"); box.replaceChildren();
    if (!channels.length) {empty("No subscriptions yet", "Subscribe from a video to keep the channel in your library."); return;}
    for (const channel of channels) {
      const id = field(channel, "id", "ID");
      const article = document.createElement("article"); article.className = "library-row";
      article.innerHTML = '<div><h2>'+esc(field(channel,"name","Name"))+'</h2><p class="meta">@'+esc(field(channel,"handle","Handle"))+'</p></div><div class="row-actions"><button class="open-channel">Open channel</button><button class="outline unsubscribe">Unsubscribe</button></div>';
      article.querySelector(".open-channel").onclick = () => showChannel(id);
      article.querySelector(".unsubscribe").onclick = async event => {
        const action = event.currentTarget;
        action.disabled = true;
        try {await privateAPI('/v1/channels/'+encodeURIComponent(id)+'/subscription', {method:"DELETE"}); await showSubscriptions(button);}
        catch (error) {action.disabled = false; notice(error.message, true);}
      };
      box.append(article);
    }
  } catch (error) {libraryFailure(error, epoch, () => showSubscriptions(button));}
}

async function refreshSubscriptionButton() {
  const target = currentVideo;
  const button = $("#subscribe");
  button.textContent = "Subscribe";
  button.dataset.subscribed = "false";
  if (!target || !productConnected()) return;
  const account = productState.session.account;
  try {
    const channels = await privateAPI("/v1/subscriptions");
    if (target !== currentVideo || productState.session?.account !== account || !productConnected()) return;
    const subscribed = channels.some(channel => field(channel,"id","ID") === target.channel_id);
    button.textContent = subscribed ? "Unsubscribe" : "Subscribe";
    button.dataset.subscribed = String(subscribed);
  } catch { /* A failed private read never blocks playback. */ }
}

async function showChannel(channelID) {
  const epoch = ++libraryEpoch;
  currentView = "channel";
  activate(null);
  $("#content").setAttribute("aria-busy", "true");
  try {
    const view = await api(`/v1/channels/${channelID}`);
    if (epoch !== libraryEpoch) return;
    const channel = view.channel;
    $("#page-title").removeAttribute("data-i18n");
    $("#page-title").textContent = channel.Name || channel.name;
    renderVideos(view.videos || [], `@${channel.Handle || channel.handle} has no published videos`);
    notice(`${channel.Name || channel.name} · ${view.subscribers} persisted subscriber(s)`);
    if ($("#player").open) {$("#video").pause(); $("#player").close();}
  } catch (error) {
    if (epoch === libraryEpoch) notice(error.message, true);
  } finally {
    if (epoch === libraryEpoch) $("#content").setAttribute("aria-busy", "false");
  }
}

async function showPlaylists(button) {
  currentPlaylist = null;
  const epoch = beginLibrary("playlists", button);
  if (epoch === null) return;
  try {
    const lists = await privateAPI("/v1/playlists");
    if (epoch !== libraryEpoch) return;
    const box = $("#content"); box.replaceChildren();
    const form = document.createElement("form"); form.className = "library-create";
    form.innerHTML = '<label for="new-playlist-name">Create a playlist</label><div><input id="new-playlist-name" name="name" maxlength="80" required placeholder="Playlist name"><button>Create</button></div>';
    form.onsubmit = async event => {
      event.preventDefault(); const button = form.querySelector("button"); button.disabled = true;
      try {await privateAPI("/v1/playlists", json({name:form.elements.name.value.trim()})); await showPlaylists(document.querySelector('[data-view="playlists"]'));}
      catch (error) {button.disabled = false; notice(error.message, true);}
    };
    box.append(form);
    if (!lists.length) {const p = document.createElement("p"); p.className="meta"; p.textContent="No playlists yet. Create one here or save a video while watching."; box.append(p);}
    for (const list of lists) {
      const id = field(list,"id","ID"), ids = field(list,"video_ids","VideoIDs") || [];
      const article = document.createElement("article"); article.className = "library-row";
      article.innerHTML = '<div><h2>'+esc(field(list,"name","Name"))+'</h2><p class="meta">'+ids.length+' saved videos</p></div><div class="row-actions"><button class="open-list">Open playlist</button><button class="outline delete-list">Delete playlist</button></div>';
      article.querySelector(".open-list").onclick = () => showPlaylist(id);
      article.querySelector(".delete-list").onclick = async event => {
        if (!confirm('Delete this playlist? The original videos will remain available.')) return;
        const button = event.currentTarget; button.disabled = true;
        try {await privateAPI('/v1/playlists/'+encodeURIComponent(id),{method:"DELETE"}); await showPlaylists(document.querySelector('[data-view="playlists"]'));}
        catch(error) {button.disabled=false; notice(error.message,true);}
      };
      box.append(article);
    }
  } catch (error) {libraryFailure(error, epoch, () => showPlaylists(button));}
}

async function showPlaylist(playlistId) {
  currentPlaylist = playlistId;
  const epoch = beginLibrary("playlists", document.querySelector('[data-view="playlists"]'));
  if (epoch === null) return;
  try {
    const lists = await privateAPI("/v1/playlists");
    if (epoch !== libraryEpoch) return;
    const list = lists.find(item => field(item,"id","ID") === playlistId);
    if (!list) {currentPlaylist=null; await showPlaylists(document.querySelector('[data-view="playlists"]')); notice("This playlist was removed."); return;}
    const box = $("#content"); box.replaceChildren();
    const heading = document.createElement("div"); heading.className="library-heading";
    heading.innerHTML = '<button class="outline">All playlists</button><h2>'+esc(field(list,"name","Name"))+'</h2>';
    heading.querySelector("button").onclick=()=>showPlaylists(document.querySelector('[data-view="playlists"]'));
    box.append(heading);
    const ids = field(list,"video_ids","VideoIDs") || [];
    if (!ids.length) {const p=document.createElement("p");p.className="meta";p.textContent="No videos saved here yet. Use Save to playlist while watching.";box.append(p);}
    const labelJobs = [];
    for (const id of ids) {
      const row = document.createElement("article"); row.className="library-row";
      row.innerHTML='<div><h3>Saved video</h3><p class="meta">'+esc(id)+'</p></div><div class="row-actions"><button class="play-saved">Play</button><button class="outline remove-saved">Remove from playlist</button></div>';
      row.querySelector(".play-saved").onclick=()=>openSavedVideo(id);
      row.querySelector(".remove-saved").onclick=async event=>{
        if(!confirm("Remove this item from the playlist? The original video will remain available."))return;
        const button=event.currentTarget;button.disabled=true;
        try{await privateAPI('/v1/playlists/'+encodeURIComponent(playlistId)+'/videos/'+encodeURIComponent(id),{method:"DELETE"});await showPlaylist(playlistId);}
        catch(error){button.disabled=false;notice(error.message,true);}
      };
      box.append(row);
      labelJobs.push(async()=>{
        try{const video=await api('/v1/videos/'+encodeURIComponent(id));if(epoch===libraryEpoch){row.querySelector("h3").textContent=video.title;row.querySelector(".meta").textContent="Ready to watch";}}
        catch{if(epoch===libraryEpoch){row.querySelector("h3").textContent="Video unavailable";row.querySelector(".play-saved").disabled=true;row.querySelector(".meta").textContent="The video may be private or no longer published.";}}
      });
    }
    // A large saved list must not open hundreds of requests at once.
    void Promise.all(Array.from({length:Math.min(4,labelJobs.length)},async()=>{
      while(epoch===libraryEpoch&&labelJobs.length)await labelJobs.shift()();
    }));
  } catch(error){libraryFailure(error,epoch,()=>showPlaylist(playlistId));}
}

async function showHistory(button) {
  const epoch=beginLibrary("history",button);
  if(epoch===null)return;
  try {
    const events=await privateAPI("/v1/history");
    if(epoch!==libraryEpoch)return;
    const box=$("#content");box.replaceChildren();
    if(!events.length){empty("No watch history yet","Videos you watch while signed in will appear here.");return;}
    for(const item of events){
      const id=field(item,"video_id","VideoID");
      const row=document.createElement("article");row.className="library-row";
      const date=new Date(field(item,"created_at","CreatedAt"));
      row.innerHTML='<div><h2>Watched video</h2><p>'+esc(field(item,"seconds","Seconds"))+' seconds watched</p><p class="meta">'+esc(Number.isNaN(date.getTime())?"":date.toLocaleString())+'</p></div><button>Play video</button>';
      row.querySelector("button").onclick=()=>openSavedVideo(id);
      box.append(row);
    }
  }catch(error){libraryFailure(error,epoch,()=>showHistory(button));}
}

function showSettings() {
  const epoch=beginLibrary("settings",$("#privacy"));
  if(epoch===null)return;
  $("#content").innerHTML='<section class="settings-panel"><h2>Your Video data</h2><p>Delete your watch history, subscriptions, playlists and comment text. Original videos remain available, and the service retains a minimal deletion audit record.</p><button id="delete-viewer-data" class="danger">Delete my Video data</button></section>';
  $("#delete-viewer-data").onclick=async event=>{
    if(!confirm("Delete your Video history, subscriptions, playlists and comment text? This cannot be undone. Original videos are not deleted."))return;
    const button=event.currentTarget;button.disabled=true;
    try{
      $("#video").pause();
      await flushWatch(false);
      watchProgress?.discard();
      await privateAPI("/v1/privacy/account-data",{method:"DELETE"});
      if(currentVideo)startWatchProgress(currentVideo);
      currentPlaylist=null;notice("Your saved Video data was deleted.");await refreshSubscriptionButton();
    }
    catch(error){notice(error.message,true);}
    finally{button.disabled=false;}
  };
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
$("#product-signin").onclick = focusSignIn;
$("#product-connect").onclick = prepareVideoSignIn;
$("#product-retry").onclick = restoreVideoAccount;
$("#product-disconnect").onclick = async event => {
  const button=event.currentTarget;button.disabled=true;
  try {const state=await videoProductSession.disconnect();renderProductState(state);if(state.status==="disconnected")notice("Your Video account is signed out.");}
  catch {notice("Sign-out could not be confirmed. Retry when connected.",true);}
  finally {button.disabled=false;}
};
$("#search").onsubmit = event => {event.preventDefault();currentView="discover";currentPlaylist=null;activate(document.querySelector('[data-view="discover"]'));loadVideos($("#query").value);};
$("#close").onclick = () => {$("#video").pause();$("#player").close();void flushWatch(false);};
$("#player").addEventListener("cancel",()=>{$("#video").pause();void flushWatch(false);});
$("#video").addEventListener("timeupdate",()=>{const video=$("#video");watchProgress?.sample({position:video.currentTime,paused:video.paused,seeking:video.seeking,rate:video.playbackRate});});
$("#video").addEventListener("seeking",()=>watchProgress?.resetSample());
$("#video").addEventListener("pause",()=>{watchProgress?.resetSample();void flushWatch(false);});
$("#video").addEventListener("ended",()=>void flushWatch(true));
$("#channel").onclick = () => currentVideo && showChannel(currentVideo.channel_id);
$("#subscribe").onclick = async event => {
  if(!currentVideo||!requireAccount())return;
  const button=event.currentTarget, target=currentVideo;button.disabled=true;
  try {
    const channels=await privateAPI("/v1/subscriptions");
    const subscribed=channels.some(channel=>field(channel,"id","ID")===target.channel_id);
    await privateAPI('/v1/channels/'+encodeURIComponent(target.channel_id)+'/subscription',{method:subscribed?"DELETE":"POST"});
    await refreshSubscriptionButton();notice(subscribed?"Subscription removed.":"Channel added to your subscriptions.");
  }catch(error){notice(error.message,true);}
  finally{button.disabled=false;}
};
$("#playlist").onclick = async()=>{
  if(!currentVideo||!requireAccount())return;
  playlistTarget=currentVideo;
  try{
    const lists=await privateAPI("/v1/playlists"), select=$("#playlist-choice");select.replaceChildren();
    select.append(new Option("Create a new playlist", ""));
    for(const list of lists)select.append(new Option(field(list,"name","Name"),field(list,"id","ID")));
    if(lists.length)select.value=field(lists[0],"id","ID");
    $("#playlist-name").value="";
    $("#playlist-picker-status").textContent="";
    $("#playlist-picker").showModal();
  }catch(error){notice(error.message,true);}
};
$("#playlist-picker-close").onclick=()=>$("#playlist-picker").close();
$("#playlist-save-form").onsubmit=async event=>{
  event.preventDefault();if(!playlistTarget||!requireAccount())return;
  const button=$("#playlist-save"),target=playlistTarget;button.disabled=true;
  try{
    const name=$("#playlist-name").value.trim();let id=$("#playlist-choice").value;
    if(name){const created=await privateAPI("/v1/playlists",json({name}));id=field(created,"id","ID");$("#playlist-choice").append(new Option(name,id));$("#playlist-choice").value=id;$("#playlist-name").value="";}
    if(!id)throw new Error("Choose a playlist or enter a new playlist name.");
    await privateAPI('/v1/playlists/'+encodeURIComponent(id)+'/videos',json({video_id:target.id}));
    $("#playlist-picker").close();notice("Video saved to your playlist.");
  }catch(error){$("#playlist-picker-status").textContent=error.message;}
  finally{button.disabled=false;}
};

$("#report").onclick = async () => {
  if (!currentVideo || !requireAccount()) return;
  const reason = prompt("Reason for human review");
  if (!reason) return;
  try {
    await privateAPI(`/v1/videos/${currentVideo.id}/reports`, json({reason, details: "Submitted from YNX Video viewer"}));
    notice("Report submitted for human review. No automatic takedown occurred.");
  } catch (error) {
    notice(error.message, true);
  }
};

$("#comment").onsubmit = async event => {
  event.preventDefault();
  if (!currentVideo || !requireAccount()) return;
  try {
    await privateAPI(`/v1/videos/${currentVideo.id}/comments`, json({body: event.target.elements[0].value}));
    event.target.reset();
    await loadComments();
    notice("Comment persisted.");
  } catch (error) {
    notice(error.message, true);
  }
};

const nav = [...document.querySelectorAll("nav button")];
nav.find(b => b.dataset.view === "discover").onclick = event => { currentView="discover";currentPlaylist=null;activate(event.currentTarget);loadVideos(); };
nav.find(b => b.dataset.view === "subscriptions").onclick = event => showSubscriptions(event.currentTarget);
nav.find(b => b.dataset.view === "playlists").onclick = event => showPlaylists(event.currentTarget);
nav.find(b => b.dataset.view === "history").onclick = event => showHistory(event.currentTarget);

$("#privacy").onclick = showSettings;

clearLegacySession();
renderProductState({status:"guest"});
resetWallet("EVM wallet not connected.");
// Guest catalog and playback start independently of translation, Auth, or provider recovery.
void i18nReady.catch(() => null);
const catalogReady = loadVideos();
const linkedVideo = new URLSearchParams(location.search).get("video");
if (linkedVideo) {
  api('/v1/videos/'+encodeURIComponent(linkedVideo)).then(openVideo).catch(async error=>{await catalogReady;notice(error.message,true);});
}
void restoreVideoAccount();
void restoreWalletFromSession().catch(()=>resetWallet("EVM wallet not connected."));
window.addEventListener("online",()=>void restoreVideoAccount());
window.addEventListener("offline",()=>{
  if(productState.status==="connected")renderProductState({status:"network-unavailable",message:"You are offline. Reconnect and retry sign-in to use your library."});
});
