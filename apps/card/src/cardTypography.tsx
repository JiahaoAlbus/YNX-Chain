import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {Platform,Pressable,StyleSheet,Text as NativeText,TextInput as NativeTextInput,View,type TextProps,type TextInputProps} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type {Locale} from './i18n';
import {cardTypographyCopy} from './cardTypographyCopy';

export type CardTextSize='compact'|'standard'|'larger';
export const CARD_TEXT_SIZE_KEY='ynx.card.text-size.v1';
const factors:Record<CardTextSize,number>={compact:0.9,standard:1,larger:1.2};
const valid=(value:unknown):value is CardTextSize=>value==='compact'||value==='standard'||value==='larger';
type Context={size:CardTextSize;setSize:(value:CardTextSize)=>void;saveFailed:boolean};
const Typography=createContext<Context>({size:'standard',setSize:()=>{},saveFailed:false});
export const useCardTypography=()=>useContext(Typography);

export function CardTypographyProvider({children}:{children:React.ReactNode}){
  const [size,setValue]=useState<CardTextSize>('standard'),[saveFailed,setSaveFailed]=useState(false);
  const generation=useRef(0),mounted=useRef(false),queue=useRef(Promise.resolve());
  useEffect(()=>{mounted.current=true;const token=generation.current;
    void(async()=>{try{const value=Platform.OS==='web'?window.localStorage.getItem(CARD_TEXT_SIZE_KEY):await SecureStore.getItemAsync(CARD_TEXT_SIZE_KEY);if(mounted.current&&generation.current===token&&valid(value))setValue(value)}catch{/* Keep the safe standard default. */}})();
    return()=>{mounted.current=false};
  },[]);
  const setSize=(value:CardTextSize)=>{
    if(!valid(value))return;const token=++generation.current;setValue(value);setSaveFailed(false);
    queue.current=queue.current.catch(()=>{}).then(async()=>{try{
      if(Platform.OS==='web'){window.localStorage.setItem(CARD_TEXT_SIZE_KEY,value);if(window.localStorage.getItem(CARD_TEXT_SIZE_KEY)!==value)throw Error('PREFERENCE_NOT_SAVED')}
      else{await SecureStore.setItemAsync(CARD_TEXT_SIZE_KEY,value);if(await SecureStore.getItemAsync(CARD_TEXT_SIZE_KEY)!==value)throw Error('PREFERENCE_NOT_SAVED')}
      if(mounted.current&&generation.current===token)setSaveFailed(false);
    }catch{if(mounted.current&&generation.current===token)setSaveFailed(true)}});
  };
  return <Typography.Provider value={{size,setSize,saveFailed}}>{children}</Typography.Provider>;
}

function scaledStyle(style:TextProps['style'],size:CardTextSize){
  const flat=StyleSheet.flatten(style)??{},factor=factors[size];
  return {fontSize:(typeof flat.fontSize==='number'?flat.fontSize:14)*factor,
    ...(typeof flat.lineHeight==='number'?{lineHeight:flat.lineHeight*factor}:{})};
}
export type CardText=NativeText;
export const CardText=React.forwardRef<NativeText,TextProps>(function CardText({style,...props},ref){
  const {size}=useCardTypography();
  return <NativeText {...props} ref={ref} allowFontScaling={props.allowFontScaling??true} style={[style,scaledStyle(style,size)]}/>;
});
export const CardTextInput=React.forwardRef<NativeTextInput,TextInputProps>(function CardTextInput({style,...props},ref){
  const {size}=useCardTypography();
  return <NativeTextInput {...props} ref={ref} allowFontScaling={props.allowFontScaling??true} style={[style,scaledStyle(style,size)]}/>;
});

export function CardTextSizeSettings({locale}:{locale:Locale}){
  const {size,setSize,saveFailed}=useCardTypography(),copy=cardTypographyCopy(locale);
  return <View style={s.panel}><CardText accessibilityRole="header" style={s.title}>{copy[0]}</CardText>
    <View style={s.options}>{(['compact','standard','larger'] as const).map((value,index)=><Pressable key={value} accessibilityRole="radio" accessibilityLabel={copy[index+1]} accessibilityState={{checked:size===value}} {...(Platform.OS==='web'?{'aria-checked':size===value}:{})} onPress={()=>setSize(value)} style={[s.option,size===value&&s.selected]}><CardText style={s.optionText}>{copy[index+1]}</CardText></Pressable>)}</View>
    <CardText style={s.hint}>{copy[4]}</CardText>{saveFailed?<CardText accessibilityRole="alert" style={s.hint}>{copy[5]}</CardText>:null}
  </View>;
}
const s=StyleSheet.create({panel:{paddingHorizontal:20,paddingVertical:14,gap:10,borderBottomWidth:1,borderColor:'#DFE3EA'},title:{fontSize:16,fontWeight:'700',color:'#171A22'},options:{flexDirection:'row',flexWrap:'wrap',gap:8},option:{minHeight:44,paddingHorizontal:12,paddingVertical:10,borderWidth:1,borderColor:'#DFE3EA',borderRadius:8,justifyContent:'center'},selected:{borderColor:'#002FA7',backgroundColor:'#F4F7FF'},optionText:{fontSize:14,color:'#002FA7',fontWeight:'700'},hint:{fontSize:12,lineHeight:18,color:'#5B6270'}});
