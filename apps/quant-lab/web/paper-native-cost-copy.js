// Product-only explanations of the original engine's versioned simulation model.
const rows={
 en:['Simulated fee (bps)','Simulated adverse slippage (bps)','Simulation assumptions, not venue fees. Market is read at submission, not an executable quote; fills are capped at 10% of source volume. Buy price/notional round up; sell price/notional round down. Fees round up on actual fills. No gas, real funds or guaranteed fill. Exact cost amounts are returned in the receipt.'],
 'zh-CN':['模拟手续费（基点）','模拟不利滑点（基点）','这些是模拟假设，不是交易场所收费。提交时读取行情，非可执行报价；成交上限为来源成交量的10%。买价及买入金额向上取整，卖价及卖出金额向下取整，手续费按实际成交向上取整。不含Gas、真钱或成交保证，实际成本见回执。'],
 'zh-TW':['模擬手續費（基點）','模擬不利滑價（基點）','這是模擬假設，非交易場所收費。提交時讀行情，非可執行報價；成交上限為來源成交量的10%。買價及金額向上取整，賣價及金額向下取整，費用按實際成交向上取整。不含Gas、真實資金或成交保證，成本見回執。'],
 ja:['模擬手数料（bps）','模擬不利スリッページ（bps）','取引所の料金ではなく模擬条件。市場は送信時に読み、執行見積りではありません。出来高10%上限。買価格・金額は切上げ、売価格・金額は切下げ、実際の約定手数料は切上げ。ガス・実資金・約定保証なし。コストは記録を参照。'],
 ko:['모의 수수료(bps)','모의 불리한 슬리피지(bps)','거래소 요금 아닌 모의 가정입니다. 제출 시 시장을 읽으며 실행 견적이 아닙니다. 원천 거래량 10% 한도. 매수 가격·금액 올림, 매도 내림, 실제 체결 수수료 올림. 가스·실제 자금·체결 보장 없음. 비용은 기록에 표시됩니다.'],
 es:['Comisión simulada (bps)','Deslizamiento adverso simulado (bps)','Supuestos, no tarifas del mercado. Mercado al enviar, sin cotización ejecutable; límite 10% del volumen fuente. Compra redondea precio/importe arriba, venta abajo; comisión arriba sobre ejecución real. Sin gas, fondos reales ni garantía. Costes en el recibo.'],
 fr:['Frais simulés (bps)','Glissement défavorable simulé (bps)','Hypothèses, pas tarifs du marché. Marché à l’envoi, sans cotation exécutable ; plafond 10% du volume source. Achat arrondi en haut, vente en bas ; frais en haut sur exécution réelle. Sans gaz, fonds réels ni garantie. Coûts dans le reçu.'],
 de:['Simulierte Gebühr (bps)','Simulierte ungünstige Slippage (bps)','Annahmen, keine Börsengebühren. Markt beim Senden, kein ausführbares Angebot; 10% Quellvolumen-Limit. Kaufkurs/-betrag auf-, Verkauf abgerundet, Gebühren auf tatsächliche Füllung aufgerundet. Kein Gas, echtes Geld oder Garantie. Kosten im Beleg.'],
 pt:['Taxa simulada (bps)','Slippage adverso simulado (bps)','Hipóteses, não tarifas da corretora. Mercado ao enviar, sem cotação executável; limite 10% do volume fonte. Compra arredonda preço/valor acima, venda abaixo; taxas acima sobre execução real. Sem gás, fundos reais ou garantia. Custos no recibo.'],
 ru:['Симуляционная комиссия (bps)','Невыгодное проскальзывание (bps)','Допущения, не тарифы биржи. Рынок при отправке, без исполняемой котировки; лимит 10% исходного объёма. Покупка округляется вверх, продажа вниз; комиссия вверх с фактического исполнения. Без газа, реальных средств или гарантии. Затраты в квитанции.'],
 ar:['رسوم المحاكاة (bps)','انزلاق معاكس محاكى (bps)','افتراضات وليست رسوم منصة. السوق عند الإرسال وليس عرضا قابلا للتنفيذ؛ حد 10% من حجم المصدر. تقريب سعر وقيمة الشراء للأعلى والبيع للأسفل والرسوم للأعلى على التنفيذ الفعلي. دون غاز أو أموال حقيقية أو ضمان تنفيذ. التكاليف في الإيصال.'],
 id:['Biaya simulasi (bps)','Slippage merugikan simulasi (bps)','Asumsi, bukan tarif bursa. Pasar saat pengiriman, bukan kuotasi eksekusi; batas 10% volume sumber. Harga/nilai beli dibulatkan atas, jual bawah, biaya atas pada pengisian aktual. Tanpa gas, dana nyata atau jaminan. Biaya dalam tanda terima.'],
};
export function paperNativeCostCopy(language){const [fee,slippage,boundary]=rows[language]||rows.en;return {fee,slippage,boundary};}
const backtests={
 en:'Simulated research only. Review the captured strategy and fee/slippage assumptions below. The original engine reads source history and reports costs, benchmark and risk metrics. Not a live order, return guarantee, Testnet execution or scheduling permission.',
 'zh-CN':'仅供模拟研究。请核对下方策略与手续费/滑点假设。原引擎读取来源历史并报告成本、基准与风险指标，不是实盘订单、收益保证、测试网执行或调度授权。',
 'zh-TW':'僅供模擬研究。請核對下方策略及費用/滑價假設。原引擎讀取來源歷史並報告成本、基準與風險指標，非實盤訂單、收益保證、Testnet執行或排程授權。',
 ja:'模擬研究のみ。下記の戦略・手数料・スリッページ条件を確認。元のエンジンが履歴からコスト・基準・リスクを計算。実注文、利益保証、Testnet実行、定期実行権限ではありません。',
 ko:'모의 연구 전용. 아래 전략·수수료·슬리피지 가정을 검토하세요. 기존 엔진이 원천 기록으로 비용·벤치마크·위험을 보고합니다. 실거래·수익 보장·Testnet 실행·예약 권한이 아닙니다.',
 es:'Solo investigación simulada. Revisa estrategia y supuestos de comisión/deslizamiento. El motor original lee el historial y reporta costes, referencia y riesgos. No es orden real, garantía, ejecución Testnet ni permiso de programación.',
 fr:'Recherche simulée uniquement. Vérifiez stratégie et hypothèses de frais/glissement. Le moteur original lit l’historique et rapporte coûts, référence et risques. Ni ordre réel, garantie, exécution Testnet ou autorisation de planifier.',
 de:'Nur simulierte Forschung. Strategie und Gebühren-/Slippage-Annahmen prüfen. Original-Engine liest Historie und meldet Kosten, Benchmark und Risiken. Kein Live-Auftrag, Garantie, Testnet-Ausführung oder Planungsrecht.',
 pt:'Somente pesquisa simulada. Revise estratégia e hipóteses de taxas/slippage. O motor original lê histórico e informa custos, referência e riscos. Não é ordem real, garantia, execução Testnet ou permissão de agendamento.',
 ru:'Только симуляционное исследование. Проверьте стратегию и комиссии/проскальзывание. Исходный движок читает историю и сообщает затраты, эталон и риски. Не реальный ордер, гарантия, Testnet или разрешение расписания.',
 ar:'بحث محاكى فقط. راجع الاستراتيجية وافتراضات الرسوم والانزلاق أدناه. يقرأ المحرك الأصلي التاريخ ويعرض التكاليف والمعيار والمخاطر. ليس أمرا حقيقيا أو ضمانا أو تنفيذ Testnet أو إذن جدولة.',
 id:'Hanya riset simulasi. Tinjau strategi dan asumsi biaya/slippage. Mesin asli membaca riwayat dan melaporkan biaya, benchmark dan risiko. Bukan order nyata, jaminan, eksekusi Testnet atau izin penjadwalan.',
};
export function paperNativeBacktestBoundary(language){return backtests[language]||backtests.en;}
