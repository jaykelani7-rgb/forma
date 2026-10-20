import { spawn } from 'node:child_process';
import electron from 'electron';
const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,['.companion-build',...process.argv.slice(2)],{stdio:'inherit',env:environment});
child.on('exit',code=>process.exit(code??1));
child.on('error',error=>{console.error(error.message);process.exit(1);});
