// ========= KP VIP Worker (Panel OK + App Login = First Login Start) =========

// user list
async function listUsers(env) {
  let txt = await env.USERS_KV.get("users");
  return txt ? JSON.parse(txt) : [];
}

// save list
async function saveUsers(env, list) {
  await env.USERS_KV.put("users", JSON.stringify(list));
}

// use raw response
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

// ===== create user =====
// Panel ကနေ create လုပ်တဲ့အခါ သက်တမ်း *မစရသေးဘူး*
// expireAt = 0 ထားပြီး validDays ထည့်သိမ်းမယ်
async function handleCreateUser(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();
  let password = (body.get("password") || "").trim();
  let days = parseInt(body.get("days"));

  if (!username || !password || !days)
    return json({ status: "error", message: "invalid params" }, 400);

  let users = await listUsers(env);
  if (users.find(u => u.username === username))
    return json({ status: "error", message: "User exists" }, 409);

  const now = Math.floor(Date.now() / 1000);

  // သက်တမ်း မစသေးတဲ့ user record
  users.push({
    username,
    password,
    createdAt: now,
    expireAt: 0,      // 0 => မစရသေး
    validDays: days   // ပထမ login ဝင်သလို ဒီရက်အရေအတွက်နဲ့ စပြေးမယ်
  });
  await saveUsers(env, users);

  return json({ status: "ok", username, expireAt: 0 });
}

// ===== renew/edit (Panel မှာ သက်တမ်း ထပ်တိုးတဲ့အချိန်) =====
async function handleEditUser(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();
  let days = parseInt(body.get("days"));

  if (!username || !days)
    return json({ status: "error", message: "invalid" }, 400);

  let users = await listUsers(env);
  let u = users.find(x => x.username === username);
  if (!u) return json({ status: "error", message: "no user" }, 404);

  // expireAt မစရသေး (0) ဆိုရင် => ထပ်တိုး days ကို validDays ထဲမှာပဲ ထပ်ထည့်ပေးမယ်
  if (!u.expireAt || u.expireAt === 0) {
    const oldValid = u.validDays || 0;
    u.validDays = oldValid + days;
  } else {
    // သက်တမ်း စပြီးသား user ဖြစ်ရင် direct expireAt ကို ထပ်တိုး
    u.expireAt += days * 86400;
  }

  await saveUsers(env, users);
  return json({ status: "ok" });
}

// ===== delete (panel + app) =====
async function handleDeleteUser(req, env) {
  let body = await req.formData();
  // Panel က username သုံးတယ်, APK က usernameToDelete သုံးတယ်
  let username = (body.get("username") || body.get("usernameToDelete") || "").trim();
  if (!username) return json({ status: "error", message: "missing username" }, 400);

  let users = await listUsers(env);
  let before = users.length;
  users = users.filter(u => u.username !== username);
  await saveUsers(env, users);

  return json({ status: "ok", deleted: before - users.length });
}

// ===== login for APP =====
// ဒီမှာပဲ "ပထမ login ဝင်တဲ့အချိန်" မှာ expireAt သတ်မှတ်ပေးမယ်
async function handleLogin(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();
  let password = (body.get("password") || "").trim();

  // APK ထဲမှာ JSONObject.getString("status") သုံးလို့
  // boolean မပို့တော့ဘဲ string ပဲသုံးမယ်
  if (!username || !password)
    return json({ status: "fail", message: "missing_params" });

  let users = await listUsers(env);
  let u = users.find(x => x.username === username);

  if (!u)
    return json({ status: "fail", message: "user_not_found" });

  if (u.password !== password)
    return json({ status: "fail", message: "wrong_password" });

  const now = Math.floor(Date.now() / 1000);

  // 🟢 ပထမဆုံး login (သို့) သက်တမ်း မစရသေးတဲ့ အခြေအနေ
  if (!u.expireAt || u.expireAt === 0) {
    // Panel က သတ်ထားတဲ့ validDays မရှိရင် default 30 days
    const days = u.validDays || 30;
    u.validDays = days; // ensure exists

    u.expireAt = now + days * 86400; // အခုက starting point
    await saveUsers(env, users);
  }

  // အခုမှ expiry စစ်မယ်
  if (now > u.expireAt)
    return json({ status: "fail", message: "expired" });

  let secondsLeft = u.expireAt - now;
  let daysLeft = Math.ceil(secondsLeft / 86400);
  if (daysLeft < 1) daysLeft = 1;

  // APK handleLoginResponse() မှာ
  // status == "login", user, expired_date ကို သုံးထားတယ်
  return json({
    status: "login",
    user: username,
    expired_date: String(daysLeft)
  });
}

// ===== exist for APP =====
async function handleExist(req, env) {
  let body = await req.formData();
  let username = (body.get("username") || "").trim();

  if (!username)
    return json({ status: "error", message: "missing_username" }, 400);

  let users = await listUsers(env);
  let u = users.find(x => x.username === username);

  const now = Math.floor(Date.now() / 1000);

  if (!u) {
    // APK handleCheckUserResponse() မှာ status != "success" ဆိုရင်
    // auto delete + premium clear လုပ်တယ်
    return json({ status: "fail", message: "user_not_found" });
  }

  // expireAt မစသေး (0) ဆိုရင် => သက်တမ်း မစသေးပဲ "ရှိရင်း" လို့ သတ်မှတ်မယ်
  if (!u.expireAt || u.expireAt === 0) {
    return json({
      status: "success",
      user: username,
      expireAt: 0,
      message: "not_started"
    });
  }

  if (now > u.expireAt) {
    return json({ status: "fail", message: "expired" });
  }

  return json({
    status: "success",
    user: username,
    expireAt: u.expireAt
  });
}

// ===== list for admin =====
async function handleList(req, env) {
  let users = await listUsers(env);
  return json({ status: "ok", users });
}

// ===== Router =====
export default {
  async fetch(req, env) {
    let url = new URL(req.url);
    let path = url.pathname;

    if (path.endsWith("create.php")) return adminOnly(req, env, handleCreateUser);
    if (path.endsWith("edit.php"))   return adminOnly(req, env, handleEditUser);
    if (path.endsWith("delete.php")) return handleDeleteUser(req, env);
    if (path.endsWith("list.php"))   return adminOnly(req, env, handleList);

    if (path.endsWith("login.php"))       return handleLogin(req, env);
    if (path.endsWith("user_exist.php"))  return handleExist(req, env);

    return json({ status: "error", message: "Not found", path, method: req.method }, 404);
  }
};
