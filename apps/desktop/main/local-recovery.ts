import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupHash, BACKUP_LIMIT } from './backup-schema';

/** A generation lease is taken at entry, before asynchronous external work. */
export class RecoveryFence {
  private epoch=0;
  private held=false;
  get busy(){return this.held;}
  lease(){if(this.held)throw new Error('A local restore is in progress. Try this action after it finishes.');const epoch=this.epoch;return ()=>{if(this.held||epoch!==this.epoch)throw new Error('This action predates a local restore. Review the current context and try again.');};}
  begin(){if(this.held)throw new Error('A local restore is already in progress.');this.held=true;this.epoch++;return ()=>{this.held=false;};}
}
export interface RecoveryReceipt {json:string;sha256:string}
/** Exclusive, private, fsynced file + reread verification before replacement. */
export function writeVerifiedRecovery(directory:string,json:string):{path:string;receipt:RecoveryReceipt} {
  if(Buffer.byteLength(json)>BACKUP_LIMIT)throw new Error('The full recovery backup exceeds 64 MiB. Restore was aborted.');
  let temporary:string|undefined,fd:number|undefined;
  try {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const files=readdirSync(directory).filter(name=>name.endsWith('.json'));
  if(files.length>=20||files.reduce((sum,name)=>sum+statSync(join(directory,name)).size,0)+Buffer.byteLength(json)>512*1024*1024)throw new Error('The recovery folder reached its 20-backup or 512 MiB limit. Move older recovery backups to safe storage before restoring.');
  const path=join(directory,`before-restore-${Date.now()}-${randomUUID()}.json`);temporary=path+'.partial';
    fd=openSync(temporary,'wx',0o600);writeFileSync(fd,json,'utf8');fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,path);
    const dir=openSync(directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
    const saved=readFileSync(path,'utf8'),sha256=backupHash(json);if(backupHash(saved)!==sha256)throw new Error('The recovery file did not match the exported notebook.');
    return {path,receipt:{json:saved,sha256}};
  } catch(error){if(fd!==undefined)closeSync(fd);if(temporary&&existsSync(temporary))unlinkSync(temporary);throw new Error(`The pre-restore recovery backup failed. Nothing was replaced. ${error instanceof Error?error.message:''}`);}
}
