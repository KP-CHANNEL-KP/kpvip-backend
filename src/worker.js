export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // JSON response helper
    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" }
      });
    }

    // body parse helper (JSON + form-urlencoded)
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

    // -------------------------
    // 1) VPN login (APK ကသုံးမယ့် ပိုင်း)
    // POST /kpvip/login.php
    // -------------------------
    if (path === "/kpvip/login.php" && method === "POST") {
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

      // Login OK
      return json({
        status: "ok",
        username,
        plan: user.plan,
        expireAt: user.expireAt,
        vpnConfig: user.vpnConfig || ""
      });
    }

    // ===== Admin only routes =====
    const adminHeader = request.headers.get("x-admin-secret");
    const isAdmin = adminHeader && adminHeader === ADMIN_SECRET;

    // user_exist.php – user ရှိ/မရှိ စစ်
    if (path === "/kpvip/user_exist.php" && method === "POST") {
      if (!isAdmin) return json({ status: "error", message: "Unauthorized" }, 401);

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
        expireAt: user.expireAt || null
      });
    }

    // edit.php – expire date / plan / config ပြင် (renew)
    if (path === "/kpvip/edit.php" && method === "POST") {
      if (!isAdmin) return json({ status: "error", message: "Unauthorized" }, 401);

      const body = await getBody(request);
      const username = body.username || body.user || "";
      const days = parseInt(body.days || body.extraDays || "0", 10);
      const plan = body.plan;
      const vpnConfig = body.vpnConfig;

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
      if (plan) user.plan = plan;
      if (vpnConfig) user.vpnConfig = vpnConfig;

      await env.USERS_KV.put(key, JSON.stringify(user), {
        expirationTtl: newExpire - now
      });

      return json({
        status: "ok",
        message: "User updated",
        username,
        expireAt: newExpire
      });
    }

    // delete.php – user ဖျက်
    if (path === "/kpvip/delete.php" && method === "POST") {
      if (!isAdmin) return json({ status: "error", message: "Unauthorized" }, 401);

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

    // create.php – user အသစ်ဖန်တီး
    if (path === "/kpvip/create.php" && method === "POST") {
      if (!isAdmin) return json({ status: "error", message: "Unauthorized" }, 401);

      const body = await getBody(request);
      const username = body.username || "";
      const password = body.password || "";
      const days = parseInt(body.days || "0", 10);
      const plan = body.plan || "VIP";
      const vpnConfig = body.vpnConfig || "";

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
        password, // demo only – အမှန်ဆို hash သုံးသင့်
        plan,
        vpnConfig,
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

    // default
    return new Response("Not found", { status: 404 });
  }
};
