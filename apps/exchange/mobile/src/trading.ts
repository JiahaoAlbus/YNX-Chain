import type {ExchangeOrderActionResponse} from "@ynx-chain/wallet-auth";

export type TradingRequest=Readonly<{path:string;body:Readonly<Record<string,unknown>>}>;

export function tradingRequest(action:ExchangeOrderActionResponse):TradingRequest{
 switch(action.action){
  case"exchange.order.place":return{path:"/v1/orders",body:{...action.parameters,walletSignature:action.walletSignature}};
  case"exchange.order.cancel":return{path:`/v1/orders/${encodeURIComponent(action.parameters.orderId)}/cancel`,body:{idempotencyKey:action.parameters.idempotencyKey,walletSignature:action.walletSignature}};
  case"exchange.margin.transfer":return{path:"/v1/margin/transfer",body:{...action.parameters,walletSignature:action.walletSignature}};
  case"exchange.perpetual.order.place":return{path:"/v1/perpetual/orders",body:{...action.parameters,walletSignature:action.walletSignature}};
  case"exchange.perpetual.order.cancel":return{path:`/v1/perpetual/orders/${encodeURIComponent(action.parameters.orderId)}/cancel`,body:{idempotencyKey:action.parameters.idempotencyKey,walletSignature:action.walletSignature}};
 }
}
