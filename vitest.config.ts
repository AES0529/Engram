import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // 使用 Node 环境（BrainRecallCache 是纯算法，不需要 DOM）
        environment: 'node',
        include: ['test/**/*.test.ts'],
        // 全局 setup
        setupFiles: ['./test/setup.ts'],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
});
