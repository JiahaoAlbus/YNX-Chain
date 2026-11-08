/** SOURCE-only lexical byte helpers; not general global encoding polyfills. */
export class SourceUTF8Encoder{encode(input?:string):Uint8Array}
export class SourceUTF8Decoder{constructor(label?:'utf-8'|'utf8',options?:Readonly<{fatal?:boolean;ignoreBOM?:boolean}>);decode(input?:ArrayBuffer|ArrayBufferView,options?:Readonly<{stream?:false}>):string}
