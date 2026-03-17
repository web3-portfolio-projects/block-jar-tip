/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL?: string
	readonly VITE_METAMASK_DAPP_NAME?: string
	readonly VITE_METAMASK_DAPP_URL?: string
	readonly VITE_METAMASK_DEEP_LINK_BASE?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
