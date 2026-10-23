import type { TutorProviderId } from '../../../packages/tutor/types';
export type TutorProviderErrorCode='setup'|'authentication'|'permission'|'configuration'|'model-capability'|'rate-limit'|'timeout'|'aborted'|'network'|'service'|'malformed'|'refused'|'busy'|'too-large';
export const providerName=(provider:TutorProviderId)=>provider==='gemini'?'Gemini':'OpenAI';
function message(code:TutorProviderErrorCode,provider:TutorProviderId):string {
  const name=providerName(provider);
  const messages:Record<TutorProviderErrorCode,string>={
    setup:`Set up ${provider==='openai'?'an':'a'} ${name} API key in Tutor settings to send a message.`,
    authentication:`${name} rejected the configured credential. Check or replace the key in Tutor setup.`,
    permission:`${name} denied access. Check the key's project permissions, account access, and regional availability.`,
    configuration:`${name} rejected the request or configuration. Check advanced model settings and the input format before trying again.`,
    'model-capability':`${name}'s selected model is unavailable or does not support this capability. Choose a supported model in advanced settings.`,
    'rate-limit':`${name}'s rate limit or quota was reached. Check billing and limits, then explicitly try again when available.`,
    timeout:'The Tutor request timed out. Any partial answer has been retained. Try again explicitly when ready.',
    aborted:'The Tutor request was stopped.',
    network:`${name} could not be reached. Check your connection, then explicitly try again.`,
    service:`${name} is temporarily unable to complete this request. Wait, then explicitly try again.`,
    malformed:`${name} returned an incomplete or unreadable response. Any partial answer has been retained. Try again explicitly.`,
    refused:`${name} blocked or declined this request. Review the selected context or rephrase your question.`,
    busy:'Tutor is already processing a request. Stop it or wait for it to finish.',
    'too-large':'This Tutor request exceeds the supported size. Include a smaller selection or recording.',
  };
  return messages[code];
}
export class TutorProviderError extends Error {
  constructor(public readonly code:TutorProviderErrorCode,public readonly provider:TutorProviderId='openai'){super(message(code,provider));this.name='TutorProviderError';}
}
/** Never surface transport messages, raw response bodies, request content, or secrets. */
export function tutorProviderError(error:unknown):string{return error instanceof TutorProviderError?error.message:'The Tutor provider could not be reached. Check your connection, then explicitly try again.';}
function object(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
/** Structured codes take precedence over broad HTTP categories; provider message strings are never used. */
export function classifyProviderError(provider:TutorProviderId,status:number,payload?:unknown):TutorProviderError {
  const root=object(payload),error=object(root.error??root);
  const details=Array.isArray(error.details)?error.details:[];
  if(status<400&&typeof error.code==='number'&&Number.isInteger(error.code)&&error.code>=400&&error.code<=599)status=error.code;
  const codes=[error.code,error.type,error.status,...details.map(item=>object(item).reason)].filter(value=>typeof value==='string').map(value=>String(value).toLowerCase());
  const has=(...values:string[])=>codes.some(code=>values.includes(code));
  let code:TutorProviderErrorCode;
  if(has('authentication','api_key_invalid','api_key_expired','invalid_api_key','invalid_authentication','unauthenticated','unauthorized'))code='authentication';
  else if(has('safety','blocked','content_filter','recitation','misalignment_policy_violation','prohibited_content','image_safety','content_blocked','image_prohibited_content','image_recitation','image_other','spii','language','blocklist'))code='refused';
  else if(has('unimplemented','model_not_found','unsupported_model','model_not_supported','unsupported_capability','not_supported','not_found'))code='model-capability';
  else if(has('ip_not_authorized','permission_denied','forbidden','access_denied','api_key_service_blocked','service_disabled','api_key_http_referrer_blocked','api_key_ip_address_blocked'))code='permission';
  else if(has('too_many_requests','payment_required','resource_exhausted','rate_limit_exceeded','rate_limit_error','insufficient_quota','quota_exceeded','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','slow_down'))code='rate-limit';
  else if(has('deadline_exceeded','request_timeout','timeout'))code='timeout';
  else if(has('cancelled','canceled'))code='aborted';
  else if(status===413||has('context_length_exceeded'))code='too-large';
  else if(status===429||status===402)code='rate-limit';
  else if(status===408||status===504)code='timeout';
  else if(status===401)code='authentication';
  else if(status===403)code='permission';
  else if(status===404||status===405||status===501)code='model-capability';
  else if(status>=500||has('api_error','service_unavailable','internal','unavailable','server_error','server_overloaded','server_is_overloaded','service_unavailable_error','internal_error'))code='service';
  else if(status>=400||has('invalid_request','invalid_argument','failed_precondition','invalid_request_error'))code='configuration';
  else code='malformed';
  return new TutorProviderError(code,provider);
}
