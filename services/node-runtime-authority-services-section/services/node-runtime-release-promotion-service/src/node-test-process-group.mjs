// Linux supplies the native off-host caller's observable group lifecycle. Read
// only PID/group/session/start identity, never environments or unrelated fds.
import {readFileSync,readdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const gone=error=>error.code==='ENOENT'||error.code==='ESRCH';
function identity(pid){
  try{
    const text=readFileSync('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
    return {pid:Number(pid),state:fields[0],group:Number(fields[2]),session:Number(fields[3]),threads:Number(fields[17]),start:fields[19]};
  }catch(error){if(gone(error))return null;throw error;}
}
const failure=message=>Object.assign(new Error(message),{code:'ECLEANUP'});

// A zombie leader can still have live sibling threads and shared descriptors.
// Require the terminal leader to be the sole remaining task, not state Z alone.
export const terminalGroupMember=member=>['Z','X'].includes(member.state)&&member.threads===1;

// signalGroup is an internal lifecycle-test seam, never a receiving/CLI option.
export function receivingProcessGroup(group,{signalGroup=(pid,signal)=>process.kill(pid,signal)}={}){
  if(process.platform!=='linux'||!Number.isSafeInteger(group)||group<=0)
    throw failure('receiving requires a dedicated Linux test process group');
  const leader=identity(group);
  if(!leader||leader.group!==group||leader.session!==group||!/^\d+$/.test(leader.start??''))
    throw failure('spawned test process-group identity was not established');
  const known=new Map([[group,leader.start]]);
  let closed=false;
  function exists(){
    try{process.kill(-group,0);return true;}
    catch(error){if(error.code==='ESRCH'){closed=true;return false;}throw error;}
  }
  function terminate(){
    if(closed)return;
    const members=[];
    for(const pid of readdirSync('/proc').filter(value=>/^\d+$/.test(value))){
      const member=identity(pid);
      if(!member||member.group!==group)continue;
      if(member.session!==group||!/^\d+$/.test(member.start??'')||
          (known.has(member.pid)&&known.get(member.pid)!==member.start))
        throw failure('test process-group membership changed identity');
      known.set(member.pid,member.start);members.push(member);
    }
    // Bind each observed PID to its start identity immediately before signalling.
    // The dedicated session/group stays reserved while any member remains.
    let bound=false;
    for(const member of members){
      const current=identity(member.pid);
      if(!current)continue;
      if(current.group!==group||current.session!==group||current.start!==member.start)
        throw failure('test process identity changed before group termination');
      bound=true;
    }
    if(!bound){if(exists())throw failure('test process group exists without observed owned membership');return;}
    if(members.every(terminalGroupMember))return;
    try{signalGroup(-group,'SIGKILL');}
    catch(error){if(error.code==='ESRCH')closed=true;else throw error;}
  }
  function members(){
    const observed=[];
    for(const pid of readdirSync('/proc').filter(value=>/^\d+$/.test(value))){
      const member=identity(pid);
      if(!member||member.group!==group)continue;
      if(member.session!==group||!/^\d+$/.test(member.start??'')||
          !Number.isSafeInteger(member.threads)||member.threads<1||
          (known.has(member.pid)&&known.get(member.pid)!==member.start))
        throw failure('test process-group observation changed identity');
      known.set(member.pid,member.start);observed.push(member);
    }
    return observed;
  }
  async function receiveClosure(){
    const deadline=Date.now()+5000;
    while(true){
      const first=members();
      if(!first.length&&!exists())return {group,leaderStart:leader.start,status:'terminated',liveTasks:0,remainingZombies:0};
      if(first.length&&first.every(terminalGroupMember)){
        // Re-read the complete group and each surviving identity/count. Once all
        // members have only a terminal task, none can fork or retain descriptors.
        const second=members();
        if(second.every(terminalGroupMember)){
          let stable=true;
          for(const member of second){
            const final=identity(member.pid);
            if(final&&(final.start!==member.start||final.group!==group||final.session!==group))
              throw failure('test process identity changed during closure');
            if(final&&!terminalGroupMember(final)){stable=false;break;}
          }
          if(stable&&(second.length||!exists()))return {group,leaderStart:leader.start,status:'terminated',liveTasks:0,remainingZombies:second.length};
        }
      }
      if(Date.now()>=deadline)throw failure('complete test process-group termination was not established');
      // Delivery and fork/exit can race. A prior signal is not cleanup evidence:
      // rebind currently owned identities and terminate any still-live group.
      terminate();
      await delay(10);
    }
  }
  return {terminate,receiveClosure};
}
