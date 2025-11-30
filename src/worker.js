export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Admin panel static files ---
    if (path === "/admin/" || path === "/admin/index.html") {
      return serveAdminHtml(env);
    }

    // --- KP VIP API (apk + admin panel) ---
    if (path === "/kpvip/login.php" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (path === "/kpvip/user_exist.php" && request.method === "POST") {
      return handleUserExist(request, env);
    }
    if (path === "/kpvip/edit.php" && request.method === "POST") {
      return handleEdit(request, env);
    }
    if (path === "/kpvip/delete.php" && request.method === "POST") {
      return handleDelete(request, env);
    }
    if (path === "/kpvip/create.php" && request.method === "POST") {
      return handleCreate(request, env);
    }
    if (path === "/kpvip/renew.php" && request.method === "POST") {
      return handleRenew(request, env);
    }
    if (path === "/kpvip/list.php" && request.method === "GET") {
      return handleList(env);
    }

    return jsonResponse(
      { status: "error", message: "Not found", path, method: request.method },
      404
    );
  },
};

/* ---------------------- helpers ---------------------- */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function getFormData(request) {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await request.json();
    return new Map(Object.entries(body));
  } else {
    const form = await request.formData();
    const map = new Map();
    for (const [k, v] of form.entries()) {
      map.set(k, String(v));
    }
    return map;
  }
}

function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const ok = auth === env.ADMIN_SECRET || auth === `Bearer ${env.ADMIN_SECRET}`;
  if (!ok) {
    return jsonResponse({ status: "error", message: "Unauthorized" }, 401);
  }
  return null;
}

/* ---------------------- LOGIN (APK) ---------------------- */
// POST /kpvip/login.php
// body: username, password
// success response MUST BE:
// { "status":"login", "user":"name", "expired_date":"30" }

async function handleLogin(request, env) {
  const form = await getFormData(request);
  const username = (form.get("username") || "").trim();
  const password = (form.get("password") || "").trim();

  if (!username || !password) {
    // APK မှာ "Login failed: <text>" လို့ပြမယ်
    return jsonResponse({ status: "missing_fields", message: "username/password required" });
  }

  const key = `user:${username.toLowerCase()}`;
  const user = await env.USERS_KV.get(key, { type: "json" });

  if (!user) {
    return jsonResponse({ status: "user_not_found", message: "User not found" });
  }

  if (user.password !== password) {
    return jsonResponse({ status: "invalid_password", message: "Wrong password" });
  }

  const now = Math.floor(Date.now() / 1000);

  if (user.expireAt && now >= user.expireAt) {
    return jsonResponse({ status: "expired", message: "User expired" });
  }

  // days left -> expired_date (string, apk uses as Calendar.add(DAY, days))
  let daysLeft = 30;
  if (user.expireAt) {
    const secondsLeft = Math.max(0, user.expireAt - now);
    daysLeft = Math.max(1, Math.ceil(secondsLeft / 86400));
  }

  // အဓိကအချက်: status = "login"
  return jsonResponse({
    status: "login",
    user: username,
    expired_date: String(daysLeft),
  });
}

/* ---------------------- CHECK USER (APK) ---------------------- */
// POST /kpvip/user_exist.php
// body: username
// handleCheckUserResponse() က status == "success" ဆိုရင် OK

