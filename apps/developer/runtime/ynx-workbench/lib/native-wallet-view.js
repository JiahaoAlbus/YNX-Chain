'use strict';
const { BaseWidget } = require('@theia/core/lib/browser/widgets');
const { CommonMenus } = require('@theia/core/lib/browser/common-menus');
const { nls } = require('@theia/core/lib/common/nls');
const { NativeWalletController, MISSING_WALLET_ADMISSION } = require('./native-wallet-controller');
const api = require('./native-wallet-sdk.generated');
const ID = 'ynx-native-wallet';
const { EN, ZH } = require('./native-wallet-localization');
const t = key => nls.localize('ynx/nativeWallet/' + key, EN[key] || key);
const identityFailureKey=error=>({
  IDE_NODE_ACTUAL_PARENT_ENTRY_UNAVAILABLE:'identityParentUnavailable',
  AUTH_IDENTITY_IDE_EXTERNAL_ORIGINALS_NOT_PROTECTED:'identitySourceUnverified',
  AUTH_IDENTITY_PRIVILEGED_RECEIVER_NOT_CONNECTED:'identityReceiverUnavailable',
  AUTH_IDENTITY_RECOVERY_CONSUMER_NOT_IMPLEMENTED:'identityRecoveryUnavailable',
  AUTH_IDENTITY_ORIGINAL_WINDOW_EXPIRED:'identityRequestExpired',
  AUTH_IDENTITY_SOURCE_CURRENT_EXPIRED:'identityRequestExpired',
  IDE_IDENTITY_REQUEST_BUSY:'identityRequestBusy',
})[error?.code]||'identityFailed';
function element(document, tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
class NativeWalletService {
  constructor(target = window, admission = MISSING_WALLET_ADMISSION, projectContracts) {
    this.target = target; this.listeners = new Set();this.projectContracts=projectContracts;
    this.controller = new NativeWalletController(api, state => { for (const fn of this.listeners) fn(state); }, admission);
    this.pagehide = () => { void this.controller.cancel();void this.projectContracts?.call('cancel',{}).catch(()=>{}); };
  }
  onStart() { this.target.addEventListener('pagehide', this.pagehide); }
  onStop() { this.target.removeEventListener('pagehide', this.pagehide);void this.projectContracts?.call('cancel',{}).catch(()=>{});return this.controller.dispose(); }
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
    this.buttons = {}; let live = true;
    // Current-project operations use the retained backend owner, not the
    // product-session bridge. Rendering this section never initializes Relay.
    const projectStatus=element(document,'p',t('projectContractIdle'));projectStatus.setAttribute('role','status');
    const reference=element(document,'input');reference.type='text';reference.value='';reference.placeholder=t('projectReference');reference.setAttribute('aria-label',t('projectReference'));reference.maxLength=36;
    const pairing=element(document,'textarea');pairing.readOnly=true;pairing.setAttribute('aria-label',t('projectPairing'));pairing.hidden=true;
    const result=element(document,'pre');result.setAttribute('aria-live','polite');
    this.node.append(element(document,'h4',t('projectContractTitle')),projectStatus,reference,pairing,result);
    let projectEpoch=0;
    const projectButtons={};
    const projectCall=async(action,body={})=>{
      const epoch=++projectEpoch;
      try{
        if(!service.projectContracts)throw Error('Project service unavailable');
        const value=await service.projectContracts.call(action,body);
        if(!live||epoch!==projectEpoch)return;
        if(action==='inspect'){
          const configured=value?.onlineConfigured===true;
          projectStatus.textContent=t(configured?'projectContractIdle':'projectContractUnavailable');
          projectButtons.connect.disabled=!configured;projectButtons.query.disabled=!configured;
          pairing.value=typeof value?.pairingURI==='string'?value.pairingURI:'';pairing.hidden=!pairing.value;
        }else if(action==='read'||action==='query'){
          result.textContent=value===null?t('projectReferenceMissing'):JSON.stringify(value,null,2);
          projectStatus.textContent=t('projectQueryOnly');
        }else{projectStatus.textContent=t(action==='cancel'?'projectContractCancelled':'projectContractConnected');pairing.value='';pairing.hidden=true;}
      }catch{if(live&&epoch===projectEpoch)projectStatus.textContent=t('projectContractUnavailable');}
    };
    for(const [action,key] of [['connect','projectContractConnect'],['inspect','projectContractRefresh'],['read','projectReferenceRead'],['query','projectReferenceQuery'],['cancel','projectContractCancel']]){
      const button=element(document,'button',t(key));button.type='button';button.className='theia-button secondary';if(action==='connect'||action==='query')button.disabled=true;
      button.addEventListener('click',()=>{if(!live)return;void projectCall(action,action==='read'?{referenceId:reference.value.trim()}:action==='query'?{referenceId:reference.value.trim(),refresh:true}:{});});projectButtons[action]=button;this.node.append(button);
    }
    this.toDispose.push({dispose:()=>{projectEpoch++;pairing.value='';}});
    void projectCall('inspect');
    // Native identity bootstrap is separate from Product Session and project
    // permissions. A DATA response must never promote controller.session.
    const identityStatus=element(document,'p',t('identityNote'));
    identityStatus.setAttribute('role','status');identityStatus.setAttribute('aria-live','polite');
    this.node.append(element(document,'h4',t('identityTitle')),identityStatus);
    let identityRequest;const identityButtons=[];
    const identityBusy=busy=>{for(const button of identityButtons)button.disabled=busy;identityCancel.disabled=!busy;};
    const identityCancel=element(document,'button',t('identityCancel'));identityCancel.type='button';identityCancel.className='theia-button secondary';identityCancel.disabled=true;
    identityCancel.addEventListener('click',()=>{if(identityRequest){identityStatus.textContent=t('identityCancelled');identityRequest.abort();}});
    for(const kind of ['receive','recover']){
      const button=element(document,'button',t(kind==='receive'?'identityReceive':'identityRecover'));button.type='button';button.className='theia-button secondary';identityButtons.push(button);this.node.append(button);
      button.addEventListener('click',()=>{
        if(!live||identityRequest)return;
        const bridge=service.target?.ynxDesktopIdentity;
        if(typeof bridge?.[kind]!=='function'){identityStatus.textContent=t('identityUnavailable');return;}
        const request=new AbortController();identityRequest=request;identityBusy(true);identityStatus.textContent=t('identityWaiting');
        void Promise.resolve().then(()=>{if(!live||request.signal.aborted)throw Object.assign(Error('Cancelled'),{name:'AbortError'});return bridge[kind]({signal:request.signal});}).then(result=>{
          if(live&&identityRequest===request&&!request.signal.aborted)identityStatus.textContent=t(result?.phase==='response-received'&&result.authorized===false&&result.dataOnly===true?'identityReceived':'identityFailed');
        },error=>{if(live&&identityRequest===request)identityStatus.textContent=t(request.signal.aborted||error?.name==='AbortError'?'identityCancelled':identityFailureKey(error));}).finally(()=>{if(identityRequest===request){identityRequest=undefined;if(live)identityBusy(false);}});
      });
    }
    this.node.append(identityCancel);
    this.toDispose.push({dispose:()=>{identityRequest?.abort();}});
    const operations = { connect: 'connect', restore: 'restore', returned: 'resumeCallback', disconnect: 'disconnect', cancel: 'cancel', guest: 'guest' };
    for (const [key, operation] of Object.entries(operations)) {
      const button = element(document, 'button', t(key)); button.type = 'button'; button.className = 'theia-button secondary';
      button.addEventListener('click', () => {
        if (!live) return;
        // Bind before invocation: state listeners can start a newer generation.
        const controller = service.controller, epoch = controller.epoch + 1;
        void controller[operation]().catch(error => {
          if (live && service.controller === controller && !controller.disposed && controller.epoch === epoch)
            controller.publish({ phase: 'error', message: error.message });
        });
      });
      this.buttons[key] = button; this.node.append(button);
    }
    const update = state => this.renderState(state); service.listeners.add(update); this.toDispose.push({ dispose: () => { live = false; service.listeners.delete(update); void service.controller.cancel(); } });
    this.renderState(service.controller.state); void service.controller.inspect();
  }
  renderState(state) {
    this.status.textContent = t(state.cleanupStatus === 'unknown' ? 'cleanupUnknown' : state.phase === 'guest' ? 'guestState' : state.phase);
    this.session.textContent = `${t(state.sessionCurrent ? 'session' : 'historical')}: ${t(EN['sdk-' + state.session.status] ? 'sdk-' + state.session.status : 'sdk-unknown')}${state.session.account ? ' · ' + state.session.account : ''}`;
    this.detail.textContent = state.cleanupStatus === 'unknown' ? t('cleanupUnknownDetail') : state.phase === 'error' ? t('operationFailed') : state.bridgeContract === 'check-failed' ? t('bridgeCheckFailed') : state.available === false ? t('bridgeMissing') : ['dependency-missing', 'paused'].includes(state.phase) ? t('retryAction') : state.available === true ? t('bridgePresent') : '';
    const configuration = { 'not-supplied': 'serviceMissing', paused: 'servicePaused', unverified: 'serviceUnverified', verified: 'serviceVerified' };
    this.source.textContent = t(configuration[state.serviceConfiguration] || 'serviceUnverified') + (state.source ? ` · ${state.source.gatewayOrigin}` : '');
    for (const key of ['connect', 'restore', 'disconnect']) this.buttons[key].disabled = state.busy || state.awaitingCallback;
    this.buttons.returned.disabled = state.busy || state.awaitingCallback || !state.hasPendingReturn;
    this.buttons.cancel.disabled = state.cleanupStatus === 'unknown' || (!state.busy && !state.awaitingCallback);
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
