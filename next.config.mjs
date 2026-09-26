/** Static export: no server, no runtime API. Data comes from data/public/radar.json at build time. */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};
export default nextConfig;
