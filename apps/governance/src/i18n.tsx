import React, { createContext, useContext, useMemo, useState } from 'react';

export const supportedLocales = ['en', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'ja', 'ko', 'pt-BR', 'ru', 'ar', 'hi'] as const;
export type Locale = typeof supportedLocales[number];
type Messages = Record<string, string>;

const en: Messages = {
  proposals: 'Proposals', roles: 'Roles', emergency: 'Emergency', docs: 'Docs',
  operatorGuide: 'Operator guide', language: 'Language', resources: 'Resources',
  community: 'Community', documentation: 'Documentation', threatModel: 'Threat Model',
  operations: 'Operations', explorer: 'Explorer',
  description: 'Decentralized governance for YNX Chain protocol parameters, upgrades, and treasury.',
  governanceProposals: 'Governance Proposals', all: 'All', active: 'Active', voting: 'Voting',
  completed: 'Completed', loadingProposals: 'Loading proposals…', failedProposals: 'Failed to fetch proposals',
  unknownError: 'Unknown error', error: 'Error', retry: 'Retry', noProposals: 'No proposals found',
  proposer: 'Proposer', created: 'Created', votingEnds: 'Voting ends', openProposal: 'Open proposal',
  loadingProposal: 'Loading proposal…', failedProposal: 'Failed to fetch proposal',
  proposalNotFound: 'Proposal not found', back: 'Back', backToProposals: 'Back to proposals',
  scope: 'Scope', id: 'ID', votingResults: 'Voting results', yes: 'Yes', no: 'No',
  abstain: 'Abstain', power: 'power', eligiblePower: 'Eligible power', recordedVotes: 'Recorded votes',
  votingActive: 'Voting active',
  signedVoteNotice: 'Votes must be submitted as signed envelopes through an authenticated YNX governance client.',
  votingClosesIn: 'Voting closes in', timelockActive: 'Timelock active',
  timelockNotice: 'This proposal is in its timelock period. Execution allowed in',
  proposalDetails: 'Proposal details', technicalImpact: 'Technical impact', economicImpact: 'Economic impact',
  securityRisk: 'Security risk', migration: 'Migration', rollbackPlan: 'Rollback plan',
  conflictDisclosure: 'Conflict disclosure', conflicts: 'Conflict records', recused: 'Recused',
  notRecused: 'Not recused', parameterChanges: 'Parameter changes', bounds: 'Bounds', none: 'none',
  evidence: 'Evidence and documentation', execution: 'Execution state', manifest: 'Manifest',
  transaction: 'Transaction', block: 'Block', outcome: 'Outcome', auditTrail: 'Audit trail',
  actor: 'Actor', action: 'Action', at: 'At', noRecords: 'No records', expired: 'Expired', notAvailable: 'N/A',
};

