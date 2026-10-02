import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { setupCopy } from "./i18n/setupCopy";
function fixture(locale="en",os="android"){
 const source=readFileSync(new URL("../App.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("App.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&["Sheet","RecoverySheet","Button","Field","createStyles"].includes(n.name?.text??"")).map(n=>n.getText(ast)).join("\n");
 let visible=false;const listeners=new Map<string,()=>void>(),cleanups:Array<()=>void>=[],calls:any[]=[];
 const ctx:any={React:{createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children})},useContext:()=>locale,useRef:(current:any)=>({current}),useCallback:(fn:any)=>fn,useEffect:(fn:any)=>{const end=fn();if(end)cleanups.push(end)},WalletLocaleContext:{},Keyboard:{isVisible:()=>visible,addListener:(event:string,fn:()=>void)=>{listeners.set(event,fn);return{remove:()=>listeners.delete(event)}}},Platform:{OS:os,select:(values:any)=>values[os]},StyleSheet:{create:(v:any)=>v,hairlineWidth:1},ACTIVE_COLORS:{ink:"black",line:"gray",white:"white"},setupCopy,translate:()=>"Close",preventScreenCaptureAsync:async()=>{},allowScreenCaptureAsync:async()=>{}};
 for(const name of ["View","Text","Pressable","X","TextInput","ScrollView","SafeAreaView","KeyboardAvoidingView"])ctx[name]=name;
 runInNewContext(ts.transpile(`${functions}\nconst styles=createStyles();globalThis.api={Sheet,RecoverySheet,Button,styles};`,{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}),ctx);
 return {...ctx.api,listeners,cleanups,calls,show:()=>{visible=true;listeners.get("keyboardDidShow")?.()}};
}
for(const os of ["android","ios"])test(`${os}: focusing backup input scrolls only body, preserving header and action`,()=>{
 const f=fixture("en",os);let saves=0,closes=0;
 const recovery=f.RecoverySheet({pending:{secretHex:"synthetic-fixture",label:"fixture"},confirmation:"BACKED UP",setConfirmation:()=>{},busy:false,error:null,save:()=>saves++,close:()=>closes++});
 const sheet=f.Sheet({...recovery.props,children:recovery.children});const [header,body,footer]=sheet.children[0].children;
 assert.equal(header.type,"View");assert.equal(body.type,"ScrollView");assert.equal(footer.type,"View");assert.equal(body.children[0],recovery.children);
 assert.equal(header.children[0].children[0],setupCopy("en","backupTitle"));
 body.props.ref.current={scrollResponderScrollNativeHandleToKeyboard:(...args:any[])=>f.calls.push(args)};
 body.props.onFocus({nativeEvent:{target:17}});assert.equal(f.calls.length,0);f.show();sheet.props.onLayout();assert.equal(f.calls.length,2);assert.equal(f.calls[0][0],17);
 assert.equal(saves,0);const button=f.Button(footer.children[0].props);assert.equal(button.props.disabled,false);button.props.onPress();assert.equal(saves,1);
 header.children[1].props.onPress();assert.equal(closes,1);body.props.onBlur({nativeEvent:{target:17}});sheet.props.onLayout();assert.equal(f.calls.length,2);
 for(const end of f.cleanups)end();assert.equal(f.listeners.size,0);
 assert.equal(f.styles.sheetHeader.flexShrink,0);assert.equal(f.styles.sheetActions.flexShrink,0);assert.equal(f.styles.sheetViewport.minHeight,0);assert.ok(f.styles.iconButton.width>=44);assert.equal(header.children[0].props.numberOfLines,undefined);
});
for(const locale of ["en","zh-Hans"] as const)test(`${locale}: persistent save action retains confirmation and busy guards`,()=>{
 const f=fixture(locale);let saves=0;
 for(const [confirmation,busy,disabled] of [["",false,true],["BACKED UP",true,true],["BACKED UP",false,false]] as const){
  const recovery=f.RecoverySheet({pending:{secretHex:"synthetic-fixture",label:"fixture"},confirmation,setConfirmation:()=>{},busy,error:"fixture-error",save:()=>saves++,close:()=>{}});
  assert.equal(recovery.props.actions.props.disabled,disabled);assert.equal(recovery.props.actions.props.label,setupCopy(locale,"save"));assert.equal(saves,0);assert.ok(recovery.children.some((c:any)=>c?.props?.accessibilityRole==="alert"));
 }
});
