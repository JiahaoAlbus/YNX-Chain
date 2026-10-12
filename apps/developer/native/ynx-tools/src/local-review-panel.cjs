const { createLocalReview } = require('./local-review.cjs');
// Native editor UI avoids a webview origin and retains the existing command API.
function createLocalReviewPanel(vscode, context, environment, previewChange) {
  const t = (text, ...args) => vscode.l10n?.t ? vscode.l10n.t(text, ...args) : text.replace(/\{(\d+)\}/g, (match, index) => String(args[index] ?? match));
  const guardedWindow = Object.create(vscode.window);
  Object.defineProperty(guardedWindow, 'activeTextEditor', { get: () => vscode.window.activeTextEditor });
  guardedWindow.showWarningMessage = async (...args) => {
    const document = replacementDocument, version = document?.version, text = currentReplacement();
    const answer = await vscode.window.showWarningMessage(...args);
    if (disposed || replacementDocument !== document || document.isClosed || document.uri.scheme !== 'untitled' || document.version !== version || document.getText() !== text)
      throw Error(t('The replacement document changed. Open its diff again.'));
    return answer;
  };
  const review = createLocalReview(Object.assign(Object.create(vscode), { window: guardedWindow }), environment, previewChange);
  let replacementDocument, stagedDocument, stagedVersion, sourceColumn, generatedReceipt, busy = false, disposed = false;
  const currentReplacement = () => {
    if (!replacementDocument || replacementDocument.isClosed || replacementDocument.uri.scheme !== 'untitled')
      throw Error(t('Open the unsaved replacement document again before reviewing.'));
    return replacementDocument.getText();
  };
  async function editReplacement() {
    const source = review.state().source;
    if (!source) throw Error(t('Select text in a local project file first.'));
    if (!replacementDocument || replacementDocument.isClosed || replacementDocument.uri.scheme !== 'untitled') {
      // This is a normal unsaved editor document, never a workspace file write.
      replacementDocument = await vscode.workspace.openTextDocument({ content: source.selectedText, language: 'plaintext' });
    }
    if (disposed) return;
    await vscode.window.showTextDocument(replacementDocument, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  }
  async function capture() {
    replacementDocument = undefined; stagedDocument = undefined; stagedVersion = undefined; sourceColumn = undefined;
    const column = vscode.window.activeTextEditor?.viewColumn;
    await review.captureSelection();
    sourceColumn = column;
    if (!disposed) await editReplacement();
  }
  async function preview() {
    const document = replacementDocument, version = document?.version, text = currentReplacement();
    const generation = review.state().proposal?.provenance === t('AI-generated replacement') && review.state().proposal.replacement === text ? generatedReceipt : undefined;
    await review.stageReplacement(text, review.state().revision, generation);
    if (disposed || document !== replacementDocument || document.isClosed || document.version !== version || document.getText() !== text)
      throw Error(t('The replacement document changed. Open its diff again.'));
    await review.preview(review.state().revision);
    if (disposed || document !== replacementDocument || document.isClosed || document.version !== version || document.getText() !== text)
      throw Error(t('The replacement document changed. Open its diff again.'));
    stagedDocument = document; stagedVersion = version;
  }
  async function apply() {
    const state = review.state(), text = currentReplacement();
    if (replacementDocument !== stagedDocument || replacementDocument.version !== stagedVersion || !state.proposal?.previewed || state.proposal.replacement !== text)
      throw Error(t('The replacement document changed. Open its diff again.'));
    const sourceDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === state.source?.uri);
    await review.apply(state.revision);
    if (!disposed && !review.state().source) {
      stagedDocument = undefined; stagedVersion = undefined;
      // Return Save/Undo to the edited source, never the scratch or diff editor.
      if (sourceDocument && !sourceDocument.isClosed) {
        await vscode.window.showTextDocument(sourceDocument, {
          ...(sourceColumn === undefined ? {} : { viewColumn: sourceColumn }), preview: false, preserveFocus: false,
        });
      }
      if (disposed) return;
      void vscode.window.showInformationMessage(t('Local change applied to the editor buffer. Save separately; Undo remains available.'));
    }
  }
  async function open(captureSelection = false) {
    if (disposed || busy) return;
    busy = true;
    try {
      if (captureSelection) { await capture(); return; }
      const source = review.state().source;
      const items = [
        { label: t('Local change review'), description: t('Review the replacement provenance before applying.'), action: 'status' },
        { label: t('Capture current selection'), action: 'capture' },
        ...(source ? [
          { label: t('Edit replacement document'), description: t('Unsaved text; maximum 32 KiB'), action: 'edit' },
          { label: t('Open diff'), description: t('Review the current replacement before applying'), action: 'preview' },
          { label: t('Apply reviewed change'), description: t('Changes the source buffer; does not save'), action: 'apply' },
        ] : []),
      ];
      const selected = await vscode.window.showQuickPick(items, { title: t('Local Change Review'), ignoreFocusOut: true,
        placeHolder: source ? t('Reviewing {0}', source.uri) : t('Select text in a local project file first.') });
      if (disposed || !selected) return;
      if (selected.action === 'capture') await capture();
      if (selected.action === 'edit') await editReplacement();
      if (selected.action === 'preview') await preview();
      if (selected.action === 'apply') await apply();
      if (selected.action === 'status') void vscode.window.showInformationMessage(review.state().proposal?.provenance || t('Manually entered replacement'));
    } catch (error) {
      if (!disposed) void vscode.window.showErrorMessage(error.message);
    } finally { busy = false; }
  }
  async function captureAI() {
    replacementDocument = undefined; stagedDocument = undefined; stagedVersion = undefined; sourceColumn = vscode.window.activeTextEditor?.viewColumn;
    await review.captureSelection(); return review.state().source;
  }
  async function stageGenerated(source, result) {
    await review.assertCaptured(source);
    const bundle = result.edit?.bundle, change = bundle?.changes?.[0], replacement = change?.replacements?.[0];
    if (bundle?.protocol !== 'ynx-reviewed-text/v1' || bundle.changes.length !== 1 || change.uri !== source.uri || change.version !== source.version || change.fullTextDigest !== source.fullTextDigest || change.replacements?.length !== 1 || replacement.find !== source.selectedText || typeof replacement.replace !== 'string' || Buffer.byteLength(replacement.replace) > 32 * 1024) throw Error(t('Use one exact reviewed selection replacement.'));
    generatedReceipt = { model: result.model, conversationId: result.conversationId };
    const revision = review.state().revision;
    await review.stageReplacement(replacement.replace, revision, { model: result.model, conversationId: result.conversationId });
    replacementDocument = await vscode.workspace.openTextDocument({ content: replacement.replace, language: 'plaintext' });
    if (disposed) return;
    await vscode.window.showTextDocument(replacementDocument, { viewColumn: vscode.ViewColumn.Beside, preview: false });
  }
  const dispose = () => { disposed = true; review.dispose(); replacementDocument = undefined; stagedDocument = undefined; };
  context.subscriptions.push({ dispose });
  return { open, dispose, captureAI, stageGenerated, assertCaptured: review.assertCaptured, beginTransmission: review.beginTransmission, finishTransmission: review.finishTransmission };
}
module.exports = { createLocalReviewPanel };
