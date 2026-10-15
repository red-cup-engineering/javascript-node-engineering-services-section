#!/usr/bin/env node
import {receivePackedPackages} from '../src/receive-packed-packages.mjs';
const options={},args=process.argv.slice(2);
try{
  for(let index=0;index<args.length;index+=2){
    const key=args[index]?.slice(2);
    if(!['--workspace','--pnpm','--runtime'].includes(args[index])||!args[index+1]||Object.hasOwn(options,key))
      throw new TypeError('usage: receive-packed-packages --workspace ROOT [--pnpm EXECUTABLE] --runtime OUTPUT');
    options[key]=args[index+1];
  }
  const result=await receivePackedPackages(options);
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  process.stdout.write(JSON.stringify(error.result??{status:'refused',satisfied:false,refusal:{phase:'arguments',message:error.message}})+'\n');
  process.exitCode=1;
}
