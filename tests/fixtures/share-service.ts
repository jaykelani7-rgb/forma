// Disposable local Supabase HTTP fixture backed by the real migration in PostgreSQL.
// It only listens on loopback and is never imported by application routes.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { shareDatabase } from "../helpers/share-database";
import { emptyData, validateData } from "../../src/lib/model";
async function main() {
  const { db, as } = await shareDatabase();
  const users = new Map<string, { id: string; email: string; token: string }>();
  const tokens = new Map<
    string,
    { id: string; email: string; token: string }
  >();
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-forwarded-for",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.end();
      return;
    }
    const url = new URL(req.url!, "http://127.0.0.1:54399");
    const send = (value: unknown, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024)
          throw new Error("Fixture request too large");
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === "/health") {
        send({ ok: true });
        return;
      }
      if (url.pathname === "/__test__/accounts") {
        const id = randomUUID(),
          email = `fixture-${id}@example.test`;
        const payload = Buffer.from(
          JSON.stringify({ sub: id, exp: 4102444800, role: "authenticated" }),
        ).toString("base64url");
        const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${payload}.local-fixture`;
        const user = { id, email, token };
        users.set(email, user);
        tokens.set(token, user);
        await db.query("insert into auth.users values($1)", [id]);
        const data = validateData(body.data ?? emptyData());
        await as(
          "authenticated",
          id,
          "select public.forma_commit_workspace($1::jsonb,0,$2::uuid)",
          [JSON.stringify(data), randomUUID()],
        );
        send(user);
        return;
      }
      const bearer = String(req.headers.authorization ?? "").replace(
        /^Bearer /i,
        "",
      );
      const user = tokens.get(bearer);
      const authUser = (u: { id: string; email: string }) => ({
        id: u.id,
        email: u.email,
        aud: "authenticated",
        role: "authenticated",
        is_anonymous: false,
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
      if (url.pathname === "/auth/v1/token") {
        const found = users.get(body.email);
        if (!found || body.password !== "forma-fixture-password") {
          send({ message: "Invalid fixture credentials" }, 400);
          return;
        }
        send({
          access_token: found.token,
          refresh_token: `fixture-refresh-${found.id}`,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: authUser(found),
        });
        return;
      }
      if (url.pathname === "/auth/v1/user") {
        if (!user) {
          send({ message: "Invalid token" }, 401);
          return;
        }
        send(authUser(user));
        return;
      }
      if (url.pathname === "/auth/v1/logout") {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").at(-1)!;
        const procedures: Record<string, { args: string[]; types: string[] }> =
          {
            forma_read_workspace: { args: [], types: [] },
            forma_commit_workspace: {
              args: ["p_data", "p_base_revision", "p_operation_id"],
              types: ["jsonb", "bigint", "uuid"],
            },
            forma_publish_share: {
              args: ["p_file", "p_operation_id"],
              types: ["jsonb", "uuid"],
            },
            forma_list_shares: { args: [], types: [] },
            forma_revoke_share: { args: ["p_id"], types: ["uuid"] },
            forma_resolve_share: { args: ["p_token"], types: ["text"] },
          };
        const procedure = procedures[name];
        if (!procedure) {
          send({ code: "42883" }, 404);
          return;
        }
        const privileged =
          req.headers.apikey === "sb_secret_local_fixture_only";
        const role = privileged
          ? "service_role"
          : user
            ? "authenticated"
            : "anon";
        const sql = `select public.${name}(${procedure.types.map((type, i) => `$${i + 1}::${type}`).join(",")}) result`;
        const values = procedure.args.map((arg, i) =>
          procedure.types[i] === "jsonb"
            ? JSON.stringify(body[arg])
            : body[arg],
        );
        const result = await as<{ result: unknown }>(
          role,
          user?.id ?? "",
          sql,
          values,
        );
        send(result.rows[0].result);
        return;
      }
      send({ error: "Unknown local fixture route" }, 404);
    } catch (error) {
      send(
        {
          code: (error as { code?: string }).code ?? "fixture_error",
          message: error instanceof Error ? error.message : "Fixture error",
        },
        400,
      );
    }
  });
  server.listen(54399, "127.0.0.1", () =>
    process.stdout.write("Disposable share fixture ready on 54399\n"),
  );
  async function close() {
    server.close();
    await db.close();
    process.exit(0);
  }
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
void main();
