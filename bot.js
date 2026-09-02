// bot.js — будує посилання на бота і підставляє його в кнопки входу.
//
// Дві форми посилання:
//   t.me/<bot>?start=<flow>            простий запуск, параметрів не передає
//   tg.pulse.is/<bot>?start=<flow>&…   параметри лягають у змінні контакта
//
// Мітки реклами живуть лише в адресі тієї сторінки, на яку людина прийшла.
// Клацнувши далі по сайту, вона їх втратить, тому кладемо їх у sessionStorage
// і далі беремо звідти.
//
// Готове посилання виставляється як window.BOT_LINK — його використовує lead.js
// для кнопки «Відкрити бот», коли форму заповнити нема кому.
(function () {
  var BOT = 'solarium_education_bot';

  // id ланцюжка «День 1» у SendPulse (в кабінеті він зветься solara_d1).
  // Якщо колись обнулити — кнопки просто ведуть у бот, без запуску прогріву.
  var FLOW_D1 = '6a96bb5821a4472f400c18df';

  // id ланцюжка «Заявка — обробка». Потрібен окремо від «Дня 1»: людину, що
  // залишила заявку, не можна кидати на початок прогріву — вона отримає урок
  // наново, ніби нічого не було. Тому форма без cid стартує саме цей ланцюжок:
  // він запише рядок у «Заявки» і надішле підтвердження, а прогрів не чіпає.
  var FLOW_ZAYAVKA = '6a96cdca21a4472f400c1958';

  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var STORE = 'sol_utm';

  var qs = new URLSearchParams(location.search);
  var utm = {};
  KEYS.forEach(function (k) { if (qs.get(k)) utm[k] = qs.get(k); });

  try {
    if (Object.keys(utm).length) {
      sessionStorage.setItem(STORE, JSON.stringify(utm));
    } else {
      var saved = sessionStorage.getItem(STORE);
      if (saved) utm = JSON.parse(saved);
    }
  } catch (e) { /* приватний режим — просто працюємо без збереження */ }

  window.BOT_UTM = utm;

  // Складає посилання на бота. Параметри передає лише tg.pulse.is —
  // t.me вміє тільки start, тому беремо його, коли передавати нічого.
  // Без FLOW_D1 параметри теж нікуди подіти: tg.pulse.is кладе їх у контакт
  // у момент запуску ланцюжка, а запускати нема чого.
  function link(flow, extra) {
    if (!flow) return 'https://t.me/' + BOT;

    var all = {};
    Object.keys(utm).forEach(function (k) { if (utm[k]) all[k] = utm[k]; });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k]) all[k] = extra[k]; });
    var keys = Object.keys(all);
    if (!keys.length) return 'https://t.me/' + BOT + '?start=' + flow;
    return 'https://tg.pulse.is/' + BOT + '?start=' + flow +
      keys.map(function (k) { return '&' + k + '=' + encodeURIComponent(all[k]); }).join('');
  }

  // Вхід у прогрів — кнопки лендінга.
  window.botLink = function (extra) { return link(FLOW_D1, extra); };

  // Заявка від того, кого ми ще не знаємо: замість прогріву стартує обробку
  // заявки. Використовує lead.js, коли в адресі немає cid.
  window.botLinkZayavka = function (extra) { return link(FLOW_ZAYAVKA, extra); };

  window.BOT_LINK = window.botLink();

  // Посилання без start — просто відкрити бот. Потрібне тим, хто вже підписаний:
  // start запускає ланцюжок наново, і людина після заявки отримувала урок удруге.
  window.BOT_PLAIN = 'https://t.me/' + BOT;

  function apply() {
    // 1. Будь-яке посилання на цього бота — хоч t.me, хоч tg.pulse.is.
    //    Скрипт дописує до нього мітки, тому в кнопку достатньо поставити
    //    звичайне t.me-посилання й підключити цей файл.
    document.querySelectorAll('a[href*="' + BOT + '"]').forEach(function (a) {
      a.setAttribute('href', window.BOT_LINK);
      a.setAttribute('rel', 'noopener');
    });

    // 2. Кнопки лендінга, що ведуть на якір або в нікуди. На /supersyla це всі
    //    чотири «Отримати урок в Telegram» — три з них лише прокручували
    //    сторінку до блоку реєстрації, замість вести в бот.
    //
    //    Селектор навмисно вузький — саме .btn. Якорі #zayavka у розборах
    //    Козачкової й Бородіної та зміст #s0…#s7 на /strategy під нього
    //    не потрапляють: там прокрутка по сторінці і потрібна.
    document.querySelectorAll('a.btn, a[data-bot]').forEach(function (a) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) !== '#') return;
      a.setAttribute('href', window.BOT_LINK);
      a.setAttribute('rel', 'noopener');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
