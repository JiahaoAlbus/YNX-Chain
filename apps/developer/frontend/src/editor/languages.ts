export function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ js:"javascript",mjs:"javascript",cjs:"javascript",ts:"typescript",tsx:"typescript",py:"python",rs:"rust",go:"go",java:"java",c:"cpp",h:"cpp",cc:"cpp",cpp:"cpp",cxx:"cpp",hpp:"cpp",sol:"solidity",json:"json",md:"markdown",yaml:"yaml",yml:"yaml" } as Record<string,string>)[extension ?? ""] ?? "plaintext";
}
