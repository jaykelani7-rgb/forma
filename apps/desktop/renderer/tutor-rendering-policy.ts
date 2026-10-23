import { tutorExternalUrl as publicHttpsUrl } from '../../../packages/tutor/links';
/** Renderer never follows provider URLs. The host independently validates every click. */
export function tutorExternalUrl(value:string):string|null {
  try {return publicHttpsUrl(value);} catch {return null;}
}
