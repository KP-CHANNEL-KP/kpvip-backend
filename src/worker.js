export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;

    // Route ကို vpnadmin.kpwork.qzz.io/kpvip/* လို့ချိတ်ထားလို့
    // /kpvip prefix ကိုဖြတ်လိုက်မယ်
    if (path.startsWith('/kpvip')) {
      path = path.substring('/kpvip'.length) || '/';
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      if (path === '/create.php' && request.method === 'POST') {
        return await handleCreateUser(request, env);
      }
      if (path === '/renew.php' && request.method === 'POST') {
        return await handleRenewUser(request, env);
      }
      if (path === '/delete.php' && request.method === 'POST') {
        return await handleDeleteUser(request, env);
      }
      if (path === '/list.php' && request.method === 'POST') {
        return await handleListUsers(request, env);
      }
      if (path === '/user_exist.php' && request.method === 'POST') {
        return await handleUserExist(request, env);
      }
      if (path === '/login.php' && request.method === 'POST') {
        return await handleLogin(request, env);
      }
      // APK မှာ reuploadUrl = edit.php ဖြစ်လို့ ဒီမှာ ချိတ်ပေးထားတယ်
      if (path === '/edit.php' && request.method === 'POST') {
        return await handleReupload(request, env);
      }

      // မကိုက်တဲ့ path တွေအတွက်
      return json(
        {
          status: 'error',
          message: 'Not found',
          path,
          method: request.method,
        },
        404,
      );
    } catch (e) {
      return json(
        {
          status: 'error',
          message: e?.message || 'Server error',
        },
        500,
      );
    }
  },
};

/* ---------- Helper Functions ---------- */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

// Admin panel auth (Admin Secret)
function requireAdmin(request, env) {
  const secret = env.ADMIN_SECRET;
  if (!secret) return false;

  const auth = request.headers.get('Authorization') || '';

  if (auth === secret) return true;
  if (auth === `Bearer ${secret}`) return true;

  return false;
}

// KV key
function userKey(username) {
  return `user:${username.toLowerCase()}`;
}

/* ---------- Handlers ---------- */

// POST /create.php (Admin)
async function handleCreateUser(request, env) {
  if (!requireAdmin(request, env)) {
    return json({ status: 'error', message: 'Unauthorized' }, 401);
  }

  const data = await request.json().catch(() => ({}));
  const username = (data.username || '').trim();
  const password = (data.password || '').trim();
  const days = parseInt(data.days || data.expireDays || 0, 10);

  if (!username || !password || !days || days <= 0) {
    return json({ status: 'error', message: 'Invalid input' }, 400);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expireAt = nowSec + days * 24 * 60 * 60;

  const user = {
    username,
    password,
    expireAt,      // seconds
    createdAt: nowSec,
    deviceId: null,
  };

  await env.USERS_KV.put(userKey(username), JSON.stringify(user));

  return json({
    status: 'ok',
    message: 'User created',
    username,
    expireAt,
  });
}

// POST /renew.php (Admin)
async function handleRenewUser(request, env) {
  if (!requireAdmin(request, env)) {
    return json({ status: 'error', message: 'Unauthorized' }, 401);
  }

  const data = await request.json().catch(() => ({}));
  const username = (data.username || '').trim();
  const extraDays = parseInt(data.extraDays || data.days || 0, 10);

  if (!username || !extraDays || extraDays <= 0) {
    return json({ status: 'error', message: 'Invalid input' }, 400);
  }

  const key = userKey(username);
  const stored = await env.USERS_KV.get(key);
  if (!stored) {
    return json({ status: 'error', message: 'User not found' }, 404);
  }

  const user = JSON.parse(stored);
  const nowSec = Math.floor(Date.now() / 1000);
  const base = user.expireAt && user.expireAt > nowSec ? user.expireAt : nowSec;
  user.expireAt = base + extraDays * 24 * 60 * 60;

  await env.USERS_KV.put(key, JSON.stringify(user));

  return json({
    status: 'ok',
    message: 'User renewed',
    username,
    expireAt: user.expireAt,
  });
}

// POST /delete.php (Admin + App)
async function handleDeleteUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const APP_KEY = 'N4VPN-MinKhant';

  if (!requireAdmin(request, env) && auth !== APP_KEY) {
    return json({ status: 'error', message: 'Unauthorized' }, 401);
  }

  const data = await request.json().catch(() => ({}));
  const username = (data.usernameToDelete || data.username || '').trim();

  if (!username) {
    return json({ status: 'error', message: 'Username required' }, 400);
  }

  await env.USERS_KV.delete(userKey(username));

  return json({
    status: 'ok',
    message: 'User deleted',
    username,
  });
}

