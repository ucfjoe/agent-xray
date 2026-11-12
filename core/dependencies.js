import ts from 'typescript';
import {posix} from 'node:path';
export function analyzeSources(files){
 const symbols=[],dependencies=[],diagnostics=[];const paths=new Set(files.map(f=>f.path));
 for(const file of files){
  if(!/\.[cm]?[jt]sx?$/.test(file.path)){diagnostics.push({path:file.path,reason:'Symbol analysis supports JavaScript and TypeScript.'});continue;}
  const tree=ts.createSourceFile(file.path,file.content,ts.ScriptTarget.Latest,true);
  function visit(node){
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
    const spec=node.moduleSpecifier.text;const base=posix.normalize(posix.join(posix.dirname(file.path),spec));
    const to=spec.startsWith('.')?[base,...['.ts','.tsx','.js','.jsx','/index.ts','/index.js'].map(s=>base+s)].find(p=>paths.has(p)):undefined;
    dependencies.push({from:file.path,to:to??spec,external:!to,provenance:'observed',rationale:'Static import/export declaration in current workspace source.'});
   }
   if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isMethodDeclaration(node)||ts.isVariableDeclaration(node))&&node.name){
    symbols.push({id:file.path+':'+node.pos,path:file.path,name:node.name.getText(tree),line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,endLine:tree.getLineAndCharacterOfPosition(node.end).line+1});
   }
   ts.forEachChild(node,visit);
  }visit(tree);
 }
 return {symbols,dependencies,diagnostics};
}
