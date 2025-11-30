// ========= KP VIP Worker (Easy Mode Admin Auth) =========

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
  return handler(request, env);
}

// ===== create user =====
async function handleCreateUser(req, env) {
  let body = await req.formData();
  let username = body.get("username");
  let password = body.get("password");
  let days = parseInt(body.get("days"));

  if (!username || !password || !days)
    return json({ status:"error", message:"invalid params" },400);

  let users = await listUsers(env);
  if (users.find(u => u.username === username))
    return json({ status:"error", message:"User exists" },409);

  const now = Math.floor(Date.now()/1000);
  const expireAt = now + days*86400;

  users.push({ username, password, createdAt: now, expireAt });
  await saveUsers(env,users);

  return json({status:"ok", username, expireAt});
}

// ===== renew/edit =====
async function handleEditUser(req, env) {
  let body = await req.formData();
  let username = body.get("username");
  let days = parseInt(body.get("days"));

  if (!username || !days)
    return json({ status:"error", message:"invalid" },400);

  let users = await listUsers(env);
  let u = users.find(x => x.username===username);
  if (!u) return json({status:"error", message:"no user"},404);

  u.expireAt += days*86400;
  await saveUsers(env,users);
  return json({status:"ok"});
}

// ===== delete =====
async function handleDeleteUser(req,env) {
  let body = await req.formData();
  let username = body.get("username");
  if (!username) return json({status:"error"},400);

  let users = await listUsers(env);
  let before = users.length;
  users = users.filter(u=>u.username!==username);
  await saveUsers(env,users);

  return json({status:"ok", deleted: before-users.length});
}

// ===== login for APP =====
async function handleLogin(req,env){
  let body = await req.formData();
  let username = body.get("username");
  let password = body.get("password");

  if(!username||!password)
    return json({status:false,msg:"Invalid"},400);

  let users = await listUsers(env);
  let u = users.find(x=>x.username===username && x.password===password);
  if(!u) return json({status:false,msg:"Wrong acc"},403);

  let now = Math.floor(Date.now()/1000);
  if(now > u.expireAt)
    return json({status:false,msg:"Expired"},403);

  return json({status:true,username,exp:u.expireAt});
}

// ===== exist for APP =====
async function handleExist(req,env){
  let body = await req.formData();
  let username = body.get("username");

  let users = await listUsers(env);
  let u = users.find(x=>x.username===username);

  return json({status:u?true:false});
}

// ===== list for admin =====
async function handleList(req,env){
  let users = await listUsers(env);
  return json({status:"ok", users});
}

// ===== Router =====
export default {
  async fetch(req, env) {
    let url = new URL(req.url);
    let path = url.pathname;

    if (path.endsWith("create.php")) return adminOnly(req,env,handleCreateUser);
    if (path.endsWith("edit.php")) return adminOnly(req,env,handleEditUser);
    if (path.endsWith("delete.php")) return handleDeleteUser(req,env);
    if (path.endsWith("list.php")) return adminOnly(req,env,handleList);

    if (path.endsWith("login.php")) return handleLogin(req,env);
    if (path.endsWith("user_exist.php")) return handleExist(req,env);

    return json({status:"error",message:"Not found", path,method:req.method},404);
  }
};
