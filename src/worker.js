export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

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

    // Root info
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
    // 1) VPN LOGIN (APK)
    //    POST /kpvip/login.php
    //    POST /kpvip/signin.php   (၂ခုလုံး support)
    // =========================
    if (
      (path === "/kpvip/login.php" || path === "/kpvip/signin.php") &&
      method === "POST"
    ) {
      const body = await getBody(request);
      const username = body.username || body.user || "";
      const password = body.password || body.pass || "";

      // error response helper
      function loginError(msg) {
        return json({
          // App က fail ဖြစ်ရင် ဒီ status ကို toast ပြမယ်
          status: "fail",
          success: "0",
          login: "0",
          message: msg,
          msg: msg
        });
      }

      if (!username || !password) {
        return loginError("Missing username or password");
      }

      const key = `user:${username}`;
      const user = await env.USERS_KV.get(key, "json");

      if (!user) {
        return loginError("User not found or expired");
      }

      if (user.password !== password) {
        return loginError("Wrong username or password");
      }

      const now = nowSec();
      if (user.expireAt && user.expireAt <= now) {
        return loginError("Account expired");
      }

      // 🔥 Login success – app ဘက် condition မည်သည့် field ကိုမစစ်စေ
      // အရင် PHP panel format တွေ နီးစပ်အောင် ထုတ်ပေးမယ်
      return json({
        status: "success",   // string
        success: "1",        // "1" = ok
        login: "1",          // backup field
        message: "success",
        msg: "success",
        username,
        expire: user.expireAt
      });
    }

    // =========================
    // 2) ADMIN ONLY ROUTES
    // =========================
    const adminHeader = request.headers.get("x-admin-secret");
    const isAdmin = adminHeader && adminHeader === ADMIN_SECRET;

    function needAdmin() {
      return json({ status: "error", message: "Unauthorized" }, 401);
    }

    // user_exist.php
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

    // edit.php – renew
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

    // delete.php
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

    // create.php
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

    // list.php – user list (admin)
    if (path === "/kpvip/list.php" && (method === "GET" || method === "POST")) {
      if (!isAdmin) return needAdmin();

      const result = [];
      let cursor = undefined;

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
