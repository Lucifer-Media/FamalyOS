/**
 * Family OS — сервер web (Итерация 4.2).
 *
 * Обычный `next start`, но перед обработкой запроса X-Forwarded-For
 * ПЕРЕЗАПИСЫВАЕТСЯ реальным адресом сокета. Встроенный прокси Next.js
 * (rewrites /api → api) сам этот заголовок не добавляет, поэтому раньше API
 * видел IP контейнера web, а заголовок, присланный клиентом, проходил
 * насквозь (подделка IP). Теперь API знает настоящий IP — нужен для журнала
 * входов и «запомненных устройств» (привязка к IP).
 */
const { createServer } = require('http');
const next = require('next');

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME_BIND || '0.0.0.0';
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    let ip = req.socket.remoteAddress || '';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    req.headers['x-forwarded-for'] = ip;
    handle(req, res);
  }).listen(port, hostname, () => {
    console.log(`Family OS web: http://${hostname}:${port}`);
  });
});
