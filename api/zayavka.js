// api/zayavka.js — приймає заявку з форм сайту і пише дані в SendPulse.
// Форми стоять на /brand-session, /supersyla-yours, /kozachkova і /borodina;
// сторінку, з якої прийшла заявка, видно в колонці «Тег» (змінна lp_page).
//
// Чому серверна функція, а не запит із браузера: будь-який доступ до API
// SendPulse вимагає креденшела, а класти його в код сторінки не можна —
// його побачить кожен, хто відкриє исходник.
//
// Змінні оточення (Vercel → Settings → Environment Variables):
//   SP_CLIENT_ID       Налаштування → API → «Облікові дані» (sp_id_…)
//   SP_CLIENT_SECRET   звідти ж (sp_sk_…)
//   SP_FLOW_ZAYAVKA    id ланцюжка «Заявка — обробка»
//   SP_BOT_ID          id бота (потрібен для пошуку контакта за номером)
//   SP_API_KEY         необов'язково: статичний ключ замість OAuth
//
// ── Як людина потрапляє сюди ────────────────────────────────────────────
//
//   з cid       прийшла з кнопки в боті, контакт відомий одразу
//   без cid     відкрила сторінку напряму. Тоді шукаємо контакт за номером
//               (getByVariable) — більшість таких людей уже підписані, просто
//               зайшли на сайт з іншого місця
//   не знайшли  контакту не існує. API SendPulse контактів не створює, тому
//               єдиний шлях — відправити людину в бот посиланням зі start.
//               Віддаємо needStart, сторінка робить саме це

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

// Номер у боті й номер із форми записані по-різному: бот бере його з
// Telegram-контакта («380687266801»), форма складає з коду країни («+380…»).
// Точного збігу не буде, тому пробуємо кілька написань того самого номера.
function phoneVariants(phone) {
  const d = String(phone).replace(/\D/g, '');
  if (d.length < 7) return [];
  const seen = new Set([`+${d}`, d]);
  if (d.startsWith('380')) seen.add(`0${d.slice(3)}`); // 380671234567 → 0671234567
  return [...seen];
}

// Один номер може лежати на кількох контактах акаунта — у нас в кабінеті
// чотири боти, і 02.09 пошук за номером віддав контакт зовсім іншого бота
// (заявка лягла на «Живий ментор Solara», а не на людину). Тому мало знайти
// збіг — треба переконатися, що контакт належить саме нашому боту.
async function belongsToBot(token, id, botId) {
  try {
    const r = await fetch(`${SP}/contacts/get?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return false;
    const c = (await r.json()).data || {};
    return String(c.bot_id) === String(botId);
  } catch (err) {
    return false;
  }
}

async function findContactByPhone(token, phone) {
  const botId = process.env.SP_BOT_ID;
  if (!botId) return null;

  for (const value of phoneVariants(phone)) {
    const url = `${SP}/contacts/getByVariable`
      + `?variable_name=phone&variable_value=${encodeURIComponent(value)}`
      + `&bot_id=${encodeURIComponent(botId)}`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const body = await r.json();

      const ids = (body.data || [])
        .map((c) => c && (c.id || c.contact_id))
        .filter(Boolean);

      const ours = [];
      for (const id of ids) {
        if (await belongsToBot(token, id, botId)) ours.push(id);
      }

      // Рівно один контакт нашого бота — це він. Кілька означає, що номер
      // ділять дві людини, і вгадувати не можна: краще відправити в бот,
      // там Telegram сам скаже, хто прийшов.
      if (ours.length === 1) return ours[0];
      if (ours.length > 1) {
        console.warn('zayavka: номер знайдено на кількох контактах бота, шлемо в бот');
        return null;
      }
    } catch (err) {
      // мережа впала або відповідь не JSON — просто пробуємо наступне написання
      console.warn('zayavka: пошук за номером не вдався —', value, String(err).slice(0, 120));
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { cid, phone, src, ...utm } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone обовʼязковий' });

  try {
    // 1. Авторизація: статичний ключ, інакше OAuth
    const token = process.env.SP_API_KEY || (await oauthToken());

    // 2. Кому належить заявка. З кнопки в боті cid приходить готовим;
    // якщо людина відкрила сторінку сама — шукаємо її за номером.
    const contactId = cid || (await findContactByPhone(token, phone));

    // Контакту немає — дописувати нема до кого. Сторінка відправить людину
    // в бот посиланням зі start: там контакт створиться, і той самий
    // ланцюжок «Заявка — обробка» відпрацює вже з боку SendPulse.
    if (!contactId) {
      return res.status(200).json({ ok: false, needStart: true });
    }

    const setVar = (name, value) =>
      spFetch('/contacts/setVariable', token, {
        contact_id: contactId,
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

    // 3. Тег, по якому фільтрує останній день
    await spFetch('/contacts/setTag', token, {
      contact_id: contactId,
      tags: ['заявка_залишена'],
    });

    // 4. Ланцюжок «Заявка — обробка»: рядок у Google-таблицю + підтвердження.
    // Якщо id ще не заданий, крок пропускається: тег і змінні вже стоять,
    // тобто фільтр останнього дня працює. У відповіді видно, чи запустився.
    let flow = false;
    if (process.env.SP_FLOW_ZAYAVKA) {
      await spFetch('/flows/run', token, {
        contact_id: contactId,
        flow_id: process.env.SP_FLOW_ZAYAVKA,
      });
      flow = true;
    } else {
      console.warn('zayavka: SP_FLOW_ZAYAVKA не заданий — таблиця і підтвердження пропущені');
    }

    // matched каже сторінці, що все зроблено на сервері: людину можна вести
    // в бот звичайним посиланням, без start і без /start у чаті.
    return res.status(200).json({ ok: true, flow, skipped, matched: !cid });
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
