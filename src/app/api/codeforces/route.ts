import { CodeforcesError, createCodeforcesAdapter } from "@/lib/codeforces-api";
import { validHandle } from "@/lib/codeforces-types";

export const runtime="nodejs";
const adapter=createCodeforcesAdapter();
export async function GET(request:Request) {
  const params=new URL(request.url).searchParams;
  const action=params.get("action");
  const handle=(params.get("handle")??"").trim();
  const from=Number(params.get("from")??1);
  const headers={"Cache-Control":"no-store"};
  if (!["profile","activity"].includes(action??"")||!validHandle(handle)||!Number.isInteger(from)||from<1||from>10000000||[...params.keys()].some(k=>!["action","handle","from"].includes(k))) return Response.json({error:"Use a valid handle (3–24 letters, numbers, dots, underscores or hyphens).",code:"invalid_request"},{status:400,headers});
  try {return Response.json(action==="profile"?await adapter.profile(handle):await adapter.activity(handle,from),{headers});}
  catch(e) {
    const error=e instanceof CodeforcesError?e:new CodeforcesError("Activity could not be imported. Your saved data is safe.","temporary");
    return Response.json({error:error.message,code:error.code},{status:error.status,headers});
  }
}
