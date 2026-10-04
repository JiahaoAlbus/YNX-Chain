const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const React=require('react');
const {evaluate}=require('./guest-experience-fixture.cjs');
const filename=path.resolve(__dirname,'../src/CardIntroductionLink.tsx');
test('web application return link is explicit same-tab navigation in every supported locale',()=>{
  const {CardIntroductionLink,cardIntroductionLinkCopy}=evaluate(filename,{react:React,'react-native':{Platform:{OS:'web'}}});
  assert.equal(Object.keys(cardIntroductionLinkCopy).length,12);
  for(const locale of Object.keys(cardIntroductionLinkCopy)){
    const link=CardIntroductionLink({locale});assert.equal(link.type,'a');assert.equal(link.props.href,'/about/');assert.equal(link.props.target,undefined);
    assert.equal(link.props['aria-label'],cardIntroductionLinkCopy[locale]);assert.equal(link.props.children,cardIntroductionLinkCopy[locale]);assert.equal(link.props.style.minHeight,44);assert.equal(link.props.onClick,undefined);
  }
});
test('native app is not replaced by introduction and contains no web link',()=>{
  for(const OS of ['ios','android']){
    const {CardIntroductionLink}=evaluate(filename,{react:React,'react-native':{Platform:{OS}}});assert.equal(CardIntroductionLink({locale:'en'}),null);
  }
});
