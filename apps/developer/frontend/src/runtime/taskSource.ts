type SourceProject = { id: string; files: Record<string,string> };
// Execution provenance only: this snapshot never grants project access.
export function captureTaskSource(project: SourceProject) {
  return Object.freeze({ id:project.id, files:Object.freeze({...project.files}) });
}
export function ownsTaskSource(current: SourceProject, captured: ReturnType<typeof captureTaskSource>) {
  const paths=Object.keys(captured.files);
  return current.id===captured.id && Object.keys(current.files).length===paths.length &&
    paths.every(path=>Object.hasOwn(current.files,path)&&current.files[path]===captured.files[path]);
}
