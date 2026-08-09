import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "../../../node_modules/monaco-editor/esm/vs/editor/editor.api.js";
import "../../../node_modules/monaco-editor/esm/vs/basic-languages/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/css/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/html/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import EditorWorker from "../workers/editor.worker?worker";
import JsonWorker from "../workers/json.worker?worker";
import CssWorker from "../workers/css.worker?worker";
import HtmlWorker from "../workers/html.worker?worker";
import TsWorker from "../workers/typescript.worker?worker";

self.MonacoEnvironment={getWorker(_:string,label:string){if(label==="json")return new JsonWorker();if(label==="css"||label==="scss"||label==="less")return new CssWorker();if(label==="html"||label==="handlebars"||label==="razor")return new HtmlWorker();if(label==="typescript"||label==="javascript")return new TsWorker();return new EditorWorker();}};
loader.config({monaco});

type Props={activePath:string;activeContent:string;language:string;theme:"light"|"dark";onChange:(value:string|undefined)=>void;splitPath?:string;splitContent?:string;splitLanguage?:string;onSplitChange?:(value:string|undefined)=>void;diffBase?:string};
export default function CodeEditor({activePath,activeContent,language,theme,onChange,splitPath,splitContent,splitLanguage,onSplitChange,diffBase}:Props){const editorTheme=theme==="dark"?"vs-dark":"vs";if(diffBase!==undefined)return <DiffEditor original={diffBase} modified={activeContent} language={language} theme={editorTheme} options={{automaticLayout:true,readOnly:false}}/>;return <><Editor path={`file:///${activePath}`} value={activeContent} language={language} theme={editorTheme} onChange={onChange} options={{automaticLayout:true,fontSize:13,lineHeight:20,minimap:{enabled:true},stickyScroll:{enabled:true},bracketPairColorization:{enabled:true},guides:{bracketPairs:true,indentation:true},quickSuggestions:{other:true,comments:false,strings:true},tabCompletion:"on",formatOnPaste:true,formatOnType:true,glyphMargin:true,padding:{top:8},scrollBeyondLastLine:false}}/>{splitPath&&<Editor path={`file:///${splitPath}`} value={splitContent} language={splitLanguage} theme={editorTheme} onChange={onSplitChange} options={{automaticLayout:true,fontSize:13,minimap:{enabled:false},scrollBeyondLastLine:false}}/>}</>}
