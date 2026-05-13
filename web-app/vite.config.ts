import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// Read version from VERSION file at project root
const version = fs.readFileSync(path.resolve(__dirname, "../VERSION"), "utf-8").trim();

// https://vite.dev/config/
export default ( { mode }: any ) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
    return defineConfig({
        plugins: [react()],
        resolve: {
            alias: [
                {
                    find: "./runtimeConfig",
                    replacement: "./runtimeConfig.browser" // ensures browser compatible version of AWS JS SDK is used
                }
            ]
        },
        define: {
            "process.env": {},
            "__APP_VERSION__": JSON.stringify(version),
        },

        worker: {
            format: 'es'
        },
        build: {
            target: 'esnext',
            rollupOptions: {
                external: [],
            }
        },
        server: {
            headers: {
                'Cross-Origin-Embedder-Policy': 'credentialless',
                'Cross-Origin-Opener-Policy': 'same-origin',
                'Cross-Origin-Resource-Policy': 'cross-origin',
            },
            proxy: {
                // Proxy API calls to CloudFront
                "/api": {
                    target: process.env.VITE_CLOUDFRONT_URL || "https://d2ou9afi54n0k6.cloudfront.net",
                    changeOrigin: true,
                    secure: false,
                    rewrite: (path) => path, // Keep the /api prefix
                    configure: (proxy, _options) => {
                        proxy.on('error', (err, _req, _res) => {
                            console.log('Proxy error:', err);
                        });
                        proxy.on('proxyReq', (proxyReq, req, _res) => {
                            console.log('Proxying:', req.method, req.url, '→', proxyReq.path);
                        });
                        proxy.on('proxyRes', (proxyRes, req, _res) => {
                            console.log('Proxy response:', req.url, '→', proxyRes.statusCode);
                        });
                    }
                },
                // Add proxy for external video sources to handle CORS
                "/proxy-video": {
                    target: "https://commondatastorage.googleapis.com",
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/proxy-video/, ''),
                    configure: (proxy) => {
                        proxy.on('proxyReq', (proxyReq) => {
                            proxyReq.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
                        });
                    }
                }
            }
        }
    });
};
