import type{Buffer}from'node:buffer';
export type TaskGrantSelectedFilePin=Readonly<{path:string;bytes:number;sha256:string}>;
export type TaskGrantDependencyAliasReadback=Readonly<{raw:string;canonicalPath:string;bytes:number;sha256:string;dev:string;ino:string;uid:string;gid:string;sameFile:true}>;
export declare const TASK_GRANT_LEXICAL_DEPENDENCY_ROOTS:readonly string[];
export declare function readTaskGrantPinnedOriginalFileDATA(pin:TaskGrantSelectedFilePin):Buffer;
/** Normal fixed-profile entry supplies only its closed reviewed roots; DATA only. */
export declare function inspectPinnedTaskGrantMakeDependenciesDATA(text:string,input:Readonly<{source:string;output:string;inputPins:readonly TaskGrantSelectedFilePin[];aliasRoots?:readonly string[];compileCwd?:string}>):Readonly<{source:string;output:string;resolvedInputs:readonly TaskGrantSelectedFilePin[];dependencyPathReadbacks:readonly TaskGrantDependencyAliasReadback[]}>;
