// Input guidance for the existing whole-YNXT Main path only. The original SDK
// remains responsible for uint64 amount+fee range, balances and authorization.
export function nativeAmountDraftIssue(value,zh=false){
 if(typeof value==='string'&&/^[1-9][0-9]*$/.test(value)&&value.length<=20)return null;
 return zh?'当前原生转账仅接受正整数 YNXT（例如 1），不接受小数、指数或前导零；不会转换或舍入金额。':'This native transfer accepts positive whole YNXT only (for example 1), without decimals, exponents or leading zeroes. The amount is never converted or rounded.';
}
