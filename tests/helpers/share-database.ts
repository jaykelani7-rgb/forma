import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export async function shareDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
  `);
  for (const name of [
    "20261004101222_durable_workspaces.sql",
    "20261009062036_shared_track_links.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  async function as<T>(
    role: "anon" | "authenticated" | "service_role",
    owner: string,
    sql: string,
    params: unknown[] = [],
    anonymous = false,
  ) {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query(
        "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [owner, JSON.stringify({ is_anonymous: anonymous })],
      );
      return tx.query<T>(sql, params);
    });
  }
  return { db, as };
}
