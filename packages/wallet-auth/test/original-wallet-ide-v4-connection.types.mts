import {openOriginalWalletIDEV4Connection} from '../src/original-wallet-ide-v4-connection.js';
const owner=openOriginalWalletIDEV4Connection();
const c:false=owner.statusDATA().connected;
const n:false=owner.statusDATA().newSession;
// @ts-expect-error zero-argument fixed normal factory
openOriginalWalletIDEV4Connection({provider:()=>({})});
// @ts-expect-error same original context is mandatory
owner.submitPair();
// @ts-expect-error old login DTO is not registration selection
owner.preparePair({account:'x'},{});
// @ts-expect-error caller endpoint is not a session Source
owner.openSession({endpoint:'https://invalid'});
// @ts-expect-error readonly result cannot be promoted into connected
owner.statusDATA().connected=true;
// @ts-expect-error finalization also requires same original context
owner.finalizeOriginalAssociation({});
void c;void n;

// @ts-expect-error review retains SAME original context, never an omitted/default context
owner.reviewPair({});
// @ts-expect-error finalization review is zero caller identity/provider input beyond original context
owner.reviewFinalization({provider:()=>({})});

void owner.closePairPhase();void owner.closeCompletionPhase();void owner.closeFinalizationPhase();
// @ts-expect-error normal business factory never accepts clock/provider configuration
owner.openBusinessRead({clock:()=>new Date(),provider:{}});
// @ts-expect-error no caller Source/current/device injection
owner.openBusinessRead({registry:{},productId:'developer',platform:'macos',storage:{},gatewayTimeoutMs:1000,deviceCurrent:{}});
