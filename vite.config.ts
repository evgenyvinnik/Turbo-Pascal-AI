import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'path';
import { dosRuntimePlugin } from './scripts/dosRuntimePlugin';

export default defineConfig({
  plugins: [
    dosRuntimePlugin(),
    TanStackRouterVite(),
    react({
      babel: {
        plugins: [
          'babel-plugin-react-compiler',
          [
            '@stylexjs/babel-plugin',
            {
              dev: process.env.NODE_ENV === 'development',
              // Inject styles at runtime in production too. It otherwise follows
              // `dev`, and nothing here extracts StyleX CSS to a file, so production
              // builds shipped without any component styles.
              runtimeInjection: true,
              genConditionalClasses: true,
              treeshakeCompensation: true,
              aliases: {
                '@/*': [path.resolve(__dirname, 'src/*')],
                '@styles/*': [path.resolve(__dirname, 'src/styles/*')],
              },
              unstable_moduleResolution: {
                type: 'commonJS',
                rootDir: path.resolve(__dirname),
              },
            },
          ],
        ],
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.ttf', 'icons/*.png', 'samples/*.PAS'],
      manifest: {
        name: 'Turbo Pascal IDE',
        short_name: 'TurboPascal',
        description: 'A web-based Turbo Pascal IDE clone with authentic DOS experience',
        theme_color: '#0000AA',
        background_color: '#000000',
        display: 'standalone',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,ttf,woff2,PAS}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@compiler': path.resolve(__dirname, './src/compiler'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@services': path.resolve(__dirname, './src/services'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@i18n': path.resolve(__dirname, './src/i18n'),
      '@routes': path.resolve(__dirname, './src/routes'),
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          compiler: ['@/compiler'],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
});
