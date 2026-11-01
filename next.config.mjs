/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  serverExternalPackages: [
    '@browserbasehq/stagehand',
    '@browserbasehq/sdk',
    'playwright',
    'playwright-core',
  ],
}

export default nextConfig
