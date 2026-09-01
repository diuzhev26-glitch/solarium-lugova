// api/zayavka.js — приймає заявку з форм сайту і пише дані в SendPulse.
// Форми стоять на /brand-session, /supersyla-yours, /kozachkova і /borodina;
// сторінку, з якої прийшла заявка, видно в колонці «Тег» (змінна lp_page).
//
// Чому серверна функція, а не запит із браузера: будь-який доступ до API
// SendPulse вимагає креденшела, а класти його в код сторінки не можна —
// його побачить кожен, хто відкриє исходник.
//
// Змінні оточення (Vercel → Settings → Environment Variables):
//   SP_API_KEY         Налаштування → API → «Ключі API» (sp_apikey_…)
//   SP_FLOW_ZAYAVKA    id воронки «Заявка — обробка»
//
// Запасний шлях, якщо ключ не підійде для чатбот-ендпоінтів:
//   SP_CLIENT_ID       Налаштування → API → «Облікові дані» (sp_id_…)
//   SP_CLIENT_SECRET   звідти ж (sp_sk_…)
//
// SendPulse дає два способи авторизації. API-ключ статичний і живе, доки його
// не відкликали. OAuth видає токен на годину — і для serverless це гірше:
// функція не тримає стан між викликами, тому кожна заявка починалася б із
// зайвого походу за токеном. Тому ключ основний, OAuth лишається запасним.

const SP = 'https://api.sendpulse.com/telegram';

async function spFetch(path, token, body) {
  const r = await fetch(`${SP}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${text.slice(0, 300)}`);
  return text;
}

async function oauthToken() {
  const auth = await fetch('https://api.sendpulse.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.SP_CLIENT_ID,
      client_secret: process.env.SP_CLIENT_SECRET,
    }),
  }).then((r) => r.json());

  if (!auth.access_token) {
    throw new Error(`oauth: ${JSON.stringify(auth).slice(0, 300)}`);
  }
  return auth.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { cid, phone, src, ...utm } = req.body || {};
  if (!cid || !phone) {
    return res.status(400).json({ error: 'cid і phone обовʼязкові' });
  }

  try {
    // 1. Авторизація: статичний ключ, інакше OAuth
    const token = process.env.SP_API_KEY || (await oauthToken());

    // 2. Телефон у змінну контакта. Пошту не збираємо — на формі лише номер,
    // тож колонка email у таблиці заявок лишається порожньою.
    // Ендпоінт приймає одну змінну за виклик, тому йдемо по черзі.
    const setVar = (name, value) =>
      spFetch('/contacts/setVariable', token, {
        contact_id: cid,
        variable_name: name,
        variable_value: value,
      });

    // Телефон — суть заявки, без нього немає сенсу продовжувати.
    await setVar('phone', phone);

    // lp_page (колонка «Тег») і мітки — допоміжні. Якщо такої змінної ще
    // не створено в SendPulse, виклик віддає 422; ковтаємо його, бо через
    // порожню колонку в таблиці втрачати заявку не можна.
    const extra = { lp_page: src || 'form' };
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      if (utm[k]) extra[k] = utm[k];
    }
    const skipped = [];
    for (const [name, value] of Object.entries(extra)) {
      try {
        await setVar(name, value);
      } catch (err) {
        skipped.push(name);
        console.warn('zayavka: змінну не встановлено —', name, err.message.slice(0, 120));
      }
    }

    // 3. Тег, по якому фільтрує День 5
    await spFetch('/contacts/setTag', token, {
      contact_id: cid,
      tags: ['заявка_залишена'],
    });

    // 4. Воронка «Заявка — обробка»: рядок у Google-таблицю + підтвердження.
    // Якщо id воронки ще не заданий, крок пропускається: тег і змінні вже
    // стоять, тобто фільтр Дня 5 працює, а таблиця й підтвердження підключаться
    // разом зі змінною. У відповіді видно, чи воронка запустилась.
    let flow = false;
    if (process.env.SP_FLOW_ZAYAVKA) {
      await spFetch('/flows/run', token, {
        contact_id: cid,
        flow_id: process.env.SP_FLOW_ZAYAVKA,
      });
      flow = true;
    } else {
      console.warn('zayavka: SP_FLOW_ZAYAVKA не заданий — таблиця і підтвердження пропущені');
    }

    return res.status(200).json({ ok: true, flow, skipped });
  } catch (e) {
    // Не віддаємо ok, якщо щось із кроків не пройшло — інакше людина побачить
    // «заявку прийнято», а в боті й таблиці нічого не буде.
    //
    // step показує, де саме зламалось: oauth — не ті client_id/secret;
    // /contacts/* — контакт не знайдено або ендпоінт інший; /flows/run —
    // не той flow_id. Тіло відповіді SendPulse сюди не потрапляє, тільки
    // назва кроку і код, щоб діагностика не тягла за собою чужі дані.
    const step = e.message.startsWith('oauth') ? 'oauth' : e.message.split(' ')[0];
    const code = (e.message.match(/→ (\d{3})/) || [])[1] || null;
    console.error('zayavka:', e.message);
    return res.status(502).json({ error: 'SendPulse відхилив запит', step, code });
  }
}
