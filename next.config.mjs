/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp is a native module — keep it external so it loads from node_modules
  // (the correct platform binary) at runtime instead of being bundled.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
