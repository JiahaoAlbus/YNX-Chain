const { randomBytes } = require('node:crypto');
const { createLocalReview, localTranslate } = require('./local-review.cjs');
const TITLE = 'Local Change Review';
const escapeHtml = text => String(text).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const scriptValue = text => JSON.stringify(text).replace(/[<\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
function createLocalReviewPanel(vscode, context, environment, previewChange) {
  const t = text => localTranslate(vscode, text);
  let panel, review, busy = false, epoch = 0, publication = 0;
  const disposal = { dispose() { ++epoch; review?.dispose(); review = undefined; panel?.dispose(); panel = undefined; } };
  context.subscriptions.push(disposal);
  async function publish(error = '') {
    if (panel && review) await panel.webview.postMessage({ type: 'state', publication: ++publication, ...review.state(), busy, error });
  }
  async function open(capture = false) {
    if (!panel) {
      review = createLocalReview(vscode, environment, previewChange);
      panel = vscode.window.createWebviewPanel('ynx.localChangeReview', t(TITLE), vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [] });
      const openedPanel = panel, openedReview = review, currentEpoch = ++epoch;
      panel.webview.html = html(t);
      panel.onDidDispose(() => {
        openedReview.dispose();
        if (panel === openedPanel) { panel = undefined; review = undefined; busy = false; ++epoch; }
      });
      panel.webview.onDidReceiveMessage(async message => {
        if (epoch !== currentEpoch || panel !== openedPanel) return;
        let ownsBusy = false;
        try {
          if (!message || Array.isArray(message) || typeof message !== 'object' || Buffer.byteLength(JSON.stringify(message)) > 72 * 1024 ||
              Object.keys(message).some(key => !['action', 'revision', 'replacement'].includes(key)) ||
              !['ready', 'capture', 'stage', 'preview', 'apply'].includes(message.action)) throw Error(t('Unsupported local review message.'));
          if (message.action === 'ready') { await publish(); return; }
          if (busy) return;
          if (!Number.isInteger(message.revision) || message.revision !== openedReview.state().revision) throw Error(t('This review changed. Use its current source.'));
          if (message.action !== 'stage' && Object.hasOwn(message, 'replacement')) throw Error(t('Unexpected replacement payload.'));
          busy = true; ownsBusy = true; await publish();
          if (message.action === 'capture') await openedReview.captureSelection();
          if (message.action === 'stage') await openedReview.stageReplacement(message.replacement, message.revision);
          if (message.action === 'preview') await openedReview.preview(message.revision);
          if (message.action === 'apply') await openedReview.apply(message.revision);
          if (epoch === currentEpoch) { busy = false; await publish(); }
        } catch (error) {
          if (epoch === currentEpoch) { if (ownsBusy) busy = false; await publish(error.message); }
        }
      });
    } else panel.reveal(vscode.ViewColumn.Beside, true);
    if (capture && !busy) {
      const current = epoch; busy = true;
      try { await review.captureSelection(); if (current === epoch) { busy = false; await publish(); } }
      catch (error) { if (current === epoch) { busy = false; await publish(error.message); } }
    } else await publish();
  }
  return { open, dispose: disposal.dispose };
}
function html(t) {
  const visible = text => escapeHtml(t(text));
  const emptySource = scriptValue(t('Select text in the editor to begin.'));
  const nonce = randomBytes(24).toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">
  body{font:var(--vscode-font-size,14px) var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:20px;max-width:880px}h1{font-size:20px}p{line-height:1.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:var(--vscode-textCodeBlock-background)}textarea{box-sizing:border-box;width:100%;min-height:140px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:10px;font:inherit}button{margin:8px 8px 8px 0;padding:8px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0}button:disabled{opacity:.5}#error{color:var(--vscode-errorForeground)}label{display:block;margin:16px 0 8px}
  </style></head><body><h1>${visible(TITLE)}</h1><p role="status">${visible('Product identity: not connected. AI model: not connected. Waiting for the product identity and model services. Nothing is sent from this panel.')}</p><p>${visible('This review uses your current local editor buffer. A manually entered replacement is not an AI result. Applying changes does not save the file.')}</p><button id="capture">${visible('Capture current selection')}</button><pre id="source">${visible('Select text in the editor to begin.')}</pre><pre id="selected"></pre><label for="replacement">${visible('Manually entered replacement (maximum 32 KiB)')}</label><textarea id="replacement" spellcheck="false"></textarea><button id="stage">${visible('Review replacement')}</button><button id="preview">${visible('Open diff')}</button><button id="apply">${visible('Apply reviewed change')}</button><p id="error" role="alert"></p><script nonce="${nonce}">
  const api=acquireVsCodeApi();let revision=-1,publication=-1;const byId=id=>document.getElementById(id);const send=(action,extra={})=>api.postMessage({action,revision,...extra});
  byId('capture').onclick=()=>send('capture');byId('stage').onclick=()=>send('stage',{replacement:byId('replacement').value});byId('preview').onclick=()=>send('preview');byId('apply').onclick=()=>send('apply');
  byId('replacement').oninput=()=>{byId('preview').disabled=true;byId('apply').disabled=true;};
  window.addEventListener('message',event=>{const state=event.data;if(state?.type!=='state'||!Number.isInteger(state.publication)||state.publication<=publication||!Number.isInteger(state.revision)||state.revision<revision)return;publication=state.publication;revision=state.revision;byId('error').textContent=state.error||'';const source=state.source;byId('source').textContent=source?JSON.stringify({...source,selectedText:undefined},null,2):${emptySource};byId('selected').textContent=source?.selectedText||'';byId('capture').disabled=state.busy;byId('stage').disabled=state.busy||!source;const matches=state.proposal&&state.proposal.replacement===byId('replacement').value;byId('preview').disabled=state.busy||!matches;byId('apply').disabled=state.busy||!matches||!state.proposal.previewed;});api.postMessage({action:'ready'});
  </script></body></html>`;
}
module.exports = { createLocalReviewPanel };
