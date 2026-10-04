import {Pressable,StyleSheet,Text,View} from "react-native";
import type {WalletLocale} from "../i18n/i18n";
import {COLORS} from "../theme";
import type {WalletPayReview,WalletPayAction} from "./walletPayReview";

/** Presentation only. The hosting payment sheet owns protected authorization,
 * selected-account cancellation, session readiness and the original outbox. */
export function WalletPayReviewCard({review,locale,busy,onAction}:{review:WalletPayReview;locale:WalletLocale;busy:boolean;onAction:(action:WalletPayAction)=>void}){
  const c=(en:string,zh:string)=>locale.startsWith("zh")?zh:en;
  const notices:Record<WalletPayReview["state"],string>={
    review:c("Review the merchant, recipient, amount and fee. Nothing has been signed.","请核对商家、收款地址、金额和手续费，尚未签署付款。"),
    invoice_unavailable:c("This invoice is not available for a new payment.","此发票当前不可发起新的付款。"),
    other_transfer_pending:c("Review your existing transfer before starting another payment.","请先确认现有转账，再发起另一笔付款。"),
    original_unavailable:c("The original payment record is unavailable. Keep the invoice and transaction hash; do not pay again.","原付款记录暂不可用。请保留发票与交易哈希，不要再次付款。"),
    transfer_unconfirmed:c("The original transaction may already have been submitted. Check that transaction; do not create a replacement.","原交易可能已提交。请查询原交易，不要另建一笔替代付款。"),
    settlement_pending:c("The original transfer has a verified local checkpoint. The invoice settlement is not yet confirmed; recovery uses the same payment.","原转账已有经核对的本地检查点，但发票结算尚未确认。恢复将继续使用原付款。"),
    settled:c("The settlement matches this invoice and the original transaction. Save its receipt before starting another payment.","结算结果与此发票和原交易一致。请保存收据后再发起下一笔付款。"),
  };
  const labels:Record<WalletPayAction,string>={pay:c("Confirm reviewed payment","确认这笔付款"),check:c("Check original transaction","查询原交易"),settle:c("Confirm invoice settlement","确认发票结算"),done:c("Save receipt and finish","保存收据并完成")};
  const rows=[
    [c("Merchant","商家"),review.invoice.merchant],[c("Invoice","发票"),review.invoice.id],
    [c("Paying account","付款账户"),review.account],[c("Recipient","收款地址"),review.invoice.payoutAddress],
    [c("Amount","金额"),`${review.invoice.amount} YNXT`],[c("Network fee","网络手续费"),"1 YNXT"],
    [c("Total","合计"),`${review.invoice.amount+1} YNXT`],[c("Expires","到期时间"),review.invoice.dueAt],
  ];
  if(review.hash)rows.push([c("Original transaction","原交易"),review.hash]);
  return <View style={s.card}>
    <Text style={s.title}>{c("Pay invoice","支付发票")}</Text>
    {rows.map(([label,value])=><View style={s.row} key={label}><Text style={s.label}>{label}</Text><Text selectable style={s.value}>{value}</Text></View>)}
    <Text accessibilityRole="alert" style={s.notice}>{notices[review.state]}</Text>
    <Text style={s.note}>{c("YNX Testnet · whole YNXT · local checkpoint is not consensus finality.","YNX 测试网 · 整数 YNXT · 本地检查点不代表共识最终确认。")}</Text>
    {review.actions.map(action=><Pressable key={action} accessibilityRole="button" accessibilityLabel={labels[action]} accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>onAction(action)} style={[s.button,busy&&s.disabled]}><Text style={s.buttonText}>{labels[action]}</Text></Pressable>)}
  </View>;
}
const s=StyleSheet.create({card:{gap:12,width:"100%"},title:{color:COLORS.ink,fontSize:24,fontWeight:"700"},
  row:{gap:5,paddingVertical:9,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:COLORS.line},
  label:{color:COLORS.muted,fontSize:13},value:{color:COLORS.ink,fontSize:15,lineHeight:22},
  notice:{color:COLORS.ink,fontSize:15,lineHeight:23,backgroundColor:COLORS.surface,padding:16,borderRadius:14},
  note:{color:COLORS.muted,fontSize:12,lineHeight:19},button:{minHeight:50,padding:16,borderRadius:12,backgroundColor:COLORS.blue,alignItems:"center",justifyContent:"center"},
  buttonText:{color:COLORS.white,fontSize:15,fontWeight:"700",textAlign:"center"},disabled:{opacity:.45}});