async function handleUserExist(request, env) {
  const form = await getFormData(request);
  const username = (form.get("username") || "").trim();

  if (!username) {
    return jsonResponse({ status: "error", message: "username required" });
  }

  const key = `user:${username.toLowerCase()}`;
  const user = await env.USERS_KV.get(key, { type: "json" });

  if (!user) {
    return jsonResponse({ status: "not_found", message: "User not found" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (user.expireAt && now >= user.expireAt) {
    // APK က status != "success" ဆိုရင် auto delete လုပ်မယ်
    return jsonResponse({ status: "expired", message: "User expired" });
  }

  return jsonResponse({ status: "success", message: "User active" });
}

/* ---------------------- EDIT (APK reuploadUserInfo) ---------------------- */
// POST /kpvip/edit.php
// body: username, device_id, expired_date (ms since epoch as string)

async function handleEdit(request, env) {
  const form = await getFormData(request);
  const username = (form.get("username") || "").trim();
  const deviceId = (form.get("device_id") || "").trim();
  const expiredMs = form.get("expired_date");

  if (!username || !deviceId || !expiredMs) {
    return jsonResponse({ status: "error", message: "missing fields" }, 400);
  }

  const key = `user:${username.toLowerCase()}`;
  const user = (await env.USERS_KV.get(key, { type: "json" })) || {};

  let expireAt = user.expireAt;
  const ms = Number(expiredMs);
  if (!Number.isNaN(ms) && ms > 0) {
    expireAt = Math.floor(ms / 1000);
  }

  const updated = {
    ...user,
    username,
    deviceId,
    expireAt,
  };

  await env.USERS_KV.put(key, JSON.stringify(updated));

  return jsonResponse({ status: "ok", message: "updated" });
}

/* ---------------------- DELETE (APK + auto delete) ---------------------- */
// POST /kpvip/delete.php
// body: usernameToDelete
// header: Authorization: N4VPN-MinKhant (APK) or ADMIN_SECRET (panel)

async function handleDelete(request, env) {
  const form = await getFormData(request);
  const username = (form.get("usernameToDelete") || "").trim();

  if (!username) {
    return jsonResponse({ status: "error", message: "usernameToDelete required" }, 400);
  }

  // apk မှာ header = "N4VPN-MinKhant" သုံးထားပြိမယ်, admin panel ကတော့ ADMIN_SECRET သုံးမယ်
  const auth = request.headers.get("Authorization") || "";
  if (
    auth !== "N4VPN-MinKhant" &&
    auth !== env.ADMIN_SECRET &&
    auth !== `Bearer ${env.ADMIN_SECRET}`
  ) {
    return jsonResponse({ status: "error", message: "Unauthorized" }, 401);
  }

  const key = `user:${username.toLowerCase()}`;
  await env.USERS_KV.delete(key);

  return jsonResponse({ status: "ok", message: "user deleted", user: username });
}

/* ---------------------- ADMIN PANEL APIs ---------------------- */

// POST /kpvip/create.php   (admin panel create user)
async function handleCreate(request, env) {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;

  const form = await getFormData(request);
  const username = (form.get("username") || "").trim();
  const password = (form.get("password") || "").trim();
  const daysStr = form.get("days") || form.get("expire_days") || "30";

  if (!username || !password) {
    return jsonResponse({ status: "error", message: "username/password required" }, 400);
  }

  const days = Number(daysStr) || 30;
  const now = Math.floor(Date.now() / 1000);
  const expireAt = now + days * 86400;

  const key = `user:${username.toLowerCase()}`;
  const user = {
    username,
    password,
    createdAt: now,
    expireAt,
  };

  await env.USERS_KV.put(key, JSON.stringify(user));

  return jsonResponse({
    status: "ok",
    message: "User created",
    username,
    expireAt,
  });
}

// POST /kpvip/renew.php  (admin panel renew)
async function handleRenew(request, env) {
  const unauthorized = requireAdmin(request, env);
  if (unauthorized) return unauthorized;

  const form = await getFormData(request);
  const username = (form.get("username") || "").trim();
  const extraDays = Number(form.get("extra_days") || form.get("days") || "0") || 0;

  if (!username || !extraDays) {
    return jsonResponse(
      { status: "error", message: "username and extra days required" },
      400
    );
  }

  const key = `user:${username.toLowerCase()}`;
  const user = await env.USERS_KV.get(key, { type: "json" });
  if (!user) {
    return jsonResponse({ status: "error", message: "User not found" }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const base = user.expireAt && user.expireAt > now ? user.expireAt : now;
  user.expireAt = base + extraDays * 86400;

  await env.USERS_KV.put(key, JSON.stringify(user));

  return jsonResponse({
    status: "ok",
    message: "User renewed",
    username,
    expireAt: user.expireAt,
  });
}

// GET /kpvip/list.php   (admin panel User List)
async function handleList(env) {
  const list = await env.USERS_KV.list({ prefix: "user:" });
  const now = Math.floor(Date.now() / 1000);

  const users = [];
  for (const key of list.keys) {
    const data = await env.USERS_KV.get(key.name, { type: "json" });
    if (!data) continue;
    users.push({
      username: data.username,
      expireAt: data.expireAt || null,
      createdAt: data.createdAt || null,
      expired: data.expireAt ? now >= data.expireAt : false,
    });
  }

  return jsonResponse({ status: "ok", users });
}

/* ---------------------- Admin HTML (simple) ---------------------- */

function serveAdminHtml(env) {
  // ဒီမှာ မင်းသုံးနေတဲ့ admin panel HTML ကို ထည့်ထားရင်ရမယ်
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>KP VIP Admin Panel</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; background:#fafafa; }
    h1 { text-align:center; }
  </style>
</head>
<body>
  <h1>KP VIP Admin Panel</h1>
  <p>Admin UI static file here… (already working from your index.html)</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
