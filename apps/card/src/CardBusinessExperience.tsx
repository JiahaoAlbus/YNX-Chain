import {CoreCardApplicationExperience} from './CoreCardApplicationExperience';
import {TestnetCardOperationsExperience} from './TestnetCardOperationsExperience';
import {CardFundingSendExperience} from './CardFundingSendExperience';
import type {HostedCardApprovalTransport} from './hostedCardApproval';
import React,{useCallback,useEffect,useRef,useState}from 'react';
import{Pressable,StyleSheet,View}from 'react-native';
import type{Locale}from './i18n';
import{CardText as Text}from './cardTypography';
import{CardBusinessClient,CardBusinessError,type CardPrivateIdentity,type CardBusinessSnapshot,type CardStatementView,type CardReconciliationView}from './cardBusinessClient';

const labels:Record<Locale,readonly string[]>={
  en:['Your Testnet records','Read-only sandbox records. Not a bank card or real payment service.','A separate Card private authorization is required.','Loading verified records...','Refresh records','Applications','Testnet cards','YNXT funding intents','No records returned. No card or balance was created.','View statement','Statement / audit','Ledger reconciliation only; no chain verification.','Private records unavailable. Guest exploration and Standard Wallet remain available.','Available YNXT (Testnet only)'],
  'zh-CN':['你的测试网记录','只读沙箱记录。不是银行卡或真实支付服务。','需要单独的 Card 私有授权。','正在读取已验证记录…','刷新记录','申请','测试网卡','YNXT 充值意向','未返回记录。未创建卡或余额。','查看账单','账单与审计','仅账本核对；未验证链上状态。','私有记录暂不可用。访客浏览和标准钱包仍可用。','可用 YNXT（仅测试网）'],
  'zh-TW':['你的測試網記錄','唯讀沙箱記錄。不是銀行卡或真實支付服務。','需要單獨的 Card 私有授權。','正在讀取已驗證記錄…','重新整理','申請','測試網卡','YNXT 儲值意向','未返回記錄。未建立卡或餘額。','查看帳單','帳單與稽核','僅帳本核對；未驗證鏈上狀態。','私人記錄暫不可用。訪客與標準錢包仍可用。','可用 YNXT（僅測試網）'],
  ja:['テストネットの記録','読み取り専用のサンドボックス。銀行カードや実際の決済ではありません。','Card の個別認可が必要です。','検証済み記録を読み込み中…','更新','申請','テストネットカード','YNXT 入金リクエスト','記録はありません。カードや残高は作成されていません。','明細を見る','明細と監査','台帳照合のみ。チェーン検証ではありません。','非公開記録は利用できません。ゲストと標準ウォレットは利用可能です。','利用可能 YNXT（テストネットのみ）'],
  ko:['테스트넷 기록','읽기 전용 샌드박스입니다. 은행 카드나 실제 결제가 아닙니다.','별도의 Card 권한이 필요합니다.','검증된 기록 로딩 중…','새로 고침','신청','테스트넷 카드','YNXT 충전 요청','기록이 없습니다. 카드나 잔액이 생성되지 않았습니다.','명세서 보기','명세서 및 감사','원장 대조만 수행합니다. 체인 검증이 아닙니다.','비공개 기록을 사용할 수 없습니다. 게스트와 표준 지갑은 유지됩니다.','사용 가능 YNXT (테스트넷 전용)'],
  es:['Tus registros Testnet','Registros de sandbox de solo lectura. No es una tarjeta bancaria ni un pago real.','Se requiere autorización privada de Card.','Cargando registros verificados…','Actualizar','Solicitudes','Tarjetas Testnet','Intenciones de depósito YNXT','Sin registros. No se creó ninguna tarjeta ni saldo.','Ver extracto','Extracto y auditoría','Solo conciliación contable; sin verificación de cadena.','Registros privados no disponibles. Invitado y Wallet estándar siguen disponibles.','YNXT disponible (solo Testnet)'],
  fr:['Vos données Testnet','Données de simulation en lecture seule. Ni carte bancaire ni paiement réel.','Une autorisation privée Card est requise.','Chargement des données vérifiées…','Actualiser','Demandes','Cartes Testnet','Intentions de dépôt YNXT','Aucune donnée. Aucune carte ni solde créé.','Voir le relevé','Relevé et audit','Rapprochement comptable uniquement ; aucune vérification de chaîne.','Données privées indisponibles. Invité et Wallet standard restent disponibles.','YNXT disponible (Testnet uniquement)'],
  de:['Ihre Testnet-Daten','Schreibgeschützte Sandbox-Daten. Keine Bankkarte oder echte Zahlung.','Eine separate private Card-Freigabe ist erforderlich.','Verifizierte Daten werden geladen…','Aktualisieren','Anträge','Testnet-Karten','YNXT-Einzahlungsabsichten','Keine Daten. Keine Karte oder Guthaben erstellt.','Auszug ansehen','Auszug und Audit','Nur Buchabgleich; keine Blockchain-Verifizierung.','Private Daten nicht verfügbar. Gast und Standard-Wallet bleiben verfügbar.','Verfügbare YNXT (nur Testnet)'],
  pt:['Seus registros Testnet','Sandbox somente leitura. Não é cartão bancário ou pagamento real.','É necessária autorização privada do Card.','Carregando registros verificados…','Atualizar','Solicitações','Cartões Testnet','Intenções de depósito YNXT','Sem registros. Nenhum cartão ou saldo foi criado.','Ver extrato','Extrato e auditoria','Apenas conciliação contábil; sem verificação da cadeia.','Registros privados indisponíveis. Visitante e Wallet padrão continuam disponíveis.','YNXT disponível (somente Testnet)'],
  ru:['Ваши записи Testnet','Данные песочницы только для чтения. Не банковская карта и не реальные платежи.','Нужно отдельное разрешение Card.','Загрузка проверенных записей…','Обновить','Заявки','Карты Testnet','Заявки пополнения YNXT','Записей нет. Карта и баланс не созданы.','Выписка','Выписка и аудит','Только сверка реестра; без проверки блокчейна.','Приватные записи недоступны. Гостевой режим и стандартный кошелёк доступны.','Доступно YNXT (только Testnet)'],
  ar:['سجلات شبكة الاختبار','سجلات محاكاة للقراءة فقط. ليست بطاقة مصرفية أو دفعاً حقيقياً.','يلزم تفويض خاص منفصل لـ Card.','جارٍ تحميل السجلات المتحقق منها…','تحديث','الطلبات','بطاقات شبكة الاختبار','طلبات إيداع YNXT','لا سجلات. لم تُنشأ بطاقة أو رصيد.','عرض الكشف','الكشف والتدقيق','مطابقة دفتر فقط؛ دون تحقق من السلسلة.','السجلات الخاصة غير متاحة. وضع الضيف والمحفظة القياسية متاحان.','YNXT المتاح (شبكة الاختبار فقط)'],
  id:['Catatan Testnet Anda','Sandbox hanya baca. Bukan kartu bank atau pembayaran nyata.','Otorisasi pribadi Card terpisah diperlukan.','Memuat catatan terverifikasi…','Muat ulang','Permohonan','Kartu Testnet','Permintaan isi saldo YNXT','Tidak ada catatan. Tidak ada kartu atau saldo dibuat.','Lihat laporan','Laporan dan audit','Hanya rekonsiliasi buku; tanpa verifikasi jaringan.','Catatan pribadi tidak tersedia. Tamu dan Wallet standar tetap tersedia.','YNXT tersedia (hanya Testnet)'],
};
function amount(value:string):string{const raw=value.padStart(19,'0');return `${raw.slice(0,-18)}.${raw.slice(-18)}`.replace(/\.?0+$/,'');}
type Props={client:CardBusinessClient|null;identity:CardPrivateIdentity|null;locale:Locale;clientError?:string;providerApprovalTransport?:HostedCardApprovalTransport|null};
type Result={client:CardBusinessClient;key:string;snapshot:CardBusinessSnapshot};
type Detail={client:CardBusinessClient;key:string;statement:CardStatementView;reconciliation:CardReconciliationView};

