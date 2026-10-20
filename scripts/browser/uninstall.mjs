import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
for(const file of [join(homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts/app.forma.problem_capture.json'),join(homedir(),'Library/Application Support/Forma Companion/chrome-native-launcher')])await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
console.log('Forma Chrome native host registration removed. Remove the unpacked extension in Chrome and disable Chrome capture in Fenn. Your notebook is unchanged.');
