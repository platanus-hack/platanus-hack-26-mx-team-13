/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hackathon: a lint error should never break a Vercel deploy
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
