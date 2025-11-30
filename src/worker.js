export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---------- helpers ----------
    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" }
      });
    }

    async function getBody(req) {
      const ct = req.headers.get("content-type") || "";
      try {
        if (ct.includes("application/json")) {
          return await req.json();
        }
        if (ct.includes("application/x-www-form-urlencoded")) {
          const form = await req.formData();
          const obj = {};
          for (const [k, v] of form.entries()) obj[k] = v;
          return obj;
        }
      } catch (e) {}
      return {};
    }

    const nowSec = () => Math.floor(Date.now() / 1000);
    const ADMIN_SECRET = env.ADMIN_SECRET || "change_me";

    // ========== Root "/" ကို စာသေးသေးနဲ့ ပြ ----------
    if (path === "/" && method === "GET") {
      return new Response(
        `<!doctype html>
<html><head><meta charset="utf-8"><title>KP VIP API</title></head>
<body>
  <h1>KP VIP API Online</h1>
  <p>API Base: <code>/kpvip/*.php</code></p>
</body></html>`,
        {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        }
      );
    }

    // =========================
    // 1) VPN LOGIN  (APK)
    //    POST /kpvip/signin.php
    //    POST /kpvip/login.php
    // =========================
    if (
      (path === "/kpvip/signin.php" || path === "/kpvip/login.php") &&
      method === "POST"
    ) {
      const body = await getBody(request);
      const username = body.username || body.user || "";
      const password = body.password || body.pass || "";

      if (!username || !password) {
        return json(
          { status: "error", message: "Missing username or password" },
          400
        );
      }

      const key = `user:${username}`;
      const user = await env.USERS_KV.get(key, "json");

      if (!user) {
        return json(
          { status: "error", message: "User not found or expired" },
          404
        );
      }

      if (user.password !== password) {
        return json(
          { status: "error", message: "Wrong username or password" },
          401
        );
      }

      const now = nowSec();
      if (user.expireAt && user.expireAt <= now) {
        return json(
          { status: "error", message: "Account expired" },
          403
        );
      }

      // Login OK – vpnConfig မလိုတော့လို့ မပို့တော့
      return json({
        status: "ok",
        username,
        expireAt: user.expireAt
      });
    }

    // =========================
    // 2) ADMIN ONLY ROUTES
    // =========================
    const adminHeader = request.headers.get("x-admin-secret");
    const isAdmin = adminHeader && adminHeader === ADMIN_SECRET;

    // auth မရရင် common error
    function needAdmin() {
      return json({ status: "error", message: "Unauthorized" }, 401);
    }

    // 2.1) user_exist.php – user ရှိ/မရှိ / expire စစ်
    if (path === "/kpvip/user_exist.php" && method === "POST") {
      if (!isAdmin) return needAdmin();

      const body = await getBody(request);
      const username = body.username || body.user || "";
      if (!username) {
        return json({ status: "error", message: "Missing username" }, 400);
      }

      const key = `user:${username}`;
      const user = await env.USERS_KV.get(key, "json");

      if (!user) {
        return json({ status: "ok", exists: false });
      }

      const now = nowSec();
      const active = !user.expireAt || user.expireAt > now;

      return json({
        status: "ok",
        exists: true,
        active,
        expireAt: user.expireAt || null,
        createdAt: user.createdAt || null
      });
    }

    // 2.2) edit.php – days ထပ်တိုး (renew)
    if (path === "/kpvip/edit.php" && method === "POST") {
      if (!isAdmin) return needAdmin();

      const body = await getBody(request);
      const username = body.username || body.user || "";
      const days = parseInt(body.days || body.extraDays || "0", 10);

      if (!username || !days) {
        return json(
          { status: "error", message: "Missing username or days" },
          400
        );
      }

      const key = `user:${username}`;
      const user = await env.USERS_KV.get(key, "json");
      if (!user) {
        return json({ status: "error", message: "User not found" }, 404);
      }

      const now = nowSec();
      let baseExpire =
        user.expireAt && user.expireAt > now ? user.expireAt : now;
      const newExpire = baseExpire + days * 24 * 60 * 60;

      user.expireAt = newExpire;

      await env.USERS_KV.put(key, JSON.stringify(user), {
        expirationTtl: newExpire - now
      });

      return json({
        status: "ok",
        message: "User renewed",
        username,
        expireAt: newExpire
      });
    }

    // 2.3) delete.php – user ဖျက်
    if (path === "/kpvip/delete.php" && method === "POST") {
      if (!isAdmin) return needAdmin();

      const body = await getBody(request);
      const username = body.username || body.user || "";
      if (!username) {
        return json({ status: "error", message: "Missing username" }, 400);
      }

      const key = `user:${username}`;
      await env.USERS_KV.delete(key);

      return json({
        status: "ok",
        message: "User deleted",
        username
      });
    }

    // 2.4) create.php – user အသစ်ဖန်တီး (username / pw / days)
    if (path === "/kpvip/create.php" && method === "POST") {
      if (!isAdmin) return needAdmin();

      const body = await getBody(request);
      const username = body.username || "";
      const password = body.password || "";
      const days = parseInt(body.days || "0", 10);

      if (!username || !password || !days) {
        return json(
          { status: "error", message: "Missing username/password/days" },
          400
        );
      }

      const key = `user:${username}`;
      const now = nowSec();
      const expireAt = now + days * 24 * 60 * 60;

      const data = {
        password,
        createdAt: now,
        expireAt
      };

      await env.USERS_KV.put(key, JSON.stringify(data), {
        expirationTtl: days * 24 * 60 * 60
      });

      return json({
        status: "ok",
        message: "User created",
        username,
        expireAt
      });
    }

    // 2.5) list.php – user list (username + date)
    if (path === "/kpvip/list.php" && (method === "GET" || method === "POST")) {
      if (!isAdmin) return needAdmin();

      const result = [];
      let cursor = undefined;

      // Cloudflare KV list – prefix "user:"
      do {
        const list = await env.USERS_KV.list({
          prefix: "user:",
          cursor
        });
        cursor = list.cursor;
        for (const k of list.keys) {
          const username = k.name.replace(/^user:/, "");
          const user = await env.USERS_KV.get(k.name, "json");
          if (!user) continue;
          result.push({
            username,
            expireAt: user.expireAt || null,
            createdAt: user.createdAt || null
          });
        }
      } while (cursor);

      return json({
        status: "ok",
        users: result
      });
    }

    // default
    return json(
      { status: "error", message: "Not found", path, method },
      404
    );
  }
};
