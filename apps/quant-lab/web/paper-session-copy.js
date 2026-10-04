// Product UI only. Scope/approval decisions remain the official SDK's.
const keys=['authorize','refresh','revoke','boundary','workspace'];
const rows={
  en:['Authorize my simulated Paper workspace','Refresh my Paper workspace','Revoke Paper workspace access','Simulation only. Separate approval; no real funds, Testnet execution or scheduling.','My native account’s simulated Paper workspace'],
  'zh-CN':['授权我的模拟盘工作区','刷新我的模拟盘工作区','撤销模拟盘工作区授权','仅供模拟；需独立批准，不涉及真钱、测试网执行或自动调度。','本人原生账户的模拟盘工作区'],
  'zh-TW':['授權我的模擬交易工作區','重新整理我的模擬工作區','撤銷模擬工作區授權','僅供模擬；需獨立核准，不涉及真實資金、測試網執行或自動排程。','本人原生帳戶的模擬工作區'],
  ja:['自分のペーパー取引を承認','自分のペーパー取引を更新','ペーパー取引の権限を取り消す','シミュレーション専用。個別承認が必要です。実資金、Testnet実行、定期実行は許可されません。','自分のネイティブアカウントのペーパー取引'],
  ko:['내 모의 거래 작업 공간 승인','내 모의 거래 새로 고침','모의 거래 권한 취소','시뮬레이션 전용입니다. 별도 승인이 필요하며 실제 자금, Testnet 실행 및 예약 실행은 허용되지 않습니다.','내 네이티브 계정의 모의 거래 작업 공간'],
  es:['Autorizar mi espacio Paper simulado','Actualizar mi espacio Paper','Revocar acceso a Paper','Solo simulación. Aprobación separada; sin fondos reales, ejecución Testnet ni programación.','Espacio Paper de mi cuenta nativa'],
  fr:['Autoriser mon espace Paper simulé','Actualiser mon espace Paper','Révoquer l’accès Paper','Simulation uniquement. Approbation distincte ; aucun fonds réel, exécution Testnet ou planification.','Espace Paper simulé de mon compte natif'],
  de:['Meinen simulierten Paper-Bereich autorisieren','Meinen Paper-Bereich aktualisieren','Paper-Zugriff widerrufen','Nur Simulation. Separate Zustimmung; keine echten Mittel, Testnet-Ausführung oder Zeitplanung.','Simulierter Paper-Bereich meines nativen Kontos'],
  pt:['Autorizar meu espaço Paper simulado','Atualizar meu espaço Paper','Revogar acesso ao Paper','Somente simulação. Aprovação separada; sem fundos reais, execução Testnet ou agendamento.','Espaço Paper simulado da minha conta nativa'],
  ru:['Разрешить мой симуляционный Paper','Обновить мой Paper','Отозвать доступ к Paper','Только симуляция. Отдельное одобрение; без реальных средств, операций Testnet и расписания.','Симуляционный Paper моего нативного аккаунта'],
  ar:['تفويض مساحة التداول الورقي الخاصة بي','تحديث مساحة التداول الورقي','إلغاء وصول التداول الورقي','محاكاة فقط. موافقة مستقلة؛ دون أموال حقيقية أو تنفيذ Testnet أو جدولة.','مساحة التداول الورقي لحسابي الأصلي'],
  hi:['मेरे सिम्युलेटेड Paper कार्यक्षेत्र को मंज़ूरी दें','मेरा Paper कार्यक्षेत्र रीफ़्रेश करें','Paper कार्यक्षेत्र की अनुमति रद्द करें','केवल सिम्युलेशन। अलग मंज़ूरी आवश्यक; वास्तविक धन, Testnet निष्पादन या शेड्यूलिंग नहीं।','मेरे नेटिव खाते का सिम्युलेटेड Paper कार्यक्षेत्र'],
  id:['Izinkan ruang Paper simulasi saya','Segarkan ruang Paper saya','Cabut akses ruang Paper','Hanya simulasi. Persetujuan terpisah; tanpa dana nyata, eksekusi Testnet atau penjadwalan.','Ruang Paper simulasi akun native saya'],
};
const labels={en:['Simulated cash','Simulated position'],'zh-CN':['模拟现金','模拟持仓'],'zh-TW':['模擬現金','模擬部位'],ja:['仮想現金','仮想ポジション'],ko:['모의 현금','모의 포지션'],es:['Efectivo simulado','Posición simulada'],fr:['Liquidités simulées','Position simulée'],de:['Simuliertes Guthaben','Simulierte Position'],pt:['Saldo simulado','Posição simulada'],ru:['Симуляционные средства','Симуляционная позиция'],ar:['النقد المحاكى','المركز المحاكى'],hi:['सिम्युलेटेड नकदी','सिम्युलेटेड पोज़िशन'],id:['Kas simulasi','Posisi simulasi']};
export function paperSessionCopy(language){const [cash,position]=labels[language]||labels.en;return {...Object.fromEntries(keys.map((key,index)=>[key,(rows[language]||rows.en)[index]])),cash,position};}
