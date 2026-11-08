// Lexical injection ONLY in fixed SOURCE build. Never installs globals.
export{SourceUTF8Encoder as TextEncoder,SourceUTF8Decoder as TextDecoder}from'./original-source-private-utf8.mjs';
