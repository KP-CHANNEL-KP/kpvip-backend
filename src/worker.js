export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Base route prefix
    const base = "/kpvip";
    if (!path.startsWith(base)) {
      return json({ status: "error", message: "Not found", path, method: request.method }, 404);
    }

    const subPath = path.slice(base.length);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 200 }));
    }

    try {
      // Admin-only actions
      if (subPath === "/create.php" && request.method === "POST") {
        await requireAdmin(request, env);
        return await handleCreate(request, env);
      }

      if (subPath === "/edit.php" && request.method === "POST") {
        await requireAdmin(request, env);
        return await handleEdit(request, env);
      }

      if (subPath === "/delete.php" && request.method === "POST") {
        await requireAdmin(request, env);
        return await handleDelete(request, env);
      }

      if (subPath === "/list.php" && request.method === "POST") {
        await requireAdmin(request, env);
        return await handleList(env);
      }

      // App Login
      if (subPath === "/login.php" && request.method === "POST") {
        return await handleLogin(request, env);
      }

      // App check user exist
      if (subPath === "/user_exist.php" && request.method === "POST") {
        return await handleUserExist(request, env);
      }

      return json({ status: "error", message: "Not found", subPath }, 404);
    } catch (e) {
      return json({ status: "error", message: e.message || "Internal Error" }, 500);
    }
  }
};


// ----------------- ADMIN CHECK -----------------
async function requireAdmin(request, env) {
  const admin = request.headers.get("x-admin-secret") || "";
  if (!admin || admin !== env.ADMIN_SECRET) {
    throw new Error("Unauthorized");
  }
}


// ----------------- DATA STORAGE -----------------
async function getUser(env, username) {
  const raw = await env.USERS_KV.get(username);
  return raw ? JSON.parse(raw) : null;
}

async function saveUser(env, username, data) {
  return await env.USERS_KV.put(username, JSON.stringify(data));
}

async function deleteUser(env, username) {
  return await env.USERS_KV.delete(username);
}


// ----------------- ENDPOINT HANDLERS -----------------
async function handleCreate(request, env) {
  const form = await request.formData();
  const user = (form.get("username") || "").trim();
  const pass = (form.get("password") || "").trim();
  const days = Number(form.get("days") || 0);
  if (!user || !pass || !days) return json({ status: "fail", message: "missing" });

  const expire = Math.floor(Date.now() / 1000) + (days * 86400);

  await saveUser(env, user, {
    username: user,
    password: pass,
    expireAt: expire
  });

  return json({ status: "success", username: user, expireAt: expire });
}

async function handleEdit(request, env) {
  const form = await request.formData();
  const user = form.get("username");
  const days = Number(form.get("days") || 0);
  if (!user || !days) return json({ status: "fail" });

  const exist = await getUser(env, user);
  if (!exist) return json({ status: "fail", message: "user_not_found" });

  exist.expireAt = (exist.expireAt || Math.floor(Date.now() / 1000)) + (days * 86400);
  await saveUser(env, user, exist);

  return json({ status: "success", username: user, expireAt: exist.expireAt });
}

async function handleDelete(request, env) {
  const form = await request.formData();
  const user = form.get("username");
  if (!user) return json({ status: "fail" });

  await deleteUser(env, user);
  return json({ status: "success", username: user });
}

async function handleList(env) {
  const list = [];
  const data = await env.USERS_KV.list();
  for (const i of data.keys) {
    const u = await getUser(env, i.name);
    if (u) list.push(u);
  }
  return json({ status: "success", users: list });
}


// ----------------- APP LOGIN FORMAT -----------------
async function handleLogin(request, env) {
  const form = await request.formData();
  const user = form.get("username");
  const pass = form.get("password");
  if (!user || !pass) return json({ status: "fail" });

  const data = await getUser(env, user);
  if (!data) return json({ status: "fail", message: "user_not_found" });

  if (pass !== data.password) return json({ status: "fail", message: "wrong_password" });

  return json({
    status: "success",
    username: user,
    expireAt: data.expireAt || null
  });
}


// ----------------- APP EXIST CHECK -----------------
async function handleUserExist(request, env) {
  const form = await request.formData();
  const user = form.get("username");
  if (!user) return json({ status: "fail" });

  const data = await getUser(env, user);
  if (!data) return json({ status: "fail" });

  return json({
    status: "success",
    username: user,
    expireAt: data.expireAt || null
  });
}


// ----------------- UTIL RESPONSE -----------------
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  }));
}

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "*");
  res.headers.set("Access-Control-Allow-Methods", "*");
  return res;
}