/** Reads existing owner records only. Standard Wallet access is not a private grant. */
export function CardBusinessExperience({client,identity,locale,clientError,providerApprovalTransport}:Props){
  const copy=labels[locale],key=identity?JSON.stringify([identity.owner,identity.sessionBinding,identity.expiresAt]):'';
  const valid=Boolean(identity&&Date.parse(identity.expiresAt)>Date.now());
  const[result,setResult]=useState<Result|null>(null),[detail,setDetail]=useState<Detail|null>(null);
  const[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
  const sequence=useRef(0),current=useRef({client,key,valid});current.current={client,key,valid};
  const active=(epoch:number)=>epoch===sequence.current&&current.current.client===client&&current.current.key===key&&current.current.valid;
  const errorCode=(error:unknown)=>error instanceof CardBusinessError?error.code:'CARD_API_UNAVAILABLE';
  const refresh=useCallback(async()=>{
    const epoch=++sequence.current;setResult(null);setDetail(null);setFailure('');
    if(!client||!valid){setBusy(false);return;}
    setBusy(true);
    try{const snapshot=await client.state();if(active(epoch))setResult({client,key,snapshot});}
    catch(error){if(active(epoch))setFailure(errorCode(error));}
    finally{if(active(epoch))setBusy(false);}
  },[client,key,valid]);
  useEffect(()=>{void refresh();return()=>{sequence.current++;};},[refresh]);
  const selectCard=async(cardId:string)=>{
    if(!client||!valid)return;
    const epoch=++sequence.current;setDetail(null);setFailure('');setBusy(true);
    try{const[statement,reconciliation]=await Promise.all([client.statement(cardId),client.reconciliation(cardId)]);if(active(epoch))setDetail({client,key,statement,reconciliation});}
    catch(error){if(active(epoch))setFailure(errorCode(error));}
    finally{if(active(epoch))setBusy(false);}
  };
  // Hide the previous owner's data in the render that changes identity, before effects run.
  const snapshot=valid&&result?.client===client&&result.key===key?result.snapshot:null;
  const visibleDetail=valid&&detail?.client===client&&detail.key===key?detail:null;
  const empty=<Text style={s.body}>{copy[8]}</Text>;
  return <View style={s.panel} testID="card-personal-records">
    <Text accessibilityRole="header" style={s.title}>{copy[0]}</Text>
    <Text style={s.body}>{copy[1]}</Text>
    {!valid?<Text style={s.body}>{copy[2]}</Text>:<>
      <Text selectable style={s.identifier}>{identity?.owner}</Text>{client&&identity?<CoreCardApplicationExperience client={client} identity={identity} locale={locale} transport={providerApprovalTransport??null}/>:null}
      <Pressable accessibilityRole="button" accessibilityLabel={copy[4]} disabled={busy||!client} onPress={()=>void refresh()} style={[s.button,(busy||!client)&&s.disabled]}><Text style={s.buttonText}>{copy[4]}</Text></Pressable>
      {busy?<Text accessibilityLiveRegion="polite" style={s.body}>{copy[3]}</Text>:null}
      {failure||clientError?<View accessibilityRole="alert"><Text style={s.body}>{copy[12]}</Text><Text style={s.identifier}>{failure||'CARD_API_SOURCE_UNAVAILABLE'}</Text></View>:null}
      {snapshot?<>
        <Text accessibilityRole="header" style={s.heading}>{copy[5]}</Text>
        {snapshot.applications.length?snapshot.applications.map(app=><View key={app.id} style={s.row}><Text style={s.body}>{app.details.nickname}</Text><Text selectable style={s.identifier}>{app.id} · {app.status}</Text></View>):empty}
        <Text accessibilityRole="header" style={s.heading}>{copy[6]}</Text>
        {snapshot.cards.length?snapshot.cards.map(card=><View key={card.id} style={s.row}><Text style={s.body}>{card.alias}</Text><Text selectable style={s.identifier}>{card.id} · {card.status}</Text><Text style={s.body}>{copy[13]}: {amount(card.balance.availableWei)}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={()=>void selectCard(card.id)} style={s.button}><Text style={s.buttonText}>{copy[9]}</Text></Pressable></View>):empty}
        <Text accessibilityRole="header" style={s.heading}>{copy[7]}</Text>
        {snapshot.intents.length?snapshot.intents.map(intent=><View key={intent.id} style={s.row}><Text selectable style={s.identifier}>{intent.id} · {intent.status}</Text><Text style={s.body}>{amount(intent.amountWei)} YNXT TESTNET · 0x1917</Text><Text selectable style={s.identifier}>{intent.sender} → {intent.recipient}</Text><Text style={s.identifier}>{intent.minConfirmations} · {intent.expiresAt}</Text>{intent.status==='credited'?<Text selectable style={s.identifier}>{intent.txHash}</Text>:client&&identity&&snapshot.cards.some(card=>card.id===intent.cardId&&card.status==='ACTIVE')?<CardFundingSendExperience key={`${key}:${intent.id}`} client={client} identity={identity} intent={intent} locale={locale} onVerified={()=>void refresh()}/>:null}</View>):empty}
      </>:null}
      {visibleDetail?<View style={s.row}><Text accessibilityRole="header" style={s.heading}>{copy[10]}</Text><Text selectable style={s.identifier}>{visibleDetail.statement.card.id}</Text>{visibleDetail.statement.ledger.map(entry=><Text key={String(entry.id)} style={s.identifier}>{String(entry.occurredAt)} · {String(entry.operation)} · {String(entry.reference)}</Text>)}{visibleDetail.statement.events.map(event=><Text key={String(event.id)} style={s.identifier}>{String(event.occurredAt)} · {String(event.name)} · SIMULATION</Text>)}{!visibleDetail.statement.ledger.length&&!visibleDetail.statement.events.length?empty:null}<Text style={s.body}>{copy[11]}</Text><Text style={s.identifier}>{visibleDetail.reconciliation.status} · {visibleDetail.reconciliation.asOf}</Text>{visibleDetail.reconciliation.findings.map((finding,index)=><Text key={index} style={s.identifier}>{finding}</Text>)}{client&&identity?<TestnetCardOperationsExperience key={`${key}:${visibleDetail.statement.card.id}`} client={client} identity={identity} statement={visibleDetail.statement} locale={locale} onUpdated={()=>void refresh()}/>:null}</View>:null}
    </>}
  </View>;
}
const s=StyleSheet.create({panel:{padding:20,borderWidth:1,borderColor:'#DFE3EA',borderRadius:16,backgroundColor:'#FFFFFF',gap:12},title:{fontSize:22,fontWeight:'700',color:'#171A22'},heading:{fontSize:17,fontWeight:'600',color:'#171A22',marginTop:8},body:{fontSize:14,lineHeight:22,color:'#414957'},identifier:{fontSize:12,lineHeight:20,color:'#5B6270',flexShrink:1},row:{padding:14,borderRadius:10,backgroundColor:'#F4F7FF',gap:8},button:{alignSelf:'flex-start',minHeight:44,justifyContent:'center',paddingHorizontal:16,paddingVertical:10,backgroundColor:'#002FA7',borderRadius:8},buttonText:{color:'#FFFFFF',fontSize:14,fontWeight:'600'},disabled:{opacity:0.5}});
