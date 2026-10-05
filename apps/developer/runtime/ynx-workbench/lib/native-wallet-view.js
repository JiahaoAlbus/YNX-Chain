'use strict';
const { BaseWidget } = require('@theia/core/lib/browser/widgets');
const { CommonMenus } = require('@theia/core/lib/browser/common-menus');
const { nls } = require('@theia/core/lib/common/nls');
const { NativeWalletController, MISSING_WALLET_ADMISSION } = require('./native-wallet-controller');
const api = require('./native-wallet-sdk.generated');
const ID = 'ynx-native-wallet';
const { EN, ZH } = require('./native-wallet-localization');
const t = key => nls.localize('ynx/nativeWallet/' + key, EN[key] || key);
function element(document, tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
class NativeWalletService {
  constructor(target = window, admission = MISSING_WALLET_ADMISSION) {
    this.target = target; this.listeners = new Set();
    this.controller = new NativeWalletController(api, state => { for (const fn of this.listeners) fn(state); }, admission);
    this.pagehide = () => { void this.controller.cancel(); };
  }
  onStart() { this.target.addEventListener('pagehide', this.pagehide); }
  onStop() { this.target.removeEventListener('pagehide', this.pagehide); return this.controller.dispose(); }
}
class NativeWalletWidget extends BaseWidget {
  constructor(service) {
    super(); this.service = service; this.id = ID; this.title.label = t('title'); this.title.caption = t('title'); this.title.closable = true;
    this.title.iconClass = 'codicon codicon-credit-card'; this.node.tabIndex = -1;
    const document = this.node.ownerDocument;
    this.status = element(document, 'p'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.session = element(document, 'p'); this.detail = element(document, 'p'); this.source = element(document, 'small');
    const details = element(document, 'details'); details.append(element(document, 'summary', t('details')), this.source);
    this.node.append(element(document, 'h3', t('title')), this.status, this.session, this.detail, element(document, 'p', t('project')), element(document, 'p', t('standard')), element(document, 'p', t('closed')), details);
    this.buttons = {};
    const operations = { connect: 'connect', restore: 'restore', returned: 'resumeCallback', disconnect: 'disconnect', cancel: 'cancel', guest: 'guest' };
    for (const [key, operation] of Object.entries(operations)) {
      const button = element(document, 'button', t(key)); button.type = 'button'; button.className = 'theia-button secondary';
      button.addEventListener('click', () => { void service.controller[operation]().catch(error => service.controller.publish({ phase: 'error', message: error.message })); });
      this.buttons[key] = button; this.node.append(button);
    }
    const update = state => this.renderState(state); service.listeners.add(update); this.toDispose.push({ dispose: () => { service.listeners.delete(update); void service.controller.cancel(); } });
    this.renderState(service.controller.state); void service.controller.inspect();
  }
  renderState(state) {
    this.status.textContent = t(state.phase === 'guest' ? 'guestState' : state.phase);
    this.session.textContent = `${t(state.sessionCurrent ? 'session' : 'historical')}: ${t(EN['sdk-' + state.session.status] ? 'sdk-' + state.session.status : 'sdk-unknown')}${state.session.account ? ' · ' + state.session.account : ''}`;
    this.detail.textContent = state.available === false ? t('unavailable') : ['dependency-missing', 'paused', 'error'].includes(state.phase) ? t('retryAction') : '';
    const configuration = { 'not-supplied': 'serviceMissing', paused: 'servicePaused', unverified: 'serviceUnverified', verified: 'serviceVerified' };
    this.source.textContent = t(configuration[state.serviceConfiguration] || 'serviceUnverified') + (state.source ? ` · ${state.source.gatewayOrigin}` : '');
    for (const key of ['connect', 'restore', 'disconnect']) this.buttons[key].disabled = state.busy || state.awaitingCallback;
    this.buttons.returned.disabled = state.busy || state.awaitingCallback || !state.hasPendingReturn;
    this.buttons.cancel.disabled = !state.busy && !state.awaitingCallback;
    this.buttons.guest.disabled = state.busy;
  }
  onActivateRequest(message) { super.onActivateRequest(message); this.buttons.connect.focus(); }
}
class NativeWalletContribution {
  constructor(widgets, shell) { Object.assign(this, { widgets, shell }); }
  registerCommands(registry) { registry.registerCommand({ id: 'ynx.workbench.wallet', label: t('title'), category: 'YNX' }, { execute: async () => { const widget = await this.widgets.getOrCreateWidget(ID); if (!this.shell.getTabBarFor(widget)) this.shell.addWidget(widget, { area: 'left' }); await this.shell.activateWidget(widget.id); } }); }
  registerMenus(menus) { menus.registerMenuAction([...CommonMenus.VIEW_VIEWS, 'ynx-wallet'], { commandId: 'ynx.workbench.wallet', label: t('title'), order: '20' }); }
}
module.exports = { NativeWalletService, NativeWalletWidget, NativeWalletContribution, NATIVE_WALLET_ID: ID, NATIVE_WALLET_EN: EN, NATIVE_WALLET_ZH: ZH };
