import React from 'react';
import {Platform} from 'react-native';
import type {Locale} from './i18n';
export const cardIntroductionLinkCopy:Record<Locale,string>={
  en:'About YNX Card',
  'zh-CN':'了解 YNX Card',
  'zh-TW':'了解 YNX Card',
  ja:'YNX Card について',
  ko:'YNX Card 소개',
  es:'Acerca de YNX Card',
  fr:'À propos de YNX Card',
  de:'Über YNX Card',
  pt:'Sobre YNX Card',
  ru:'О YNX Card',
  ar:'حول YNX Card',
  id:'Tentang YNX Card',
};
/** Explicit same-origin Web navigation only; native builds remain applications. */
export function CardIntroductionLink({locale}:{locale:Locale}){
  if(Platform.OS!=='web')return null;
  return React.createElement('a',{
    href:'/about/',
    'aria-label':cardIntroductionLinkCopy[locale],
    style:{display:'inline-flex',alignItems:'center',minHeight:44,padding:'10px 20px',color:'#002FA7',backgroundColor:'#FFFFFF',fontFamily:'inherit',fontSize:'inherit',lineHeight:1.5,fontWeight:600,textDecoration:'underline',textUnderlineOffset:3},
  },cardIntroductionLinkCopy[locale]);
}
