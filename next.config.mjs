/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hackathon: un lint error nunca debe tumbar un deploy de Vercel
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
