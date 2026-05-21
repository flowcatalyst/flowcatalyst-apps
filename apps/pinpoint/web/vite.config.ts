import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { PrimeVueResolver } from "@primevue/auto-import-resolver";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	plugins: [
		vue(),
		Components({
			resolvers: [PrimeVueResolver()],
		}),
	],
	appType: "spa",
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/bff": {
				target: "http://localhost:3000",
				changeOrigin: true,
			},
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
			},
			"/auth": {
				target: "http://localhost:3000",
				changeOrigin: true,
			},
		},
	},
});
