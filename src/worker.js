// ========= KP VIP Worker (Panel OK + App Login + 1DV) =========

// user list (users: [{username,password,createdAt,expireAt,device_id?}])
async function listUsers(env) {
  let txt = await env.USERS_KV.get("users");
  return txt ? JSON.parse(txt) : [];
}

// save list
async function saveUsers(env, list) {
  await env.USERS_KV.put("users", JSON.stringify(list));
}

// JSON helper
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// ===== adminOnly (Auth disabled for now) =====
async function adminOnly(request, env, handler) {
  // လောလောဆယ် admin secret မစစ်ဘဲ တန်းလုပ်ပေးထားတယ်
  return handler(request, env);
}

// ===== create user (Panel) =====
async function handleCreateUser(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();
  let password = (body.get("password") || "").trim();
  let days = parseInt(body.get("days"));

  if (!username || !password || !days)
    return json({ status:"error", message:"invalid params" }, 400);

  let users = await listUsers(env);
  if (users.find(u => u.username === username))
    return json({ status:"error", message:"User exists" }, 409);

  const now = Math.floor(Date.now()/1000);
  const expireAt = now + days*86400;

  // 1DV အတွက် device_id ကို null အဖြစ်စတင်ထားမယ်
  users.push({
    username,
    password,
    createdAt: now,
    expireAt,
    device_id: null
  });
  await saveUsers(env, users);

  return json({ status:"ok", username, expireAt });
}

// ===== renew / edit (Panel + App) =====
async function handleEditUser(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();

  if (!username)
    return json({ status:"error", message:"missing username" }, 400);

  let users = await listUsers(env);
  let u = users.find(x => x.username === username);
  if (!u) return json({ status:"error", message:"no user" }, 404);

  let daysStr = body.get("days");
  let deviceId = body.get("device_id");
  let expiredDateStr = body.get("expired_date");

  if (daysStr) {
    // ---- Panel Renew (days ထပ်တိုး) ----
    let days = parseInt(daysStr);
    if (!days) return json({ status:"error", message:"invalid days" }, 400);
    u.expireAt += days*86400;
  } else if (deviceId && expiredDateStr) {
    // ---- App ပြန်ခေါ်တဲ့ reuploadUserInfo (1DV bind) ----
    u.device_id = String(deviceId);

    // APK က expired_date ကို millis နဲ့ ပို့လာလိမ့်မယ်
    let ms = parseInt(expiredDateStr);
    if (ms > 0) {
      u.expireAt = Math.floor(ms / 1000);
    }
  } else {
    return json({ status:"error", message:"invalid params" }, 400);
  }

  await saveUsers(env, users);
  return json({ status:"ok" });
}

// ===== delete (Panel + App) =====
async function handleDeleteUser(req, env) {
  let body = await req.formData();
  // Panel က username သုံးတယ်, APK က usernameToDelete သုံးတယ်
  let username = (body.get("username") || body.get("usernameToDelete") || "").trim();
  if (!username) return json({ status:"error", message:"missing username" }, 400);

  let users = await listUsers(env);
  let before = users.length;
  users = users.filter(u => u.username !== username);
  await saveUsers(env, users);

  return json({ status:"ok", deleted: before - users.length });
}

// ===== login for APP (1DV logic ပါ) =====
async function handleLogin(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();
  let password = (body.get("password") || "").trim();

  if (!username || !password)
    return json({ status:"fail", message:"missing_params" });

  let users = await listUsers(env);
  let u = users.find(x => x.username === username);

  if (!u)
    return json({ status:"fail", message:"user_not_found" });

  if (u.password !== password)
    return json({ status:"fail", message:"wrong_password" });

  let now = Math.floor(Date.now()/1000);
  if (now > u.expireAt)
    return json({ status:"fail", message:"expired" });

  // 1DV အတွက် device_id ရှိ / မရှိ အလိုက်
  const secondsLeft = u.expireAt - now;

  // device_id မရှိသေးရင် - ပထမ login (status:"login" + days)
  if (!u.device_id) {
    let daysLeft = Math.ceil(secondsLeft / 86400);
    if (daysLeft < 1) daysLeft = 1;

    // APK handleLoginResponse() ကိုက်အောင်
    // status == "login" && expired_date = days
    return json({
      status: "login",
      user: username,
      expired_date: String(daysLeft)
    });
  }

  // device_id ရှိပြီးသားဆိုရင် - Re-login
  // APK က ဒီ JSON ထဲက device_id ကို ကိုယ်ရဲ့ android_id နဲ့ နှိုင်းစစ်မယ်
  let expiredMillis = u.expireAt * 1000;

  return json({
    status: "re_login",
    user: username,
    expired_date: String(expiredMillis),
    device_id: u.device_id
  });
}

// ===== exist for APP =====
async function handleExist(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();

  if (!username)
    return json({ status:"error", message:"missing_username" }, 400);

  let users = await listUsers(env);
  let u = users.find(x => x.username === username);

  let now = Math.floor(Date.now()/1000);

  if (!u) {
    // APK handleCheckUserResponse() မှာ
    // status != "success" ဆိုရင် auto delete / premium clear လုပ်တယ်
    return json({ status:"fail", message:"user_not_found" });
  }

  if (now > u.expireAt) {
    return json({ status:"fail", message:"expired" });
  }

  return json({
    status: "success",
    user: username,
    expireAt: u.expireAt
  });
}

// ===== list for admin (Panel) =====
async function handleList(req, env) {
  let users = await listUsers(env);
  return json({ status:"ok", users });
}

// ===== Router =====
export default {
  async fetch(req, env) {
    let url = new URL(req.url);
    let path = url.pathname;

    // Admin / Panel side
    if (path.endsWith("create.php")) return adminOnly(req, env, handleCreateUser);
    if (path.endsWith("edit.php"))   return adminOnly(req, env, handleEditUser);
    if (path.endsWith("delete.php")) return handleDeleteUser(req, env);
    if (path.endsWith("list.php"))   return adminOnly(req, env, handleList);

    // App side
    if (path.endsWith("login.php"))       return handleLogin(req, env);
    if (path.endsWith("user_exist.php"))  return handleExist(req, env);

    return json({ status:"error", message:"Not found", path, method:req.method }, 404);
  }
};
