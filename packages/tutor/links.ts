/** Only an explicit click may open a public HTTPS destination in the host. */
export function tutorExternalUrl(input:unknown):string {
  if(typeof input!=='string'||input.length>2048||/[\u0000-\u0020\u007f]/.test(input))throw new Error('Choose a valid public HTTPS link.');
  let url:URL;try{url=new URL(input);}catch{throw new Error('Choose a valid public HTTPS link.');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||!host.includes('.')||host.endsWith('.')||host.endsWith('.local')||host.endsWith('.localhost')||host.endsWith('.internal')||!/[a-z]/.test(host.split('.').at(-1)??'')||!/^[a-z0-9.-]+$/.test(host))throw new Error('Only public HTTPS links can open from Fenn.');
  return url.toString();
}
