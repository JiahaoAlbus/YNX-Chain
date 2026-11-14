// Input guidance for the existing whole-YNXT Main path only. The original SDK
// remains responsible for uint64 amount+fee range, balances and authorization.
export const NATIVE_AMOUNT_RANGE_KEY='Maximum amount: 9223372036854775806 YNXT. The total including the fixed fee of 1 YNXT cannot exceed 9223372036854775807 YNXT.';
const maxAmount='9223372036854775806';
export function nativeAmountDraftIssue(value,zh=false){
 if(typeof value==='string'&&/^[1-9][0-9]*$/.test(value)){
  if(value.length>maxAmount.length||value.length===maxAmount.length&&value>maxAmount)return zh?'最高转账金额为 9223372036854775806 YNXT；加上固定手续费 1 YNXT 后，总额不能超过 9223372036854775807 YNXT。':NATIVE_AMOUNT_RANGE_KEY;
  return null;
 }
 return zh?'当前原生转账仅接受正整数 YNXT（例如 1），不接受小数、指数或前导零；不会转换或舍入金额。':'This native transfer accepts positive whole YNXT only (for example 1), without decimals, exponents or leading zeroes. The amount is never converted or rounded.';
}
