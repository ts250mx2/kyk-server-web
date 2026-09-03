import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pruebas unitarias de los módulos puros (sin base ni proveedor de IA).
export default defineConfig({
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
});
