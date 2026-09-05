import type { NextConfig } from 'next';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const githubAssetPrefix = process.env.GITHUB_ACTIONS === 'true' && repositoryName ? `/${repositoryName}` : '';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  assetPrefix: githubAssetPrefix,
};

export default nextConfig;
