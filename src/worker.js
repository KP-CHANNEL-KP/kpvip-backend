export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      let path = url.pathname;

      // Base path: /kpvip/ (apk + admin panel က /kpvip/... နဲ့ခေါ်နေ)
      const base = "/kpvip";
      if (path.startsWith(base)) {
        path = path.slice(base.length);
      }
      if (path === "") path = "/";

      // CORS preflight
      if (request.method === "OPTIONS") {
        return handleOptions();
      }

      // -------- Admin-only routes (Admin panel) ----------
      if (request.method === "POST" && path === "/create.php") {
        return await adminOnly(request, env, handleCreateUser);
      }

      if (request.method === "POST" && path === "/edit.php") {
        return await adminOnly(request, env, handleEditUser);
      }

      if (request.method === "POST" && path === "/list.php") {
        return await adminOnly(request, env, handleListUsers);
      }

      // Admin + App ကိုလုံး ဝင်လို့ရမယ့် delete route
      if (request.method === "POST" && path === "/delete.php") {
        return await handleDeleteRoute(request, env);
      }

      // -------- App-only routes (APK) ----------
      if (request.method === "POST" && path === "/login.php") {
        return await handleLogin(request, env);
      }

      if (request.method === "POST" && path === "/user_exist.php") {
        return await handleUserExist(request, env);
      }

      return json(
        { status: "error", message: "Not found", path, method: request.method },
        404
      );
    } catch (err) {
      // adminOnly မှာ Response ပစ်လိုက်ရင် ဒီထဲကနေ ပြန်ပေးစေချင်လို့
      if (err instanceof Response) return err;

      return json(
        {
          status: "error",
          message: "Internal error",
          detail: String(err),
        },
        500
      );
    }
  },
};

/* ----------------- Helper functions ----------------- */

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, x-admin-secret, Authorization",
    ...extra,
  };
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

async function parseForm(request) {
  const form = await request.formData();
  const obj = {};
  for (const [k, v] of form.entries()) {
    obj[k] = String(v);
  }
  return obj;
}

/* ----------------- KV helpers ----------------- */

