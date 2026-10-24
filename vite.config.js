import { defineConfig } from 'vite';

export default defineConfig({
  // These ES modules work natively; avoiding a dependency prebundle also keeps
  // the dev server compatible with tightly sandboxed Windows workspaces.
  optimizeDeps: { noDiscovery: true, include: [] },
  // The Godot port's folder is not the web game's: its editor writes and locks
  // temporary files there, which would stop the watcher (EBUSY) and the server.
  server: { watch: { ignored: ['**/godot/**'] } },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: { game: 'index.html', stormtrooper: 'stormtrooper.html', explosion: 'explosion.html' },
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
        },
      },
    },
  },
});
