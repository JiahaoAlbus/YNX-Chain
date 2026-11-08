// Private SOURCE byte support. Injected lexically ONLY by the fixed bundle;
// never assigned to globals or exported as an App/provider/authority API.
const CAP=2097152,fail=()=>{throw new TypeError('SOURCE_PRIVATE_UTF8_INVALID');};
const ta=Object.getPrototypeOf(Uint8Array.prototype),tbuffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,toffset=Object.getOwnPropertyDescriptor(ta,'byteOffset').get,tlength=Object.getOwnPropertyDescriptor(ta,'byteLength').get,ablength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const dvbuffer=Object.getOwnPropertyDescriptor(DataView.prototype,'buffer').get,dvoffset=Object.getOwnPropertyDescriptor(DataView.prototype,'byteOffset').get,dvlength=Object.getOwnPropertyDescriptor(DataView.prototype,'byteLength').get;
function view(value){if(value===undefined)return new Uint8Array();let buffer,offset,length;try{length=ablength.call(value);buffer=value;offset=0;}catch{try{buffer=tbuffer.call(value);offset=toffset.call(value);length=tlength.call(value);ablength.call(buffer);}catch{try{buffer=dvbuffer.call(value);offset=dvoffset.call(value);length=dvlength.call(value);ablength.call(buffer);}catch{fail();}}}if(length>CAP)fail();return new Uint8Array(buffer,offset,length);}
export class SourceUTF8Encoder {
 encode(input=''){if(typeof input!=='string')fail();const bytes=[];for(let i=0;i<input.length;i++){let c=input.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const d=input.charCodeAt(i+1);if(d>=0xdc00&&d<=0xdfff){c=0x10000+((c-0xd800)<<10)+(d-0xdc00);i++;}else c=0xfffd;}else if(c>=0xdc00&&c<=0xdfff)c=0xfffd;if(c<0x80)bytes.push(c);else if(c<0x800)bytes.push(0xc0|(c>>6),0x80|(c&63));else if(c<0x10000)bytes.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));else bytes.push(0xf0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));if(bytes.length>CAP)fail();}return Uint8Array.from(bytes);}
}
export class SourceUTF8Decoder {
 constructor(label='utf-8',options={}){if(label!=='utf-8'&&label!=='utf8')fail();this.fatal=options.fatal===true;this.ignoreBOM=options.ignoreBOM===true;Object.freeze(this);}
 decode(input,options={}){if(options.stream===true)fail();const bytes=view(input),out=[];let first=true;for(let i=0;i<bytes.length;){const a=bytes[i];let count=a<0x80?1:a>=0xc2&&a<=0xdf?2:a>=0xe0&&a<=0xef?3:a>=0xf0&&a<=0xf4?4:0,c=count===1?a:count===2?a&31:count===3?a&15:a&7,used=1,valid=count!==0;
  if(valid)for(let j=1;j<count;j++){const b=bytes[i+j];if(b===undefined||b<0x80||b>0xbf||j===1&&(a===0xe0&&b<0xa0||a===0xed&&b>0x9f||a===0xf0&&b<0x90||a===0xf4&&b>0x8f)){valid=false;break;}c=(c<<6)|(b&63);used++;}
  if(!valid){if(this.fatal)fail();c=0xfffd;i+=used;}else i+=count;
  if(first){first=false;if(c===0xfeff&&!this.ignoreBOM)continue;}out.push(c<=0xffff?String.fromCharCode(c):String.fromCodePoint(c));}
 return out.join('');}
}