async function getUser(env, username) {
  if (!username) return null;
  const raw = await env.USERS_KV.get(username);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putUser(env, user) {
  await env.USERS_KV.put(user.username, JSON.stringify(user));
}

async function deleteUser(env, username) {
  await env.USERS_KV.delete(username);
}

/* ----------------- Admin auth ----------------- */

// Admin panel 用 route တွေ (create / edit / list) အတွက်
async function adminOnly(request, env, handler) {
  const sent = request.headers.get("x-admin-secret") || "";
  const expected = env.ADMIN_SECRET || "";

  if (!sent || !expected || sent !== expected) {
    // Response ကို throw လိုက်မယ် – மேலခု catch ကြောင့် တိုက်ရိုက် client ကို ပြန်ပါတယ်
    throw json({ status: "error", message: "Unauthorized" }, 401);
  }

  return handler(request, env);
}

// delete.php လို app က Authorization header သုံးပြီးခေါ်နိုင်သလို
// admin panel က x-admin-secret နဲ့လဲ ခေါ်တဲ့အခါ အိုကေ ဖြစ်အောင်
async function handleDeleteRoute(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const adminSecret = request.headers.get("x-admin-secret") || "";
  const expected = env.ADMIN_SECRET || "";

  const fromApp = auth === "N4VPN-MinKhant";
  const fromAdmin = adminSecret && adminSecret === expected;

  if (!fromApp && !fromAdmin) {
    return json({ status: "error", message: "Unauthorized" }, 401);
  }

  return handleDeleteUser(request, env);
}

/* ----------------- Admin handlers ----------------- */

// /create.php  (Admin panel သီးသန့်)
async function handleCreateUser(request, env) {
  const form = await parseForm(request);
  const username = (form["username"] || "").trim();
  const password = (form["password"] || "").trim();
  const daysStr = (form["days"] || "").trim();

  if (!username || !password || !daysStr) {
    return json(
      { status: "error", message: "missing fields" },
      400
    );
  }

  const days = Number(daysStr);
  if (!Number.isFinite(days) || days <= 0) {
    return json(
      { status: "error", message: "invalid days" },
      400
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expireAt = now + days * 24 * 60 * 60;

  const existing = await getUser(env, username);

  const user = {
    username,
    password,
    createdAt: existing?.createdAt || now,
    expireAt,
    device_id: existing?.device_id || null,
  };

  await putUser(env, user);

  return json({
    status: "ok",
    message: "user created",
    username,
    expireAt,
  });
}

// /edit.php  (Admin panel – ရက်ထပ်တိုး)
async function handleEditUser(request, env) {
  const form = await parseForm(request);
  const username = (form["username"] || "").trim();
  const daysStr = (form["days"] || "").trim();

  if (!username || !daysStr) {
    return json(
      { status: "error", message: "missing fields" },
      400
    );
  }

  const user = await getUser(env, username);
  if (!user) {
    return json(
      { status: "error", message: "user_not_found" },
      404
    );
  }

  const extraDays = Number(daysStr);
  if (!Number.isFinite(extraDays) || extraDays <= 0) {
    return json(
      { status: "error", message: "invalid days" },
      400
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const base = Math.max(user.expireAt || 0, now);
  user.expireAt = base + extraDays * 24 * 60 * 60;

  await putUser(env, user);

  return json({
    status: "ok",
    message: "updated",
    username,
    expireAt: user.expireAt,
  });
}

// /list.php (Admin panel – အားလုံးကြည့်)
async function handleListUsers(request, env) {
  const list = await env.USERS_KV.list();
  const users = [];
  for (const item of list.keys) {
    const u = await getUser(env, item.name);
    if (!u) continue;
    users.push({
      username: u.username,
      createdAt: u.createdAt || null,
      expireAt: u.expireAt || null,
    });
  }
  return json({ status: "ok", users });
}

// /delete.php (Admin panel or App)
async function handleDeleteUser(request, env) {
  const form = await parseForm(request);
  const username =
    (form["usernameToDelete"] || form["username"] || "").trim();

  if (!username) {
    return json(
      { status: "error", message: "missing username" },
      400
    );
  }

  await deleteUser(env, username);
  return json({ status: "ok", message: "deleted", username });
}

/* ----------------- App handlers ----------------- */

// APK: /login.php
async function handleLogin(request, env) {
  const form = await parseForm(request);
  const username = (form["username"] || "").trim();
  const password = (form["password"] || "").trim();

  if (!username || !password) {
    return json(
      { status: "missing", message: "missing username or password" },
      400
    );
  }

  const user = await getUser(env, username);
  if (!user) {
    // APK မှာ "Login failed: user_not_found" ဆိုပြီး ပြမယ်
    return json({ status: "user_not_found" }, 404);
  }

  if (user.password !== password) {
    return json({ status: "wrong_password" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);

  if (!user.device_id) {
    // ပထမ Login: server မှာ device မသတ်ရသေးသလို
    if (!user.expireAt || user.expireAt <= now) {
      return json({ status: "expired" }, 403);
    }

    const secondsLeft = user.expireAt - now;
    let daysLeft = Math.floor(secondsLeft / (24 * 60 * 60));
    if (daysLeft < 1) daysLeft = 1;

    // APK က ဒီ daysLeft ကို သုံးပြီး နောက်ထပ် expired_date timestamp
    // တွက်လိုက်မယ် (reuploadUserInfo)
    return json({
      status: "login",
      user: user.username,
      expired_date: String(daysLeft),
    });
  } else {
    // အရင်က device_id already ရှိနေပြီ => re_login
    if (!user.expireAt || user.expireAt <= now) {
      return json({ status: "expired" }, 403);
    }

    const expiredMillis = user.expireAt * 1000;

    return json({
      status: "re_login",
      user: user.username,
      expired_date: String(expiredMillis),
      device_id: user.device_id,
    });
  }
}

// APK: /user_exist.php  (Account က still သက်တမ်းမကျသေး?)
async function handleUserExist(request, env) {
  const form = await parseForm(request);
  const username = (form["username"] || "").trim();

  const user = await getUser(env, username);
  if (!user) {
    return json({
      status: "error",
      message: "user_not_found",
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const active = !!user.expireAt && user.expireAt > now;

  return json({
    status: "ok",
    active,
    username: user.username,
    expireAt: user.expireAt || null,
    createdAt: user.createdAt || null,
  });
}

// APK: /edit.php (reuploadUserInfo – device + expired_date(ms) ပြန်ပို့တာ)
async function handleReupload(request, env) {
  const form = await parseForm(request);
  const username = (form["username"] || "").trim();
  const device_id = (form["device_id"] || "").trim();
  const expMsStr = (form["expired_date"] || "").trim();

  if (!username || !device_id || !expMsStr) {
    return json(
      { status: "error", message: "missing fields" },
      400
    );
  }

  const user = await getUser(env, username);
  if (!user) {
    return json(
      { status: "error", message: "user_not_found" },
      404
    );
  }

  const expMs = Number(expMsStr);
  if (!Number.isFinite(expMs) || expMs <= 0) {
    return json(
      { status: "error", message: "invalid_expired_date" },
      400
    );
  }

  user.device_id = device_id;
  user.expireAt = Math.floor(expMs / 1000);

  await putUser(env, user);

  return json({
    status: "ok",
    message: "updated",
    username,
    expireAt: user.expireAt,
    device_id,
  });
}