const overlays: Record<Exclude<Locale, 'en'>, Messages> = {
  'zh-CN': { proposals:'提案',roles:'角色',emergency:'紧急处置',docs:'文档',operatorGuide:'运维指南',language:'语言',resources:'资源',community:'社区',documentation:'文档',threatModel:'威胁模型',operations:'运维',explorer:'浏览器',description:'YNX Chain 协议参数、升级与金库的去中心化治理。',governanceProposals:'治理提案',all:'全部',active:'进行中',voting:'投票中',completed:'已完成',loadingProposals:'正在加载提案…',failedProposals:'提案加载失败',unknownError:'未知错误',error:'错误',retry:'重试',noProposals:'没有提案',proposer:'提案人',created:'创建时间',votingEnds:'投票截止',openProposal:'打开提案',loadingProposal:'正在加载提案…',failedProposal:'提案加载失败',proposalNotFound:'未找到提案',back:'返回',backToProposals:'返回提案列表',scope:'作用域',id:'编号',votingResults:'投票结果',yes:'赞成',no:'反对',abstain:'弃权',power:'票权',eligiblePower:'可投票权',recordedVotes:'已记录投票',votingActive:'投票进行中',signedVoteNotice:'投票必须通过已认证的 YNX 治理客户端提交签名信封。',votingClosesIn:'距投票截止',timelockActive:'时间锁生效中',timelockNotice:'提案处于时间锁期，可执行时间',proposalDetails:'提案详情',technicalImpact:'技术影响',economicImpact:'经济影响',securityRisk:'安全风险',migration:'迁移方案',rollbackPlan:'回滚方案',conflictDisclosure:'利益冲突披露',conflicts:'冲突记录',recused:'已回避',notRecused:'未回避',parameterChanges:'参数变更',bounds:'边界',none:'无',evidence:'证据与文档',execution:'执行状态',manifest:'清单',transaction:'交易',block:'区块',outcome:'结果',auditTrail:'审计轨迹',actor:'执行者',action:'动作',at:'时间',noRecords:'无记录',expired:'已过期',notAvailable:'不适用'},
  'zh-TW': { proposals:'提案',roles:'角色',emergency:'緊急處置',docs:'文件',operatorGuide:'維運指南',language:'語言',governanceProposals:'治理提案',all:'全部',active:'進行中',voting:'投票中',completed:'已完成',loadingProposals:'正在載入提案…',retry:'重試',noProposals:'沒有提案',proposer:'提案人',created:'建立時間',votingEnds:'投票截止',backToProposals:'返回提案列表',scope:'範圍',votingResults:'投票結果',yes:'贊成',no:'反對',abstain:'棄權',eligiblePower:'可投票權',recordedVotes:'已記錄投票',votingActive:'投票進行中',timelockActive:'時間鎖生效中',proposalDetails:'提案詳情',technicalImpact:'技術影響',economicImpact:'經濟影響',securityRisk:'安全風險',migration:'遷移方案',rollbackPlan:'回滾方案',conflictDisclosure:'利益衝突揭露',conflicts:'衝突記錄',recused:'已迴避',notRecused:'未迴避',parameterChanges:'參數變更',evidence:'證據與文件',execution:'執行狀態',auditTrail:'稽核軌跡',actor:'執行者',action:'動作',at:'時間',expired:'已過期'},
  es: { proposals:'Propuestas',roles:'Roles',emergency:'Emergencia',docs:'Documentos',operatorGuide:'Guía operativa',language:'Idioma',governanceProposals:'Propuestas de gobernanza',all:'Todas',active:'Activas',voting:'Votación',completed:'Completadas',loadingProposals:'Cargando propuestas…',retry:'Reintentar',noProposals:'No hay propuestas',proposer:'Proponente',created:'Creada',votingEnds:'Fin de votación',backToProposals:'Volver a propuestas',scope:'Ámbito',votingResults:'Resultados de votación',yes:'Sí',no:'No',abstain:'Abstención',eligiblePower:'Poder elegible',recordedVotes:'Votos registrados',votingActive:'Votación activa',timelockActive:'Bloqueo temporal activo',proposalDetails:'Detalles de la propuesta',technicalImpact:'Impacto técnico',economicImpact:'Impacto económico',securityRisk:'Riesgo de seguridad',migration:'Migración',rollbackPlan:'Plan de reversión',conflictDisclosure:'Declaración de conflictos',conflicts:'Registros de conflictos',recused:'Apartado',notRecused:'No apartado',parameterChanges:'Cambios de parámetros',evidence:'Pruebas y documentación',execution:'Estado de ejecución',auditTrail:'Registro de auditoría',actor:'Actor',action:'Acción',at:'Fecha',expired:'Caducado'},
  fr: { proposals:'Propositions',roles:'Rôles',emergency:'Urgence',docs:'Docs',operatorGuide:'Guide opérateur',language:'Langue',governanceProposals:'Propositions de gouvernance',all:'Toutes',active:'Actives',voting:'Vote',completed:'Terminées',loadingProposals:'Chargement des propositions…',retry:'Réessayer',noProposals:'Aucune proposition',proposer:'Proposant',created:'Créée',votingEnds:'Fin du vote',backToProposals:'Retour aux propositions',scope:'Périmètre',votingResults:'Résultats du vote',yes:'Oui',no:'Non',abstain:'Abstention',eligiblePower:'Pouvoir éligible',recordedVotes:'Votes enregistrés',votingActive:'Vote actif',timelockActive:'Délai actif',proposalDetails:'Détails de la proposition',technicalImpact:'Impact technique',economicImpact:'Impact économique',securityRisk:'Risque de sécurité',migration:'Migration',rollbackPlan:'Plan de retour',conflictDisclosure:'Déclaration de conflit',conflicts:'Conflits',recused:'Récusé',notRecused:'Non récusé',parameterChanges:'Modifications des paramètres',evidence:'Preuves et documentation',execution:'État d’exécution',auditTrail:'Piste d’audit',actor:'Acteur',action:'Action',at:'Date',expired:'Expiré'},
  de: { proposals:'Vorschläge',roles:'Rollen',emergency:'Notfall',docs:'Dokumente',operatorGuide:'Betriebsleitfaden',language:'Sprache',governanceProposals:'Governance-Vorschläge',all:'Alle',active:'Aktiv',voting:'Abstimmung',completed:'Abgeschlossen',loadingProposals:'Vorschläge werden geladen…',retry:'Erneut versuchen',noProposals:'Keine Vorschläge',proposer:'Antragsteller',created:'Erstellt',votingEnds:'Abstimmungsende',backToProposals:'Zurück zu Vorschlägen',scope:'Bereich',votingResults:'Abstimmungsergebnis',yes:'Ja',no:'Nein',abstain:'Enthaltung',eligiblePower:'Stimmberechtigung',recordedVotes:'Erfasste Stimmen',votingActive:'Abstimmung aktiv',timelockActive:'Zeitsperre aktiv',proposalDetails:'Vorschlagsdetails',technicalImpact:'Technische Auswirkung',economicImpact:'Wirtschaftliche Auswirkung',securityRisk:'Sicherheitsrisiko',migration:'Migration',rollbackPlan:'Rollback-Plan',conflictDisclosure:'Interessenkonflikt',conflicts:'Konflikteinträge',recused:'Ausgeschlossen',notRecused:'Nicht ausgeschlossen',parameterChanges:'Parameteränderungen',evidence:'Nachweise und Dokumentation',execution:'Ausführungsstatus',auditTrail:'Prüfpfad',actor:'Akteur',action:'Aktion',at:'Zeit',expired:'Abgelaufen'},
  ja: { proposals:'提案',roles:'役割',emergency:'緊急対応',docs:'文書',operatorGuide:'運用ガイド',language:'言語',governanceProposals:'ガバナンス提案',all:'すべて',active:'進行中',voting:'投票中',completed:'完了',loadingProposals:'提案を読み込み中…',retry:'再試行',noProposals:'提案はありません',proposer:'提案者',created:'作成日',votingEnds:'投票終了',backToProposals:'提案一覧へ戻る',scope:'範囲',votingResults:'投票結果',yes:'賛成',no:'反対',abstain:'棄権',eligiblePower:'有効投票力',recordedVotes:'記録済み投票',votingActive:'投票中',timelockActive:'タイムロック中',proposalDetails:'提案詳細',technicalImpact:'技術的影響',economicImpact:'経済的影響',securityRisk:'セキュリティリスク',migration:'移行',rollbackPlan:'ロールバック計画',conflictDisclosure:'利益相反の開示',conflicts:'利益相反記録',recused:'回避済み',notRecused:'未回避',parameterChanges:'パラメータ変更',evidence:'証拠と文書',execution:'実行状態',auditTrail:'監査証跡',actor:'実行者',action:'操作',at:'日時',expired:'期限切れ'},
  ko: { proposals:'제안',roles:'역할',emergency:'비상 조치',docs:'문서',operatorGuide:'운영자 안내서',language:'언어',governanceProposals:'거버넌스 제안',all:'전체',active:'진행 중',voting:'투표 중',completed:'완료',loadingProposals:'제안 불러오는 중…',retry:'다시 시도',noProposals:'제안 없음',proposer:'제안자',created:'생성일',votingEnds:'투표 종료',backToProposals:'제안 목록으로',scope:'범위',votingResults:'투표 결과',yes:'찬성',no:'반대',abstain:'기권',eligiblePower:'유효 투표권',recordedVotes:'기록된 투표',votingActive:'투표 진행 중',timelockActive:'타임록 활성',proposalDetails:'제안 상세',technicalImpact:'기술 영향',economicImpact:'경제 영향',securityRisk:'보안 위험',migration:'마이그레이션',rollbackPlan:'롤백 계획',conflictDisclosure:'이해 상충 공개',conflicts:'이해 상충 기록',recused:'회피함',notRecused:'회피 안 함',parameterChanges:'매개변수 변경',evidence:'증거 및 문서',execution:'실행 상태',auditTrail:'감사 추적',actor:'행위자',action:'동작',at:'시간',expired:'만료됨'},
  'pt-BR': { proposals:'Propostas',roles:'Funções',emergency:'Emergência',docs:'Documentos',operatorGuide:'Guia operacional',language:'Idioma',governanceProposals:'Propostas de governança',all:'Todas',active:'Ativas',voting:'Votação',completed:'Concluídas',loadingProposals:'Carregando propostas…',retry:'Tentar novamente',noProposals:'Nenhuma proposta',proposer:'Proponente',created:'Criada',votingEnds:'Fim da votação',backToProposals:'Voltar às propostas',scope:'Escopo',votingResults:'Resultados da votação',yes:'Sim',no:'Não',abstain:'Abstenção',eligiblePower:'Poder elegível',recordedVotes:'Votos registrados',votingActive:'Votação ativa',timelockActive:'Bloqueio temporal ativo',proposalDetails:'Detalhes da proposta',technicalImpact:'Impacto técnico',economicImpact:'Impacto econômico',securityRisk:'Risco de segurança',migration:'Migração',rollbackPlan:'Plano de reversão',conflictDisclosure:'Declaração de conflito',conflicts:'Registros de conflito',recused:'Impedido',notRecused:'Não impedido',parameterChanges:'Alterações de parâmetros',evidence:'Evidências e documentação',execution:'Estado da execução',auditTrail:'Trilha de auditoria',actor:'Ator',action:'Ação',at:'Data',expired:'Expirado'},
  ru: { proposals:'Предложения',roles:'Роли',emergency:'Экстренные меры',docs:'Документы',operatorGuide:'Руководство оператора',language:'Язык',governanceProposals:'Предложения управления',all:'Все',active:'Активные',voting:'Голосование',completed:'Завершённые',loadingProposals:'Загрузка предложений…',retry:'Повторить',noProposals:'Предложений нет',proposer:'Автор',created:'Создано',votingEnds:'Конец голосования',backToProposals:'Назад к предложениям',scope:'Область',votingResults:'Результаты голосования',yes:'За',no:'Против',abstain:'Воздержался',eligiblePower:'Доступный вес',recordedVotes:'Записанные голоса',votingActive:'Голосование активно',timelockActive:'Временная блокировка',proposalDetails:'Детали предложения',technicalImpact:'Техническое влияние',economicImpact:'Экономическое влияние',securityRisk:'Риск безопасности',migration:'Миграция',rollbackPlan:'План отката',conflictDisclosure:'Раскрытие конфликта',conflicts:'Записи конфликтов',recused:'Отведён',notRecused:'Не отведён',parameterChanges:'Изменения параметров',evidence:'Доказательства и документы',execution:'Статус исполнения',auditTrail:'Журнал аудита',actor:'Участник',action:'Действие',at:'Время',expired:'Истекло'},
  ar: { proposals:'المقترحات',roles:'الأدوار',emergency:'الطوارئ',docs:'المستندات',operatorGuide:'دليل التشغيل',language:'اللغة',governanceProposals:'مقترحات الحوكمة',all:'الكل',active:'نشطة',voting:'التصويت',completed:'مكتملة',loadingProposals:'جارٍ تحميل المقترحات…',retry:'إعادة المحاولة',noProposals:'لا توجد مقترحات',proposer:'مقدم المقترح',created:'تاريخ الإنشاء',votingEnds:'نهاية التصويت',backToProposals:'العودة إلى المقترحات',scope:'النطاق',votingResults:'نتائج التصويت',yes:'نعم',no:'لا',abstain:'امتناع',eligiblePower:'قوة التصويت المؤهلة',recordedVotes:'الأصوات المسجلة',votingActive:'التصويت نشط',timelockActive:'القفل الزمني نشط',proposalDetails:'تفاصيل المقترح',technicalImpact:'الأثر التقني',economicImpact:'الأثر الاقتصادي',securityRisk:'المخاطر الأمنية',migration:'الترحيل',rollbackPlan:'خطة التراجع',conflictDisclosure:'الإفصاح عن التعارض',conflicts:'سجلات التعارض',recused:'متنحٍ',notRecused:'غير متنحٍ',parameterChanges:'تغييرات المعلمات',evidence:'الأدلة والمستندات',execution:'حالة التنفيذ',auditTrail:'مسار التدقيق',actor:'الجهة',action:'الإجراء',at:'الوقت',expired:'منتهي'},
  hi: { proposals:'प्रस्ताव',roles:'भूमिकाएँ',emergency:'आपातकाल',docs:'दस्तावेज़',operatorGuide:'संचालक मार्गदर्शिका',language:'भाषा',governanceProposals:'शासन प्रस्ताव',all:'सभी',active:'सक्रिय',voting:'मतदान',completed:'पूर्ण',loadingProposals:'प्रस्ताव लोड हो रहे हैं…',retry:'फिर प्रयास करें',noProposals:'कोई प्रस्ताव नहीं',proposer:'प्रस्तावक',created:'निर्मित',votingEnds:'मतदान समाप्ति',backToProposals:'प्रस्तावों पर लौटें',scope:'दायरा',votingResults:'मतदान परिणाम',yes:'हाँ',no:'नहीं',abstain:'परहेज़',eligiblePower:'पात्र मत शक्ति',recordedVotes:'दर्ज मत',votingActive:'मतदान सक्रिय',timelockActive:'समय लॉक सक्रिय',proposalDetails:'प्रस्ताव विवरण',technicalImpact:'तकनीकी प्रभाव',economicImpact:'आर्थिक प्रभाव',securityRisk:'सुरक्षा जोखिम',migration:'माइग्रेशन',rollbackPlan:'रोलबैक योजना',conflictDisclosure:'हित संघर्ष प्रकटीकरण',conflicts:'संघर्ष रिकॉर्ड',recused:'अलग हुआ',notRecused:'अलग नहीं हुआ',parameterChanges:'पैरामीटर बदलाव',evidence:'साक्ष्य और दस्तावेज़',execution:'निष्पादन स्थिति',auditTrail:'ऑडिट ट्रेल',actor:'कर्ता',action:'कार्रवाई',at:'समय',expired:'समाप्त'},
};

const localeNames: Record<Locale, string> = {
  en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', es: 'Español', fr: 'Français',
  de: 'Deutsch', ja: '日本語', ko: '한국어', 'pt-BR': 'Português (Brasil)', ru: 'Русский',
  ar: 'العربية', hi: 'हिन्दी',
};

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  dir: 'ltr' | 'rtl';
  localeNames: Record<Locale, string>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initialLocale = 'en' }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (key) => overlays[locale as Exclude<Locale, 'en'>]?.[key] ?? en[key] ?? key,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    localeNames,
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used within I18nProvider');
  return value;
}
