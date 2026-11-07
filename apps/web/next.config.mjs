/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Итерация 4: по умолчанию Next.js обрывает проксируемый /api-запрос через
    // 30 секунд. Ответ локальной модели на CPU ноутбука (вопрос ИИ про
    // финансы, подсказки категорий) может идти дольше — поднимаем до 5 минут.
    // Сами отчёты генерируются в фоне и от этого лимита не зависят.
    proxyTimeout: 300000,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/:path*`,
      },
    ];
  },
};
export default nextConfig;
