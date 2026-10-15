import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {receivePackedPackages} from '../src/receive-packed-packages.mjs';

test('real native PNPM deploy is received through its committed workspace',async t=>{
  const base=mkdtempSync(join(tmpdir(),'native-pnpm-receiving-')),workspace=join(base,'source'),runtime=join(base,'packed');
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const pnpm=process.env.NODE_RUNTIME_TEST_PNPM??'pnpm';
  const version=execFileSync(pnpm,['--version'],{encoding:'utf8'}).trim();
  const write=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
  const json=(file,value)=>write(file,JSON.stringify(value,null,2)+'\n');
  json(join(workspace,'package.json'),{name:'native-consumer',version:'1.0.0',type:'module',private:true,packageManager:'pnpm@'+version,
    dependencies:{'native-one':'workspace:*','native-two':'workspace:*'},receivingPackages:['native-one','native-two']});
  write(join(workspace,'pnpm-workspace.yaml'),"packages:\n  - packages/*\ninjectWorkspacePackages: true\n");
  write(join(workspace,'.gitignore'),'node_modules/\n');
  for(const name of ['native-one','native-two']){
    const directory=join(workspace,'packages',name);
    json(join(directory,'package.json'),{name,version:'1.0.0',type:'module',files:['test','fixture.json'],receivingTests:['test/check.mjs'],receivingFixtures:['fixture.json']});
    write(join(directory,'fixture.json'),'{"owned":true}\n');
    write(join(directory,'test/check.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('native packed fixture',()=>assert.equal(JSON.parse(readFileSync(new URL('../fixture.json',import.meta.url))).owned,true));\n");
  }
  const run=args=>{try{return execFileSync(pnpm,args,{cwd:workspace,encoding:'utf8',timeout:60000,maxBuffer:1024*1024,env:{...process.env,CI:'true',XDG_DATA_HOME:join(base,'data'),XDG_CACHE_HOME:join(base,'cache'),PNPM_HOME:join(base,'pnpm')}});}catch(error){throw new Error(error.message+'\n'+error.stdout+'\n'+error.stderr);}};
  run(['install','--offline','--ignore-scripts']);
  const git=(...args)=>execFileSync('git',['-C',workspace,...args],{encoding:'utf8'});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-qm','native fixture');
  const lock=readFileSync(join(workspace,'pnpm-lock.yaml'));
  run(['--filter','native-consumer','--ignore-scripts','deploy','--prod',runtime]);
  const result=await receivePackedPackages({workspace,pnpm,runtime});
  assert.equal(result.status,'received');assert.equal(result.executedCases,2);assert.equal(result.packages.length,2);
  assert.ok(readFileSync(join(workspace,'pnpm-lock.yaml')).equals(lock));
});
