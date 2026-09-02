// lead.js — форми заявки на всіх сторінках сайту.
//
// Два сценарії, залежно від того, чи прийшла людина за посиланням з бота:
//
//   є cid   — вона вже підписник. Номер пишемо через /api/zayavka: змінна,
//             тег «заявка_залишена», воронка «Заявка — обробка» (рядок
//             у таблицю + підтвердження). Людина лишається на сторінці.
//
//   без cid — підписника ще немає, а API SendPulse контактів не створює.
//             Тому номер передаємо боту параметром через tg.pulse.is:
//             бот створює контакт, записує phone і стартує воронку.
//
// В обох випадках кнопка одна й та сама — та, що вже стоїть у формі.
(function () {
  var qs = new URLSearchParams(location.search);
  var cid = qs.get('cid');
  var utm = window.BOT_UTM || {};
  var page = location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'index';

  var css = document.createElement('style');
  css.textContent =
    '.lead-note{margin-top:12px;border-radius:12px;padding:13px 15px;font-size:14px;line-height:1.5}' +
    '.lead-ok{background:rgba(238,58,36,.10);border:1px solid #EE3A24}' +
    '.lead-err{background:rgba(196,42,22,.10);border:1px solid rgba(196,42,22,.45)}' +
    '.lead-go{display:block;margin-top:12px;text-align:center;text-decoration:none}' +
    '.lead-spin{width:15px;height:15px;border:2px solid rgba(238,58,36,.25);border-top-color:#EE3A24;' +
    'border-radius:50%;display:inline-block;vertical-align:-2px;margin-right:9px;animation:lead-rot .7s linear infinite}' +
    '@keyframes lead-rot{to{transform:rotate(360deg)}}';
  document.head.appendChild(css);

  // Показує «переадресовуємо» і за мить веде в бот. Затримка потрібна, щоб
  // людина встигла зрозуміти, що відбувається, і щоб встиг піти запит.
  function goToBot(form, note, href) {
    Array.prototype.forEach.call(form.children, function (el) {
      if (el !== note) el.style.display = 'none';
    });
    note.className = 'lead-note lead-ok';
    note.innerHTML = '<span class="lead-spin"></span>Переадресовуємо в Telegram…';
    var go = document.createElement('a');
    go.className = 'btn lead-go';
    go.href = href;
    go.rel = 'noopener';
    go.textContent = 'Відкрити вручну →';
    note.appendChild(go);
    note.hidden = false;
    setTimeout(function () { location.href = href; }, 1200);
  }

  // Заявка від людини без cid. Стартуємо ланцюжок «Заявка — обробка», а не
  // «День 1»: інакше той, хто вже у воронці, після заявки отримує урок наново
  // з першого повідомлення. Ланцюжок заявки і рядок у таблицю запише,
  // і підтвердження надішле, і прогрів не зіб'є.
  function botHref(phone) {
    if (window.botLinkZayavka) {
      return window.botLinkZayavka({ phone: phone, lp_page: page });
    }
    return 'https://t.me/solarium_education_bot';
  }

  document.querySelectorAll('form').forEach(function (form) {
    var box = form.querySelector('.phone');
    if (!box) return; // не форма заявки

    form.removeAttribute('onsubmit');

    // Ім'я не питаємо: у таблицю воно приходить з Telegram-профілю контакта.
    form.querySelectorAll('input[autocomplete="name"]').forEach(function (el) {
      el.style.display = 'none';
      el.disabled = true;
    });

    // Номер, зібраний ботом при реєстрації, приходить у посиланні:
    // /brand-session?cid={{contact_id}}&phone={{phone}}. Підставляємо його
    // в поле, щоб людина не вводила той самий номер удруге — лише
    // підтвердила або виправила.
    var tel0 = box.querySelector('input[type="tel"]');
    var sel0 = box.querySelector('select');
    var pre = (qs.get('phone') || '').replace(/[^0-9+]/g, '');
    if (pre && tel0) {
      var digits0 = pre.replace(/\D/g, '');
      var best = '';
      if (sel0) {
        Array.prototype.forEach.call(sel0.options, function (o) {
          var code = o.value.replace(/\D/g, '');
          if (code && digits0.indexOf(code) === 0 && code.length > best.length) best = code;
        });
        if (best) sel0.value = '+' + best;
      }
      tel0.value = best ? digits0.slice(best.length) : digits0;
    }

    var btn = form.querySelector('button');
    var btnText = btn ? btn.textContent : 'Залишити заявку →';
    var note = document.createElement('div');
    note.className = 'lead-note lead-err';
    note.hidden = true;
    form.appendChild(note);

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var tel = box.querySelector('input[type="tel"]');
      var code = box.querySelector('select');
      var digits = (tel.value || '').replace(/[^0-9]/g, '');
      if (digits.length < 7) {
        note.className = 'lead-note lead-err';
        note.textContent = 'Введи номер телефону.';
        note.hidden = false;
        return;
      }
      var phone = (code ? code.value : '+380') + digits;

      note.hidden = true;
      if (btn) { btn.disabled = true; btn.textContent = 'Відправляємо…'; }

      // Не підписник — відправляємо в бот разом із номером.
      if (!cid) {
        goToBot(form, note, botHref(phone));
        return;
      }

      fetch('/api/zayavka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cid: cid,
          phone: phone,
          src: page,
          utm_source: utm.utm_source || '',
          utm_medium: utm.utm_medium || '',
          utm_campaign: utm.utm_campaign || '',
          utm_content: utm.utm_content || '',
          utm_term: utm.utm_term || '',
        }),
      })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function () {
          // Без start: людина вже у воронці, повторний запуск скине її на початок.
          goToBot(form, note, window.BOT_PLAIN || 'https://t.me/solarium_education_bot');
        })
        .catch(function () {
          note.className = 'lead-note lead-err';
          note.textContent = 'Не вдалося відправити. Спробуй ще раз або напиши в бот.';
          note.hidden = false;
          if (btn) { btn.disabled = false; btn.textContent = btnText; }
        });
    });
  });
})();
