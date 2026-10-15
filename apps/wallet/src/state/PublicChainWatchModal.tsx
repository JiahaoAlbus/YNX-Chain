import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import QRCodeView from 'react-native-qrcode-svg';
import type {WalletOperationLifecycle} from '../security/operationLifecycle';
import type {SecureStorageAdapter} from '../storage/walletRepository';
import {PublicChainWatchController,PublicWatchStore,type PublicWatchAddress,type PublicWatchSnapshot} from './publicChainWatch';

type Props={account:string;operations:WalletOperationLifecycle;storage:Pick<SecureStorageAdapter,'getItem'|'setItem'>;locale:string;textScale:number;colors:{ink:string;blue:string;white:string};close:()=>void};
const EMPTY:PublicWatchSnapshot={phase:'idle',entries:[],selected:null,result:null,error:null};
const NETWORKS={bitcoin:['mainnet','testnet3','testnet4','signet'],tron:['mainnet','shasta','nile']} as const;
export function PublicChainWatchModal({account,operations,storage,locale,textScale,colors,close}:Props){
  const zh=locale.startsWith('zh'),c=(en:string,cn:string)=>zh?cn:en;
  const controller=useRef<PublicChainWatchController|null>(null),view=useRef({active:true,dismissed:false}),closeRef=useRef(close);closeRef.current=close;
  const [snapshot,setSnapshot]=useState<PublicWatchSnapshot>(EMPTY);
  const [draft,setDraft]=useState({family:'bitcoin' as 'bitcoin'|'tron',network:'mainnet',label:'',address:'',rpcURL:'',genesisBlockId:'',contract:''});
  const dismiss=()=>{if(!view.current.active||view.current.dismissed)return;view.current.dismissed=true;controller.current?.close();closeRef.current()};
  useEffect(()=>{
    view.current.active=true;if(view.current.dismissed)return()=>{view.current.active=false};
    const current=new PublicChainWatchController(operations,account,new PublicWatchStore(storage));controller.current=current;setSnapshot(current.snapshot());
    const unsubscribe=current.subscribe(next=>{if(controller.current!==current||!view.current.active||view.current.dismissed)return;if(next.phase==='closed'){dismiss();return}setSnapshot(next)});
    void current.load();return()=>{view.current.active=false;unsubscribe();if(controller.current===current)controller.current=null;current.close()};
  },[operations,account,storage]);
  const edit=(patch:Partial<typeof draft>)=>{controller.current?.edit();setDraft(prior=>({...prior,...patch}))};
  const choose=(entry:PublicWatchAddress,index:number)=>{controller.current?.select(index);setDraft({family:entry.family,network:entry.network,label:entry.label,address:entry.address,rpcURL:entry.rpcURL,genesisBlockId:entry.genesisBlockId??'',contract:entry.contract??''})};
  const save=()=>{void controller.current?.save({family:draft.family,network:draft.network,label:draft.label.trim(),address:draft.address.trim(),rpcURL:draft.rpcURL.trim(),...(draft.family==='tron'?{genesisBlockId:draft.genesisBlockId.trim(),...(draft.contract.trim()?{contract:draft.contract.trim()}: {})}: {})})};
  const busy=['loading','saving','querying'].includes(snapshot.phase),font={color:colors.ink,fontSize:14*textScale};
  const button=(label:string,press:()=>void,disabled=false,selected=false)=><Pressable key={label} accessibilityRole="button" accessibilityState={{disabled,selected}} disabled={disabled} onPress={press} style={[styles.button,{borderColor:colors.blue,opacity:disabled?0.5:1}]}><Text style={[font,{color:colors.blue}]}>{label}</Text></Pressable>;
  const field=(key:'label'|'address'|'rpcURL'|'genesisBlockId'|'contract',label:string,maxLength:number)=><View key={key}><Text style={font}>{label}</Text><TextInput accessibilityLabel={label} value={draft[key]} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="off" maxLength={maxLength} onChangeText={value=>edit({[key]:value})} style={[styles.input,font]}/></View>;
  const result=snapshot.result,selected=snapshot.selected;
  return <Modal visible={!view.current.dismissed} transparent animationType="slide" onRequestClose={dismiss}><View style={styles.overlay}><View style={[styles.sheet,{backgroundColor:colors.white}]}>
    <Text accessibilityRole="header" style={[font,{fontSize:22*textScale}]}>{c('BTC / TRON · watch only','BTC / TRON · 只读观察')}</Text>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={font}>{c('Manually added public addresses are not owned or backed up by this Wallet. No signing or transfers. Confirm that you control an address before receiving funds.','手动添加的公共地址不代表本 Wallet 拥有其私钥，也不随助记词备份恢复。本页不签名、不转账；收款前请确认你确实控制该地址。')}</Text>
      <Text selectable style={font}>{c('Local list belongs to YNX account: ','本机列表所属 YNX 账户：')}{account}</Text>
      {snapshot.entries.map((entry,index)=>button(`${entry.label} · ${entry.family==='bitcoin'?'BTC':'TRON'} / ${entry.network}\n${entry.address}`,()=>choose(entry,index),false,selected===entry))}
      <View style={styles.row}>{button('Bitcoin (BTC)',()=>edit({family:'bitcoin',network:'mainnet',address:'',rpcURL:'',genesisBlockId:'',contract:''}),false,draft.family==='bitcoin')}{button('TRON (TRX)',()=>edit({family:'tron',network:'mainnet',address:'',rpcURL:'',genesisBlockId:'',contract:''}),false,draft.family==='tron')}</View>
      <Text style={font}>{c('Network (explicit configuration required)','网络（必须明确配置）')}</Text><View style={styles.row}>{NETWORKS[draft.family].map(network=>button(network,()=>edit({network,address:'',rpcURL:'',genesisBlockId:''}),false,draft.network===network))}</View>
      {field('label',c('Address label','地址名称'),64)}{field('address',c('Public receiving address (not a private key)','公共收款地址（不要填写私钥）'),128)}
      {field('rpcURL',draft.family==='bitcoin'?c('Trusted HTTPS Esplora API base URL','可信 HTTPS Esplora API 根地址'):c('Trusted HTTPS TRON RPC base URL','可信 HTTPS TRON RPC 根地址'),512)}
      {draft.family==='tron'?<>{field('genesisBlockId',c('Expected genesis block ID (64 hex characters)','预期创世区块 ID（64 位十六进制）'),64)}{field('contract',c('TRC20 contract (optional)','TRC20 合约（可选）'),64)}</>:null}
      {button(c('Save / update watch address','保存／更新观察地址'),save,busy||!draft.label.trim()||!draft.address.trim()||!draft.rpcURL.trim())}
      <Text style={font}>{c('Saved only on this device, isolated by YNX account. A cancelled save may already have reached storage; reopen to check. No RPC defaults are selected.','仅保存在本机，按 YNX 账户隔离。取消已开始的保存可能仍已落盘，可重新打开核对。不预填 RPC。')}</Text>
      {selected?<View style={styles.result}><Text style={font}>{selected.label} · {selected.network}</Text><Text selectable style={font}>{selected.address}</Text>
        <Text style={font}>{c('Watch-address QR only; this does not prove ownership or authorize payment.','仅为观察地址二维码，不证明地址所有权，也不授权付款。')}</Text>
        <View accessibilityLabel={c('Watch public address QR','观察地址二维码')} style={{backgroundColor:'#fff',padding:12,alignSelf:'center'}}><QRCodeView value={selected.address} size={190} color="#000" backgroundColor="#fff"/></View>
        {button(c('Query balance','查询余额'),()=>{void controller.current?.query()},busy)}
      </View>:null}
      {busy?<><ActivityIndicator color={colors.blue}/>{button(c('Cancel current operation','取消当前操作'),()=>controller.current?.cancel())}</>:null}
      {snapshot.error?<Text accessibilityRole="alert" style={[font,{color:'#a11818'}]}>{c('Unavailable — no balance is assumed. Check the address, network, endpoint and genesis. Save failures may be uncertain; reopen to check. Code: ','不可用，不推断余额为零。请核对地址、网络、端点及创世区块。保存失败可能结果未知，可重新打开核对。错误码：')}{snapshot.error}</Text>:null}
      {result?<View style={styles.result}><Text style={font}>{result.family==='bitcoin'?`${result.totalBTC} BTC (${result.totalSats} sat)\n${c('Confirmed','已确认')}: ${result.confirmedBTC} BTC\n${c('Unconfirmed','未确认')}: ${result.unconfirmedBTC} BTC`:`${result.trx.display} TRX (${result.trx.sun} sun)${result.token?`\n${result.token.display} ${result.token.symbol} (${result.token.units} units)`:''}`}</Text>
        <Text selectable style={font}>{result.family==='bitcoin'?result.source:result.source.rpcURL}</Text><Text style={font}>{result.network} · {c('Provider-reported only; not independent network consensus. No transfer capability.','仅为服务商报告，不是独立网络共识验证；无转账能力。')}</Text>
      </View>:null}
    </ScrollView>{button(c('Close','关闭'),dismiss)}
  </View></View></Modal>;
}
const styles=StyleSheet.create({overlay:{flex:1,justifyContent:'center',padding:16,backgroundColor:'#0008'},sheet:{maxHeight:'92%',padding:18,borderRadius:20,gap:10},content:{gap:12,paddingBottom:12},row:{flexDirection:'row',flexWrap:'wrap',gap:8},button:{borderWidth:1,borderRadius:10,padding:12,minHeight:44},input:{borderWidth:1,borderColor:'#9daaca',borderRadius:8,padding:10,minHeight:44,marginTop:5},result:{borderWidth:1,borderColor:'#9daaca',borderRadius:12,padding:12,gap:10}});
