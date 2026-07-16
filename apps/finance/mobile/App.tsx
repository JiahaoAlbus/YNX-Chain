import React,{useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,I18nManager,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import {AIJob,FinanceAPI,Overview,Privacy} from './src/api';
import {Locale,locales,messages,normalizeLocale,formatDate,formatYNXT} from './src/i18n';
import {clearToken,defaultSettings,loadCache,loadSettings,saveCache,saveSettings,saveToken,token} from './src/storage';
import {completeWallet,startWallet} from './src/wallet';

type Tab='overview'|'activity'|'plan'|'statements'|'ai'|'settings';
type AIKind='categorize'|'explain_fees'|'draft_budget'|'detect_anomalies'|'explain_recurring';
const tabs:Tab[]=['overview','activity','plan','statements','ai','settings'];
const aiKinds:AIKind[]=['categorize','explain_fees','draft_budget','detect_anomalies','explain_recurring'];
const newKey=(prefix:string)=>`${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const messageOf=(value:unknown)=>value instanceof Error?value.message:String(value);

export default function App(){
  const [settings,setSettings]=useState(defaultSettings);
  const [session,setSession]=useState<string|null>(null);
  const [data,setData]=useState<Overview|null>(null);
  const [cached,setCached]=useState(false);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const [tab,setTab]=useState<Tab>('overview');
  const [statement,setStatement]=useState<Record<string,unknown>|null>(null);
  const [audit,setAudit]=useState<Array<Record<string,unknown>>>([]);
  const [name,setName]=useState('');
  const [amount,setAmount]=useState('');
  const [categoryId,setCategoryId]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [aiKind,setAIKind]=useState<AIKind>('detect_anomalies');
  const [aiConsent,setAIConsent]=useState(false);
  const [aiJob,setAIJob]=useState<AIJob|null>(null);

  const locale:Locale=settings.locale==='system'?normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale):normalizeLocale(settings.locale);
  const t=messages[locale];
  const rtl=locale==='ar';
  const api=useMemo(()=>session?new FinanceAPI(settings.apiBase,session):null,[session,settings.apiBase]);

  const refresh=async()=>{
    if(!api)return;
    setBusy(true);setError('');
    try{
      const next=await api.overview();
      setData(next);setCached(false);
      if(!categoryId&&next.profile.categories[0])setCategoryId(next.profile.categories[0].id);
      await saveCache(next);
    }catch(value){
      setError(messageOf(value));
      const cachedValue=await loadCache();
      if(cachedValue?.data){setData(cachedValue.data as Overview);setCached(true)}
    }finally{setBusy(false)}
  };

  useEffect(()=>{void(async()=>{
    const loaded=await loadSettings();setSettings(loaded);setSession(await token());
    const cachedValue=await loadCache();if(cachedValue?.data){setData(cachedValue.data as Overview);setCached(true)}
    setBusy(false);
  })()},[]);
  useEffect(()=>{if(api)void refresh()},[api]);
  useEffect(()=>{
    const handle=async({url}:{url:string})=>{try{
      setBusy(true);setError('');const out=await completeWallet(url,settings.apiBase);
      if(!out.token)throw new Error('Central Gateway returned no Finance session token');
      await saveToken(out.token);setSession(out.token);
    }catch(value){setError(messageOf(value))}finally{setBusy(false)}};
    const sub=Linking.addEventListener('url',handle);
    void Linking.getInitialURL().then(url=>{if(url?.includes('wallet-auth/callback'))return handle({url})});
    return()=>sub.remove();
  },[settings.apiBase]);

  const persist=async(next:typeof settings)=>{setSettings(next);await saveSettings(next)};
  const mutate=async(work:()=>Promise<unknown>)=>{try{setBusy(true);setError('');await work();await refresh()}catch(value){setError(messageOf(value));setBusy(false)}};
  const minorAmount=()=>{const parsed=Number(amount);return Number.isFinite(parsed)&&parsed>0?Math.round(parsed*1_000_000):0};
  const createCategory=()=>mutate(async()=>{if(!api||!name.trim())throw new Error('Category name is required');await api.create('/api/categories',{name:name.trim(),color:'#002FA7',idempotencyKey:newKey('category')});setName('')});
  const createBudget=()=>mutate(async()=>{if(!api||!categoryId||!minorAmount())throw new Error('Category and positive YNXT limit are required');await api.create('/api/budgets',{name:name.trim()||t.budget,categoryId,limitYnxt:minorAmount(),period:'monthly',startsAt:new Date().toISOString(),idempotencyKey:newKey('budget')});setName('');setAmount('')});
  const createReminder=()=>mutate(async()=>{if(!api||!name.trim())throw new Error('Reminder title is required');await api.create('/api/reminders',{title:name.trim(),amountYnxt:minorAmount()||null,schedule:'monthly',nextDueAt:new Date(Date.now()+86_400_000).toISOString(),sourceRef:'user-entered',idempotencyKey:newKey('reminder')});setName('');setAmount('')});
  const updatePrivacy=(key:keyof Privacy,value:boolean)=>mutate(async()=>{if(!api||!data)return;await api.privacy({...data.profile.privacy,[key]:value})});
  const classify=(recordId:string,nextCategory:string)=>mutate(async()=>{if(!api) return;await api.classify(recordId,nextCategory,newKey('classification'))});
  const copyExport=async(format:'json'|'csv')=>{if(!api)return;try{const output=await api.export(format);await Clipboard.setStringAsync(format==='json'?JSON.stringify({schema:'ynx-finance-export-v1',exportedAt:new Date().toISOString(),data:JSON.parse(output)},null,2):output);Alert.alert(t.exportData,format==='json'?'Versioned JSON copied. It contains public account evidence and private planning data; store it securely.':'CSV activity report copied. Amount and fee columns use YNXT minor units and no fiat value is inferred.')}catch(value){setError(messageOf(value))}};
  const importData=async()=>{if(!api)return;try{const parsed=JSON.parse(await Clipboard.getStringAsync()) as {schema?:string;data?:Overview};if(parsed.schema!=='ynx-finance-export-v1'||!parsed.data?.profile)throw new Error('schema mismatch');for(const category of parsed.data.profile.categories||[])await api.create('/api/categories',{name:category.name,color:category.color,idempotencyKey:`import-${category.id}`});Alert.alert(t.importData,'Validated planning categories imported. Explorer and Pay evidence was not overwritten.');await refresh()}catch(value){Alert.alert(t.importData,messageOf(value))}};
  const runAI=async()=>{if(!api||selected.length===0||!aiConsent)return;try{setBusy(true);setError('');const job=await api.ai({kind:aiKind,recordIds:selected,contextClasses:['owned_activity'],consent:true,outputLocale:settings.aiLocale});setAIJob(job);setAIConsent(false)}catch(value){setError(messageOf(value))}finally{setBusy(false)}};
  const pollAI=async()=>{if(api&&aiJob)try{setAIJob(await api.aiJob(aiJob.id))}catch(value){setError(messageOf(value))}};
  const decideAI=async(decision:'apply'|'reject')=>{if(!api||!aiJob)return;try{setAIJob(await api.decision(aiJob.id,decision));await refresh()}catch(value){setError(messageOf(value))}};
  const openReviewed=async(url?:string)=>{if(!url||!/^https?:\/\//i.test(url)){setError('Reviewed HTTPS support link is unavailable');return}await Linking.openURL(url)};

  const signedOut=<Card><Text style={s.big}>{t.title}</Text><Text style={s.legal}>{t.legal}</Text><Button label={t.signIn} onPress={()=>void startWallet().catch(value=>setError(messageOf(value)))}/><Text style={s.source}>Product ynx-finance-v1 · ynxfinance://wallet-auth/callback · central session only · no recovery material</Text></Card>;
  const overview=<>
    <Card><Text style={s.label}>{t.balance}</Text><Text style={s.balance}>{data?formatYNXT(data.portfolio.balanceYnxt,locale):'—'}</Text><Text style={s.source}>{t.source}: {data?.portfolio.explorerStatus.source||t.unavailable} · {data?.portfolio.asOf?formatDate(data.portfolio.asOf,locale):'—'}</Text><Text style={s.source}>YNXT only · chain {data?.portfolio.network||'ynx_6423-1'} · read-only · no fiat conversion inferred</Text></Card>
    <Source unavailable={t.unavailable} name="Explorer" value={data?.portfolio.explorerStatus}/><Source unavailable={t.unavailable} name="YNX Pay" value={data?.portfolio.payStatus}/>
    <Card><Text style={s.big}>Pay receipts</Text>{data?.portfolio.payReceipts.length?data.portfolio.payReceipts.map(receipt=><View key={receipt.id} style={s.entry}><Text style={s.item}>{formatYNXT(receipt.amountYnxt,locale)} · {receipt.status}</Text><Text style={s.source}>{formatDate(receipt.createdAt,locale)} · {receipt.truthfulStatus} · {receipt.transactionHash||'no committed transaction hash supplied'}</Text>{receipt.disputeUrl?<Link label="Open dispute evidence" onPress={()=>void openReviewed(receipt.disputeUrl)}/>:null}</View>):<Text>{t.empty}. No receipt placeholders are shown.</Text>}</Card>
    <Card><Text style={s.big}>Security alerts</Text>{data?.alerts.length?data.alerts.map((alert,index)=><Text key={index} style={s.source}>{JSON.stringify(alert)}</Text>):<Text>{t.empty}. Alerts are informational and cannot freeze or reverse assets.</Text>}</Card>
    <Card><Text style={s.legal}>{t.legal}</Text></Card>
  </>;
  const activity=<Card><Text style={s.big}>{t.activity}</Text>{data?.portfolio.activity.length?data.portfolio.activity.map(item=><View key={item.id} style={s.entry}><View style={[s.row,rtl&&s.reverse]}><View style={s.flex}><Text style={s.item}>{item.type} · block {item.blockNumber}</Text><Text style={s.source}>{formatDate(item.timestamp,locale)} · {item.source} · fee {formatYNXT(item.feeYnxt,locale)}</Text></View><Text style={s.item}>{item.direction==='incoming'?'+':'−'}{formatYNXT(item.amountYnxt,locale)}</Text></View><ScrollView horizontal contentContainerStyle={s.choices}>{data.profile.categories.map(category=><Choice key={category.id} label={category.name} active={item.categoryId===category.id} onPress={()=>void classify(item.id,category.id)}/>)}</ScrollView></View>):<Text>{t.empty}</Text>}</Card>;
  const plan=<><Card><Text style={s.big}>{t.budget}</Text><TextInput value={name} onChangeText={setName} placeholder="Name / 名称" accessibilityLabel="Budget, category, or reminder name" style={s.input}/><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="YNXT" accessibilityLabel="YNXT amount, never fiat" style={s.input}/><ScrollView horizontal contentContainerStyle={s.choices}>{data?.profile.categories.map(category=><Choice key={category.id} label={category.name} active={categoryId===category.id} onPress={()=>setCategoryId(category.id)}/>)}</ScrollView><View style={s.actions}><Button label="+ Category" onPress={()=>void createCategory()}/><Button label="+ Budget" onPress={()=>void createBudget()}/><Button label="+ Reminder" onPress={()=>void createReminder()}/></View></Card><Card><Text style={s.big}>Saved plans</Text>{data?.profile.budgets.map(budget=><Text key={budget.id} style={s.item}>{budget.name} · {formatYNXT(budget.limitYnxt,locale)} / {budget.period}</Text>)}{data?.profile.reminders.map(reminder=><Text key={reminder.id} style={s.item}>{reminder.title} · {formatDate(reminder.nextDueAt,locale)} · {reminder.sourceRef||'user plan'}</Text>)}</Card></>;
  const statements=<Card><Text style={s.big}>{t.statements}</Text><Text style={s.legal}>Source-bounded Finance report, not a bank statement. Opening balance remains unavailable when Explorer history is bounded.</Text><View style={s.actions}><Button label="Build current month report" onPress={()=>void api?.statement().then(setStatement).catch(value=>setError(messageOf(value)))}/><Button label="Copy JSON report" onPress={()=>void copyExport('json')}/><Button label="Copy CSV activity" onPress={()=>void copyExport('csv')}/></View>{statement?<Text selectable style={s.mono}>{JSON.stringify(statement,null,2)}</Text>:<Text>{t.empty}</Text>}</Card>;
  const ai=<><Card><Text style={s.big}>{t.ai}</Text><Text style={s.legal}>{t.aiDraft} AI may categorize owned activity, explain fees, draft budgets, or flag anomalies. It cannot sign, transfer, trade, borrow, lend, stake, freeze, promise returns, or change controls.</Text><Text style={s.label}>Draft kind</Text><ScrollView horizontal contentContainerStyle={s.choices}>{aiKinds.map(kind=><Choice key={kind} label={kind.replace('_',' ')} active={aiKind===kind} onPress={()=>setAIKind(kind)}/>)}</ScrollView><Text style={s.label}>Exact account-owned Explorer records sent to AI</Text>{data?.portfolio.activity.map(item=><Choice key={item.id} label={`${selected.includes(item.id)?'✓ ':'○ '}${item.type} · ${formatDate(item.timestamp,locale)}`} active={selected.includes(item.id)} onPress={()=>setSelected(current=>current.includes(item.id)?current.filter(id=>id!==item.id):[...current,item.id].slice(0,50))}/>) || <Text>{t.empty}</Text>}<Toggle label="One-time permission: send only selected owned activity" value={aiConsent} onValueChange={setAIConsent}/><Button label="Create reviewable AI draft" disabled={!aiConsent||selected.length===0||!data?.profile.privacy.allowAiActivityContext} onPress={()=>void runAI()}/>{!data?.profile.privacy.allowAiActivityContext?<Text style={s.warning}>Enable AI activity context in Privacy first.</Text>:null}</Card>{aiJob?<Card><Text style={s.item}>{aiJob.kind} · {aiJob.status}</Text><Text style={s.source}>{aiJob.provider} · {aiJob.model||'model not reported'} · {aiJob.estimatedCost}</Text><Text selectable style={s.mono}>{JSON.stringify(aiJob.result||aiJob.progress||aiJob.error||{},null,2)}</Text><View style={s.actions}>{aiJob.status==='running'?<><Button label="Refresh stream status" onPress={()=>void pollAI()}/><Button label="Cancel" onPress={()=>void api?.cancelAI(aiJob.id).then(setAIJob).catch(value=>setError(messageOf(value)))}/></>:null}{aiJob.status==='ready'?<><Button label={t.approve} onPress={()=>void decideAI('apply')}/><Button label={t.reject} onPress={()=>void decideAI('reject')}/></>:null}</View></Card>:null}</>;
  const settingsView=<><Card><Text style={s.big}>{t.settings}</Text><Text style={s.label}>{t.language}</Text><ScrollView horizontal contentContainerStyle={s.choices}><Choice label="system" active={settings.locale==='system'} onPress={()=>void persist({...settings,locale:'system'})}/>{locales.map(code=><Choice key={code} label={code} active={settings.locale===code} onPress={()=>void persist({...settings,locale:code})}/>)}</ScrollView><Text style={s.label}>{t.aiLanguage}</Text><ScrollView horizontal contentContainerStyle={s.choices}>{locales.map(code=><Choice key={code} label={code} active={settings.aiLocale===code} onPress={()=>void persist({...settings,aiLocale:code})}/>)}</ScrollView><Text style={s.label}>Finance Gateway URL</Text><TextInput value={settings.apiBase} onChangeText={value=>void persist({...settings,apiBase:value})} autoCapitalize="none" keyboardType="url" accessibilityLabel="Finance Gateway URL" style={s.input}/></Card><Card><Text style={s.big}>{t.privacy}</Text><Toggle label="Include verified Pay receipts in reports" value={Boolean(data?.profile.privacy.includePayInStatements)} onValueChange={value=>void updatePrivacy('includePayInStatements',value)}/><Toggle label="Allow selected owned activity as AI context" value={Boolean(data?.profile.privacy.allowAiActivityContext)} onValueChange={value=>void updatePrivacy('allowAiActivityContext',value)}/><Toggle label="Enable informational security alerts" value={Boolean(data?.profile.privacy.alertsEnabled)} onValueChange={value=>void updatePrivacy('alertsEnabled',value)}/><Text style={s.legal}>Offline evidence cache, language, pending Wallet request, device proof and session use platform secure storage. Wallet recovery material is never requested. Sign-out removes the local Finance session.</Text></Card><Card><Text style={s.big}>Support, disputes and audit</Text><View style={s.actions}><Button label="Help" onPress={()=>void openReviewed(data?.support.helpUrl)}/><Button label="Privacy policy" onPress={()=>void openReviewed(data?.support.privacyUrl)}/><Button label="Dispute entry" onPress={()=>void openReviewed(data?.support.disputeUrl)}/><Button label="Load account audit" onPress={()=>void api?.audit().then(value=>setAudit(value.events)).catch(value=>setError(messageOf(value)))}/><Button label={t.exportData} onPress={()=>void copyExport('json')}/><Button label={t.importData} onPress={()=>void importData()}/><Button label="Sign out" onPress={()=>void(async()=>{await clearToken();setSession(null);setData(null);setAudit([])})()}/></View>{audit.length?<Text selectable style={s.mono}>{JSON.stringify(audit,null,2)}</Text>:null}</Card><Card><Text style={s.legal}>{t.legal}</Text><Text style={s.source}>Recovery: retry live sources; if unavailable, the last encrypted local snapshot stays explicitly marked non-live. Planning state is server-persisted and exportable; Explorer/Pay evidence is never restored from import.</Text></Card></>;

  const content=()=>{if(!session)return signedOut;if(busy&&!data)return <ActivityIndicator color="#002FA7"/>;switch(tab){case'overview':return overview;case'activity':return activity;case'plan':return plan;case'statements':return statements;case'ai':return ai;default:return settingsView}};
  return <SafeAreaProvider><SafeAreaView style={[s.root,rtl&&s.rtl]}><StatusBar style="dark"/><View style={[s.header,rtl&&s.reverse]}><Text style={s.brand}>{t.title}</Text><Text style={s.badge}>READ ONLY</Text></View>{cached?<Text style={s.offline}>{t.offline}</Text>:null}{error?<View style={s.error}><Text selectable>{error}</Text><View style={s.actions}><Button label={t.retry} onPress={()=>void refresh()}/>{cached?<Button label="Keep offline snapshot" onPress={()=>setError('')}/>:null}</View></View>:null}<ScrollView contentContainerStyle={s.content}>{content()}</ScrollView>{session?<ScrollView horizontal style={s.nav} contentContainerStyle={s.navin}>{tabs.map(item=><Choice key={item} label={t[item]} active={tab===item} onPress={()=>setTab(item)}/>)}</ScrollView>:null}</SafeAreaView></SafeAreaProvider>;
}

function Button({label,onPress,disabled=false}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[s.button,disabled&&s.disabled]}><Text style={s.buttonText}>{label}</Text></Pressable>}
function Choice({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}){return <Pressable accessibilityRole="button" accessibilityState={{selected:active}} accessibilityLabel={label} onPress={onPress} style={[s.choice,active&&s.choiceOn]}><Text style={[s.choiceText,active&&s.choiceTextOn]}>{label}</Text></Pressable>}
function Toggle({label,value,onValueChange}:{label:string;value:boolean;onValueChange:(value:boolean)=>void}){return <View style={s.toggle}><Text style={s.toggleLabel}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onValueChange} trackColor={{true:'#002FA7'}}/></View>}
function Card({children}:{children:React.ReactNode}){return <View style={s.card}>{children}</View>}
function Link({label,onPress}:{label:string;onPress:()=>void}){return <Pressable accessibilityRole="link" onPress={onPress}><Text style={s.link}>{label}</Text></Pressable>}
function Source({unavailable,name,value}:{unavailable:string;name:string;value:Overview['portfolio']['explorerStatus']|undefined}){return <Card><Text style={s.item}>{name} · {value?.available?'Available':unavailable}</Text><Text style={s.source}>{value?.source||'not configured'} · {value?.coverage||value?.error||'No unsupported data inferred'}</Text></Card>}

const s=StyleSheet.create({root:{flex:1,backgroundColor:'#F5F7FB'},rtl:{direction:'rtl'},header:{padding:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:'white',borderBottomWidth:1,borderColor:'#E4E7EC'},reverse:{flexDirection:'row-reverse'},brand:{fontSize:21,fontWeight:'800',color:'#002FA7'},badge:{fontSize:11,fontWeight:'800',color:'#002FA7'},content:{padding:16,paddingBottom:100,gap:12},card:{backgroundColor:'white',borderRadius:18,padding:18,gap:12,borderWidth:1,borderColor:'#E4E7EC'},big:{fontSize:23,fontWeight:'800',color:'#101828'},label:{fontSize:13,fontWeight:'700',color:'#475467'},balance:{fontSize:38,fontWeight:'900',color:'#101828'},legal:{fontSize:14,lineHeight:21,color:'#475467'},source:{fontSize:12,lineHeight:18,color:'#667085'},item:{fontSize:15,fontWeight:'700',color:'#101828'},entry:{paddingVertical:12,borderBottomWidth:1,borderColor:'#EAECF0',gap:8},row:{flexDirection:'row',justifyContent:'space-between',gap:12},flex:{flex:1},button:{backgroundColor:'#002FA7',paddingHorizontal:16,paddingVertical:12,borderRadius:12,alignItems:'center'},disabled:{opacity:.45},buttonText:{color:'white',fontWeight:'800'},actions:{gap:8},choices:{gap:7},input:{borderWidth:1,borderColor:'#D0D5DD',borderRadius:12,padding:12,color:'#101828',textAlign:I18nManager.isRTL?'right':'left'},mono:{fontFamily:'monospace',fontSize:11,lineHeight:17,color:'#344054'},offline:{backgroundColor:'#FFF4E5',padding:9,textAlign:'center',color:'#7A2E0E'},warning:{backgroundColor:'#FFF4E5',padding:10,color:'#7A2E0E',borderRadius:10},error:{margin:12,padding:12,backgroundColor:'#FEE4E2',borderRadius:12,gap:8},nav:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'white',borderTopWidth:1,borderColor:'#E4E7EC'},navin:{padding:10,gap:7},choice:{paddingHorizontal:13,paddingVertical:9,borderRadius:999,backgroundColor:'#EEF2F6'},choiceOn:{backgroundColor:'#002FA7'},choiceText:{fontSize:12,fontWeight:'700',color:'#344054'},choiceTextOn:{color:'white'},toggle:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},toggleLabel:{flex:1,fontSize:14,lineHeight:20,color:'#344054'},link:{color:'#002FA7',fontWeight:'700',textDecorationLine:'underline'}});