// POST /list.php (Admin)
async function handleListUsers(request, env) {
  if (!requireAdmin(request, env)) {
    return json({ status: 'error', message: 'Unauthorized' }, 401);
  }

  const list = await env.USERS_KV.list({ prefix: 'user:' });
  const users = [];

  for (const key of list.keys) {
    const value = await env.USERS_KV.get(key.name);
    if (!value) continue;
    try {
      const u = JSON.parse(value);
      users.push({
        username: u.username,
        expireAt: u.expireAt,
        createdAt: u.createdAt,
      });
    } catch {
      // ignore broken record
    }
  }

  return json({ status: 'ok', users });
}

// POST /user_exist.php (App)
async function handleUserExist(request, env) {
  const data = await request.json().catch(() => ({}));
  const username = (data.username || '').trim();
  if (!username) {
    return json({ status: 'error', message: 'no_username' }, 400);
  }

  const stored = await env.USERS_KV.get(userKey(username));
  if (stored) {
    return json({ status: 'success' });
  } else {
    return json({ status: 'error', message: 'user_not_found' });
  }
}

// POST /login.php (App)
async function handleLogin(request, env) {
  const data = await request.json().catch(() => ({}));
  const username = (data.username || '').trim();
  const password = (data.password || '').trim();

  if (!username || !password) {
    return json({ status: 'error', message: 'missing_credentials' }, 400);
  }

  const stored = await env.USERS_KV.get(userKey(username));
  if (!stored) {
    return json({ status: 'error', message: 'user_not_found' });
  }

  const user = JSON.parse(stored);
  const nowSec = Math.floor(Date.now() / 1000);

  if (user.password !== password) {
    return json({ status: 'error', message: 'invalid_password' });
  }

  if (!user.expireAt || user.expireAt < nowSec) {
    return json({ status: 'error', message: 'expired' });
  }

  // deviceId မရှိသေး → first login
  if (!user.deviceId) {
    const secondsLeft = user.expireAt - nowSec;
    const daysLeft = Math.max(1, Math.ceil(secondsLeft / (24 * 60 * 60)));

    return json({
      status: 'login',
      user: user.username,
      expired_date: String(daysLeft), // app က days လိုလားတယ်
    });
  }

  // deviceId ရှိပြီးသား → re_login
  const expireMillis = user.expireAt * 1000;

  return json({
    status: 're_login',
    user: user.username,
    expired_date: String(expireMillis), // millis
    device_id: user.deviceId,
  });
}

// POST /edit.php (App reuploadUserInfo)
async function handleReupload(request, env) {
  const data = await request.json().catch(() => ({}));
  const username = (data.username || '').trim();
  const deviceId = (data.device_id || '').trim();
  const expiredDateStr = (data.expired_date || '').trim();

  if (!username || !deviceId || !expiredDateStr) {
    return json({ status: 'error', message: 'Invalid input' }, 400);
  }

  const stored = await env.USERS_KV.get(userKey(username));
  if (!stored) {
    return json({ status: 'error', message: 'user_not_found' }, 404);
  }

  const user = JSON.parse(stored);
  const expireMillis = parseInt(expiredDateStr, 10) || Date.now();
  user.deviceId = deviceId;
  user.expireAt = Math.floor(expireMillis / 1000);

  await env.USERS_KV.put(userKey(username), JSON.stringify(user));

  return json({ status: 'ok', message: 'updated' });
}
