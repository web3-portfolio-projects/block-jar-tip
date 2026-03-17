import { createConfig, http } from 'wagmi'
import { injected, metaMask } from 'wagmi/connectors'
import { mainnet, sepolia } from 'wagmi/chains'

const dappName = import.meta.env.VITE_METAMASK_DAPP_NAME ?? 'Block Jar Tip'
const dappUrl =
  import.meta.env.VITE_METAMASK_DAPP_URL ??
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')

export const config = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    injected(),
    metaMask({
      dappMetadata: {
        name: dappName,
        url: dappUrl,
      },
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
